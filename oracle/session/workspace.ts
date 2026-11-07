import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { BoundaryError } from "./domain.js";
import { mainIsVerified } from "./checks.js";

const execute = promisify(execFile);

type Update = { kind: "current" | "updated" | "waiting_for_ci"; commit: string };

export function createWorkspace(options: {
  root: string;
  verifyMain?: (commit: string) => Promise<boolean>;
}) {
  const { root } = options;
  let pending = Promise.resolve();
  let uncertain = false;
  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await execute("git", ["-C", root, ...args], { timeout: 30_000 });
    return stdout.trim();
  };
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation);
    pending = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const sync = async (): Promise<Update> => {
    if (uncertain) throw new BoundaryError("backend_work_uncertain");
    const directory = await realpath(resolve(root, await git("rev-parse", "--git-dir")));
    const common = await realpath(resolve(root, await git("rev-parse", "--git-common-dir")));
    const branch = await git("symbolic-ref", "--short", "HEAD");
    if (directory === common || branch === "main")
      throw new BoundaryError("workspace_must_be_isolated");
    await git("fetch", "origin", "main");
    const commit = await git("rev-parse", "origin/main");
    const missing = await git("rev-list", "--count", `HEAD..${commit}`);
    if (missing === "0") return { kind: "current", commit };
    const verified = await (options.verifyMain?.(commit) ?? mainIsVerified({ root, commit }));
    if (!verified) return { kind: "waiting_for_ci", commit };
    if (await git("status", "--porcelain")) throw new BoundaryError("workspace_sync_dirty");
    try {
      await git("merge", "--no-edit", commit);
    } catch (error) {
      if (!(await git("diff", "--name-only", "--diff-filter=U"))) throw error;
      await git("merge", "--abort");
      throw new BoundaryError("workspace_sync_conflict");
    }
    return { kind: "updated", commit };
  };
  return {
    sync: () => serial(sync),
    run: <T>(operation: () => Promise<T>): Promise<T> =>
      serial(async () => {
        const update = await sync();
        if (update.kind === "waiting_for_ci") throw new BoundaryError("workspace_main_unverified");
        try {
          return await operation();
        } catch (error) {
          if (error instanceof BoundaryError && error.code === "backend_work_uncertain")
            uncertain = true;
          throw error;
        }
      }),
  };
}
