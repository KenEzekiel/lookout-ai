import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function fingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  const files = ["package.json", ".env", ".local/disclosure.json", "../pnpm-lock.yaml"];
  const collect = async (directory: string): Promise<void> => {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const name = join(directory, entry.name);
      if (entry.isDirectory()) await collect(name);
      else if (entry.isFile() && /\.(?:ts|mjs)$/.test(name)) files.push(name);
    }
  };
  for (const directory of ["dispatcher", "session", "tools"]) await collect(directory);
  for (const file of files.sort()) {
    hash.update(file);
    try {
      hash.update(await readFile(join(root, file)));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      hash.update("missing");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function watchSource(options: {
  root: string;
  onChange: () => void;
  onFault: () => void;
  intervalMs?: number;
}): Promise<() => void> {
  const initial = await fingerprint(options.root);
  let candidate: string | undefined;
  let checking = false;
  let stopped = false;
  const stop = (): void => {
    stopped = true;
    clearInterval(timer);
  };
  const timer = setInterval(() => {
    if (checking || stopped) return;
    checking = true;
    void (async () => {
      try {
        const current = await fingerprint(options.root);
        if (stopped) return;
        if (current === initial) candidate = undefined;
        else if (current === candidate) {
          stop();
          options.onChange();
        } else candidate = current;
      } catch {
        if (!stopped) options.onFault();
      } finally {
        checking = false;
      }
    })();
  }, options.intervalMs ?? 1_000);
  return stop;
}
