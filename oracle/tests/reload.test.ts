import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { directory } from "./helpers.js";

test(
  "the supervised process reloads changed code after its accepted work drains",
  { timeout: 10_000 },
  async (t) => {
    const root = await directory(t);
    for (const name of ["dispatcher", "session"]) await mkdir(join(root, name));
    await copyFile(
      new URL("../dispatcher/service.mjs", import.meta.url),
      join(root, "dispatcher/service.mjs"),
    );
    await writeFile(join(root, "dispatcher/version.ts"), "first");
    await writeFile(join(root, "release"), "waiting");
    const watcher = new URL("../dispatcher/reload.ts", import.meta.url).href;
    await writeFile(
      join(root, "dispatcher/main.ts"),
      `
    import { watchSource } from ${JSON.stringify(watcher)};
    import { readFile } from "node:fs/promises";
    import { watch } from "node:fs";
    import { once } from "node:events";
    const stop = await watchSource({ root: process.cwd(), intervalMs: 20,
      onFault: () => { throw new Error("watch failed"); },
      onChange: () => { void (async () => {
        const gate = watch("release");
        process.stdout.write("draining\\n");
        await once(gate, "change");
        gate.close();
        process.exitCode = 75;
      })(); },
    });
    process.once("SIGTERM", () => { stop(); process.exitCode = 0; });
    process.stdout.write("ready:" + await readFile("dispatcher/version.ts", "utf8") + "\\n");
  `,
    );
    const service = spawn(process.execPath, [join(root, "dispatcher/service.mjs")], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => {
      service.kill("SIGTERM");
    });
    const exited = once(service, "exit");
    let errors = "";
    service.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const lines = createInterface({ input: service.stdout })[Symbol.asyncIterator]();
    assert.equal((await lines.next()).value, "ready:first", errors);
    await writeFile(join(root, "dispatcher/version.ts"), "second");
    assert.equal((await lines.next()).value, "draining", errors);
    assert.equal(service.exitCode, null);
    await writeFile(join(root, "release"), "done");
    assert.equal((await lines.next()).value, "ready:second", errors);
    service.kill("SIGTERM");
    assert.deepEqual(await exited, [0, null], errors);
  },
);
