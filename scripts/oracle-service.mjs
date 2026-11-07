import { execFile } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const action = process.argv[2] ?? "status";
const root = await realpath(process.argv[3] ?? fileURLToPath(new URL("../", import.meta.url)));
const label = "com.lookout.oracle";
const target = `gui/${process.getuid()}/${label}`;
const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
const run = (command, args) => execute(command, args, { timeout: 30_000 });
const escape = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

if (process.platform !== "darwin") throw new Error("Oracle's managed service requires macOS.");
if (action === "install") {
  const git = async (...args) => (await run("git", ["-C", root, ...args])).stdout.trim();
  const gitDirectory = await realpath(resolve(root, await git("rev-parse", "--git-dir")));
  const common = await realpath(resolve(root, await git("rev-parse", "--git-common-dir")));
  if (gitDirectory === common || (await git("symbolic-ref", "--short", "HEAD")) !== "oracle")
    throw new Error("Install Oracle in its linked runtime worktree on branch oracle.");
  if (await git("status", "--porcelain"))
    throw new Error("Preserve unfinished work and clean the Oracle runtime before installing.");
  await run("pnpm", ["--version"]);
  await run("gh", ["auth", "status"]);
  const oracleRoot = join(root, "oracle");
  const state = join(oracleRoot, ".state");
  await mkdir(dirname(plist), { recursive: true });
  await mkdir(state, { recursive: true, mode: 0o700 });
  const path = `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`;
  await writeFile(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(join(oracleRoot, "dispatcher/service.mjs"))}</string></array>
<key>WorkingDirectory</key><string>${escape(oracleRoot)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(path)}</string><key>ORACLE_MANAGED_SERVICE</key><string>1</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ExitTimeOut</key><integer>90</integer>
<key>StandardOutPath</key><string>${escape(join(state, "service.log"))}</string>
<key>StandardErrorPath</key><string>${escape(join(state, "service.log"))}</string>
</dict></plist>
`,
    { mode: 0o600 },
  );
  await run("plutil", ["-lint", plist]);
  await run("launchctl", ["bootout", "--wait", target]).catch((error) => {
    if (!/Could not find service|No such process/i.test(error.stderr)) throw error;
  });
  await run("launchctl", ["bootstrap", `gui/${process.getuid()}`, plist]);
} else if (action === "stop") {
  await run("launchctl", ["bootout", "--wait", target]);
} else if (action !== "status") {
  throw new Error("Use install, status, or stop, followed by an optional worktree path.");
}
if (action !== "stop") process.stdout.write((await run("launchctl", ["print", target])).stdout);
