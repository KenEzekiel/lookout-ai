import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { createOracle } from "../dispatcher/index.js";
import { createSessionStore } from "../session/index.js";
import { BoundaryError, defaultLimits } from "../session/domain.js";
import { createWorkspace } from "../session/workspace.js";
import { deferred, directory, input, testNow } from "./helpers.js";

const execute = promisify(execFile);
const workspaceFor = (root: string) => createWorkspace({ root, verifyMain: async () => true });
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
  await git(primary, "config", "user.name", "Workspace Test");
  await git(primary, "config", "user.email", "test@example.invalid");
  await git(primary, "config", "user.useConfigOnly", "true");
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
  await workspaceFor(worktree).sync();
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
  await assert.rejects(workspaceFor(primary).sync(), { code: "workspace_must_be_isolated" });
  await git(primary, "checkout", "-b", "human");
  await git(worktree, "checkout", "main");
  await assert.rejects(workspaceFor(worktree).sync(), { code: "workspace_must_be_isolated" });
  await git(worktree, "checkout", "--detach");
  await assert.rejects(workspaceFor(worktree).sync());
});

test("uncertain backend shutdown prevents queued Git updates", async (t) => {
  const { worktree, advance } = await fixture(t);
  const workspace = workspaceFor(worktree);
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
  const workspace = workspaceFor(worktree);
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
  const workspace = workspaceFor(worktree);
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

test("unverified main stays out of the workspace until CI succeeds for its exact commit", async (t) => {
  const { primary, worktree, advance } = await fixture(t);
  let verified = false;
  const checked: string[] = [];
  const workspace = createWorkspace({
    root: worktree,
    verifyMain: async (commit) => {
      checked.push(commit);
      return verified;
    },
  });
  await advance("verified update\n");
  const commit = await git(primary, "rev-parse", "HEAD");
  assert.deepEqual(await workspace.sync(), { kind: "waiting_for_ci", commit });
  assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), "initial\n");
  let ran = false;
  await assert.rejects(
    workspace.run(async () => {
      ran = true;
    }),
    { code: "workspace_main_unverified" },
  );
  assert.equal(ran, false);
  verified = true;
  assert.deepEqual(await workspace.sync(), { kind: "updated", commit });
  assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), "verified update\n");
  assert.ok(checked.every((value) => value === commit));
});

test("merge setup failures retain their original error and never abort a nonexistent merge", async (t) => {
  const { primary, worktree, advance } = await fixture(t);
  await writeFile(join(worktree, "oracle.txt"), "local commit\n");
  await git(worktree, "add", ".");
  await git(worktree, "commit", "-m", "local commit");
  await advance("remote commit\n");
  await git(primary, "config", "user.email", "");
  await git(primary, "config", "user.name", "");
  await assert.rejects(workspaceFor(worktree).sync(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /empty ident|identity unknown|no email/i);
    assert.doesNotMatch(error.message, /There is no merge to abort/);
    return true;
  });
  assert.equal(await git(worktree, "status", "--porcelain"), "");
});

test("a concurrent fetch cannot substitute an unverified commit after the CI check", async (t) => {
  const { primary, worktree, advance } = await fixture(t);
  await advance("first update\n");
  const verifiedCommit = await git(primary, "rev-parse", "HEAD");
  const workspace = createWorkspace({
    root: worktree,
    verifyMain: async (commit) => {
      assert.equal(commit, verifiedCommit);
      await advance("newer unverified update\n");
      await git(primary, "fetch", "origin", "main");
      return true;
    },
  });
  assert.deepEqual(await workspace.sync(), { kind: "updated", commit: verifiedCommit });
  assert.equal(await git(worktree, "rev-parse", "HEAD"), verifiedCommit);
  assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), "first update\n");
});

test(
  "the original Slack request survives unavailable CI checks and runs after verified Git sync",
  { timeout: 5_000 },
  async (t) => {
    const { primary, worktree, advance } = await fixture(t);
    let verified = false;
    const workspace = createWorkspace({
      root: worktree,
      verifyMain: async () => {
        if (!verified) throw new Error("GitHub temporarily unavailable");
        return true;
      },
    });
    const sessions = createSessionStore({
      directory: await directory(t),
      limits: defaultLimits,
      now: () => testNow,
    });
    const finished = deferred<void>();
    let coding = 0;
    const messages: string[] = [];
    const oracle = await createOracle({
      sessions,
      limits: defaultLimits,
      now: () => testNow,
      retryIntervalMs: 10,
      runner: {
        run: async () =>
          workspace.run(async () => {
            assert.equal(
              await git(worktree, "rev-parse", "HEAD"),
              await git(primary, "rev-parse", "HEAD"),
            );
            coding++;
            return { kind: "reply", text: "Completed after verified sync" };
          }),
      },
      publish: async (_, text) => {
        messages.push(text);
        if (text === "Completed after verified sync") finished.resolve();
      },
    });
    t.after(() => oracle.close());
    await advance("CI-gated update\n");
    const request = input("Answer the original Slack request");
    await oracle.receive(request);
    await oracle.idle();
    assert.equal(sessions.snapshot(request.address)?.events[0]?.status, "waiting_for_ci");
    assert.equal(coding, 0);
    verified = true;
    await finished.promise;
    await oracle.idle();
    assert.equal(coding, 1);
    assert.equal(messages.length, 2);
    assert.equal(sessions.snapshot(request.address)?.events[0]?.status, "completed");
  },
);
