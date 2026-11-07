import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { BoundaryError } from "../session/domain.js";
import { createWorkspace } from "../session/workspace.js";
import { deferred, directory } from "./helpers.js";

const execute = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => {
  const { stdout } = await execute("git", [
    "-C",
    cwd,
    "-c",
    "user.name=Workspace Test",
    "-c",
    "user.email=test@example.invalid",
    ...args,
  ]);
  return stdout.trim();
};
async function fixture(t: TestContext) {
  const root = await directory(t);
  const origin = join(root, "origin.git");
  const primary = join(root, "primary");
  const worktree = join(root, "oracle");
  await git(root, "init", "--bare", origin);
  await git(root, "init", "-b", "main", primary);
  await writeFile(join(primary, "file.txt"), "initial\n");
  await git(primary, "add", ".");
  await git(primary, "commit", "-m", "initial");
  await git(primary, "remote", "add", "origin", origin);
  await git(primary, "push", "-u", "origin", "main");
  await git(primary, "worktree", "add", "-b", "oracle", worktree, "origin/main");
  const advance = async (text: string) => {
    await writeFile(join(primary, "file.txt"), text);
    await git(primary, "commit", "-am", "advance main");
    await git(primary, "push", "origin", "main");
  };
  return { primary, worktree, advance };
}

test("sync includes latest main and preserves Oracle commits and the primary checkout", async (t) => {
  const { primary, worktree, advance } = await fixture(t);
  await writeFile(join(worktree, "oracle.txt"), "Oracle work\n");
  await git(worktree, "add", ".");
  await git(worktree, "commit", "-m", "Oracle work");
  const oracleCommit = await git(worktree, "rev-parse", "HEAD");
  await advance("latest main\n");
  const mainCommit = await git(primary, "rev-parse", "HEAD");
  await writeFile(join(primary, "file.txt"), "uncommitted user work\n");
  await createWorkspace(worktree).sync();
  await git(worktree, "merge-base", "--is-ancestor", mainCommit, "HEAD");
  await git(worktree, "merge-base", "--is-ancestor", oracleCommit, "HEAD");
  assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), "latest main\n");
  assert.equal(await readFile(join(worktree, "oracle.txt"), "utf8"), "Oracle work\n");
  assert.equal(await readFile(join(primary, "file.txt"), "utf8"), "uncommitted user work\n");
  assert.equal(await git(primary, "rev-parse", "HEAD"), mainCommit);
  assert.equal(await git(primary, "branch", "--show-current"), "main");
});

test("sync refuses primary, main and detached checkouts", async (t) => {
  const { primary, worktree } = await fixture(t);
  await assert.rejects(createWorkspace(primary).sync(), { code: "workspace_must_be_isolated" });
  await git(primary, "checkout", "-b", "human");
  await git(worktree, "checkout", "main");
  await assert.rejects(createWorkspace(worktree).sync(), { code: "workspace_must_be_isolated" });
  await git(worktree, "checkout", "--detach");
  await assert.rejects(createWorkspace(worktree).sync());
});

test("uncertain backend shutdown prevents queued Git updates", async (t) => {
  const { worktree, advance } = await fixture(t);
  const workspace = createWorkspace(worktree);
  await assert.rejects(
    workspace.run(async () => {
      throw new BoundaryError("backend_work_uncertain");
    }),
    { code: "backend_work_uncertain" },
  );
  await advance("must not reach active checkout\n");
  await assert.rejects(workspace.sync(), { code: "backend_work_uncertain" });
  assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), "initial\n");
});

test("dirty updates and merge conflicts preserve files and leave no merge in progress", async (t) => {
  const { worktree, advance } = await fixture(t);
  const workspace = createWorkspace(worktree);
  await writeFile(join(worktree, "file.txt"), "local change\n");
  await advance("remote change\n");
  await assert.rejects(workspace.sync(), { code: "workspace_sync_dirty" });
  assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), "local change\n");
  await git(worktree, "commit", "-am", "conflicting Oracle work");
  const before = await git(worktree, "rev-parse", "HEAD");
  await assert.rejects(workspace.sync(), { code: "workspace_sync_conflict" });
  assert.equal(await git(worktree, "rev-parse", "HEAD"), before);
  assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), "local change\n");
  assert.equal(await git(worktree, "status", "--porcelain"), "");
  await assert.rejects(git(worktree, "rev-parse", "--verify", "MERGE_HEAD"));
});

test("background sync waits for a complete coding turn and the next turn starts current", async (t) => {
  const { primary, worktree, advance } = await fixture(t);
  const workspace = createWorkspace(worktree);
  const started = deferred<void>();
  const release = deferred<void>();
  const turn = workspace.run(async () => {
    started.resolve();
    await release.promise;
    assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), "initial\n");
  });
  await started.promise;
  await advance("updated while coding\n");
  const syncing = workspace.sync();
  release.resolve();
  await turn;
  await syncing;
  await workspace.run(async () => {
    assert.equal(await git(worktree, "rev-parse", "HEAD"), await git(primary, "rev-parse", "HEAD"));
  });
});
