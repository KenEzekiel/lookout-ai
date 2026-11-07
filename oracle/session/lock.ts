import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { BoundaryError } from "./domain.js";

export async function acquireInstanceLock(directory: string): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new BoundaryError("state_directory_invalid");
  const path = join(directory, "instance.lock");
  const token = randomUUID();
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(token);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    throw new BoundaryError("instance_lock_unavailable");
  }
  return async () => {
    if ((await readFile(path, "utf8")) !== token) throw new BoundaryError("instance_lock_changed");
    await unlink(path);
  };
}
