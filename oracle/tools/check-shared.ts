import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDisclosure } from "./disclosure.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ignored = new Set(["node_modules", ".local", ".state", ".git", "coverage"]);
const disclosure = await loadDisclosure(join(root, ".local", "disclosure.json"));
let failed = false;
async function scan(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith(".env") || entry.name.endsWith(".log"))
      continue;
    const path = join(directory, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      process.stderr.write(`${relative(root, path)}: symbolic_link\n`);
      failed = true;
    } else if (stat.isDirectory()) {
      await scan(path);
    } else if (stat.isFile()) {
      const findings = disclosure.findings(await readFile(path, "utf8"));
      if (findings.length) {
        process.stderr.write(`${relative(root, path)}: ${findings.join(", ")}\n`);
        failed = true;
      }
    }
  }
}
await scan(root);
if (failed) process.exitCode = 1;
else process.stdout.write("Shared source disclosure check passed.\n");
