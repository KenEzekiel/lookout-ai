import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { type Address, BoundaryError, keyOf } from "./domain.js";

const execute = promisify(execFile);

export function createWorkspace(options: { root: string; branch: string }) {
  const { root } = options;
  let pending = Promise.resolve();
  const gitAt = async (cwd: string, ...args: string[]): Promise<string> => {
    const { stdout } = await execute("git", ["-C", cwd, ...args], { timeout: 30_000 });
    return stdout.trim();
  };
  const git = (...args: string[]) => gitAt(root, ...args);
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation);
    pending = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const currentCommit = async (): Promise<string> => {
    const directory = await realpath(resolve(root, await git("rev-parse", "--git-dir")));
    const common = await realpath(resolve(root, await git("rev-parse", "--git-common-dir")));
    const branch = await git("symbolic-ref", "--short", "HEAD");
    if (directory === common || branch === "main")
      throw new BoundaryError("workspace_must_be_isolated");
    if (branch !== options.branch) throw new BoundaryError("workspace_branch_changed");
    if (await git("diff", "--name-only", "--diff-filter=U"))
      throw new BoundaryError("workspace_sync_conflict");
    if (await git("status", "--porcelain")) throw new BoundaryError("workspace_sync_dirty");
    return git("rev-parse", "HEAD");
  };
  const task = async (address: Address, commit: string): Promise<string> => {
    const common = await realpath(resolve(root, await git("rev-parse", "--git-common-dir")));
    const primary = dirname(common);
    const key = createHash("sha256").update(keyOf(address)).digest("hex");
    const path = join(primary, ".worktree", `oracle-task-${key}`);
    const branch = `oracle-task/${key}`;
    const records = (await git("worktree", "list", "--porcelain", "-z")).split("\0\0");
    if (!records.some((record) => record.split("\0").includes(`worktree ${path}`))) {
      try {
        await gitAt(primary, "check-ignore", "--quiet", ".worktree/probe");
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== 1) throw error;
        const exclude = resolve(root, await git("rev-parse", "--git-path", "info/exclude"));
        await appendFile(exclude, "\n/.worktree/\n");
      }
      let exists = false;
      try {
        await git("show-ref", "--verify", "--quiet", `refs/heads/${branch}`);
        exists = true;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== 1) throw error;
      }
      await git("worktree", "add", ...(exists ? [path, branch] : ["-b", branch, path, commit]));
    }
    const taskBranch = await gitAt(path, "symbolic-ref", "--short", "HEAD");
    if (taskBranch === "main" || taskBranch === options.branch)
      throw new BoundaryError("task_workspace_invalid");
    return await realpath(path);
  };
  return {
    task: (address: Address): Promise<string> =>
      serial(async () => {
        return task(address, await currentCommit());
      }),
  };
}
