import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let child;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}

try {
  while (!stopping) {
    const code = await new Promise((resolve, reject) => {
      child = spawn(
        process.execPath,
        ["--import", "tsx", fileURLToPath(new URL("./main.ts", import.meta.url))],
        { stdio: "inherit" },
      );
      child.once("error", reject);
      child.once("exit", (exitCode) => resolve(exitCode));
    });
    if (code !== 75 || stopping) {
      process.exitCode = code ?? 1;
      break;
    }
    process.stderr.write('{"event":"oracle_restarting"}\n');
  }
} catch {
  process.stderr.write('{"event":"dispatcher_spawn_failed"}\n');
  process.exitCode = 1;
}
