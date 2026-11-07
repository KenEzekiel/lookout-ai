import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { createOracle } from "../dispatcher/index.js";
import { createSessionStore } from "../session/index.js";
import { defaultLimits } from "../session/domain.js";
import { createT3Runner } from "../session/run.js";
import { createWorkspace } from "../session/workspace.js";
import { deferred, directory, input, testNow } from "./helpers.js";

const execute = promisify(execFile);
const workspaceFor = (root: string) => createWorkspace({ root, branch: "oracle" });
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
async function syncRuntime(root: string): Promise<void> {
  await git(root, "fetch", "origin", "main");
  await git(root, "merge", "--no-edit", "origin/main");
}
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

test("task preparation uses the pinned runtime without fetching newer main", async (t) => {
  const { primary, worktree, advance } = await fixture(t);
  const pinned = await git(worktree, "rev-parse", "HEAD");
  await advance("new main waiting for manual sync\n");
  await git(primary, "fetch", "origin", "main");
  await git(primary, "remote", "set-url", "origin", join(worktree, "unavailable-origin.git"));
  const task = await workspaceFor(worktree).task(input().address);
  assert.equal(await git(worktree, "rev-parse", "HEAD"), pinned);
  assert.equal(await git(task, "rev-parse", "HEAD"), pinned);
  assert.equal(await readFile(join(task, "file.txt"), "utf8"), "initial\n");
});

test("manual sync preserves runtime commits and the primary checkout", async (t) => {
  const { primary, worktree, advance } = await fixture(t);
  await writeFile(join(worktree, "oracle.txt"), "Oracle work\n");
  await git(worktree, "add", ".");
  await git(worktree, "commit", "-m", "Oracle work");
  const oracleCommit = await git(worktree, "rev-parse", "HEAD");
  await advance("latest main\n");
  const mainCommit = await git(primary, "rev-parse", "HEAD");
  await writeFile(join(primary, "file.txt"), "uncommitted user work\n");
  await syncRuntime(worktree);
  await git(worktree, "merge-base", "--is-ancestor", mainCommit, "HEAD");
  await git(worktree, "merge-base", "--is-ancestor", oracleCommit, "HEAD");
  assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), "latest main\n");
  assert.equal(await readFile(join(worktree, "oracle.txt"), "utf8"), "Oracle work\n");
  assert.equal(await readFile(join(primary, "file.txt"), "utf8"), "uncommitted user work\n");
  assert.equal(await git(primary, "rev-parse", "HEAD"), mainCommit);
  assert.equal(await git(primary, "branch", "--show-current"), "main");
  const workspace = workspaceFor(worktree);
  const task = await workspace.task(input().address);
  assert.equal(await git(task, "rev-parse", "HEAD"), await git(worktree, "rev-parse", "HEAD"));
});

test("task preparation refuses primary, main and detached checkouts", async (t) => {
  const { primary, worktree } = await fixture(t);
  await assert.rejects(workspaceFor(primary).task(input().address), {
    code: "workspace_must_be_isolated",
  });
  await git(primary, "checkout", "-b", "human");
  await git(worktree, "checkout", "main");
  await assert.rejects(workspaceFor(worktree).task(input().address), {
    code: "workspace_must_be_isolated",
  });
  await git(worktree, "checkout", "--detach");
  await assert.rejects(workspaceFor(worktree).task(input().address));
});

test("the runtime refuses a switched branch even when main is current", async (t) => {
  const { worktree } = await fixture(t);
  const workspace = workspaceFor(worktree);
  await git(worktree, "checkout", "-b", "feature/other-task");
  await assert.rejects(workspace.task(input().address), {
    code: "workspace_branch_changed",
  });
  assert.equal(await git(worktree, "branch", "--show-current"), "feature/other-task");
});

test("the runtime refuses uncommitted files even when main is current", async (t) => {
  const { worktree } = await fixture(t);
  const workspace = workspaceFor(worktree);
  await writeFile(join(worktree, "unfinished.txt"), "preserve this work\n");
  await assert.rejects(workspace.task(input().address), {
    code: "workspace_sync_dirty",
  });
  assert.equal(await readFile(join(worktree, "unfinished.txt"), "utf8"), "preserve this work\n");
});

test("Slack coding uses separate feature worktrees while runtime sync and follow-ups preserve task work", async (t) => {
  const { primary, worktree, advance } = await fixture(t);
  const workspace = workspaceFor(worktree);
  await git(primary, "branch", "feature/existing-pr");
  const paths = new Map<string, string>();
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  let sends = 0;
  const entered = deferred<void>();
  const release = deferred<void>();
  const secondFinished = deferred<void>();
  let initialTurn = true;
  const first = input("First task");
  const second = input("Second task");
  const runner = createT3Runner({
    sessions,
    projectId: "project",
    instanceId: "instance",
    model: "model",
    workspace: workspace.task,
    policy: async () => "Operate in your task worktree",
    context: async () => ({ kind: "unavailable" }),
    profiles: async () => ({ users: [], unresolved: [], mappings: "available", truncated: false }),
    client: {
      launch: async ({ workspace: path }) => {
        assert.notEqual(path, worktree);
        assert.notEqual(path, primary);
        assert.equal(await git(path, "rev-parse", "HEAD"), await git(primary, "rev-parse", "HEAD"));
        assert.match(await git(path, "branch", "--show-current"), /^oracle-task\//);
        const threadId = `thread-${paths.size}`;
        paths.set(threadId, path);
        return { threadId, projectId: "project", runId: null };
      },
      read: async ({ threadId }) => {
        const path = paths.get(threadId);
        assert.ok(path);
        return {
          threadId,
          projectId: "project",
          status: "idle",
          activeRunId: null,
          latestRunId: null,
          pendingRequestCount: 0,
          worktreePath: path,
        };
      },
      send: async ({ threadId }) => {
        const path = paths.get(threadId);
        assert.ok(path);
        if (sends < 2) {
          if (sends === 0) await git(path, "checkout", "feature/existing-pr");
          else await git(path, "checkout", "-b", `feature/task-${sends}`);
          await writeFile(join(path, "unfinished.txt"), `task ${sends}\n`);
        } else {
          assert.equal(await readFile(join(path, "unfinished.txt"), "utf8"), "task 0\n");
          assert.equal(await git(path, "branch", "--show-current"), "feature/existing-pr");
        }
        sends++;
        return { threadId, runId: `run-${sends}`, delivery: "started" };
      },
      finish: async ({ threadId }) => {
        if (threadId === "thread-0" && initialTurn) {
          initialTurn = false;
          entered.resolve();
          await release.promise;
        }
        return { kind: "completed", reply: '{"kind":"reply","text":"Task complete"}' };
      },
      stopAndDrain: async () => {},
    },
  });
  const replies: string[] = [];
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    runner,
    publish: async (address, text) => {
      replies.push(text);
      if (address.rootTs === second.address.rootTs) secondFinished.resolve();
    },
  });
  t.after(async () => {
    release.resolve();
    await oracle.close();
  });
  const firstPath = await workspace.task(first.address);
  await oracle.receive(first);
  await entered.promise;
  await advance("new main chosen by the maintainer\n");
  await syncRuntime(worktree);
  await oracle.receive(second);
  await secondFinished.promise;
  assert.equal(sends, 2);
  release.resolve();
  await oracle.idle();
  await oracle.receive(input("Continue first task", { address: first.address, route: "thread" }));
  await oracle.idle();
  assert.equal(sends, 3);
  assert.equal(paths.size, 2);
  assert.equal(new Set(paths.values()).size, 2);
  assert.equal(paths.get("thread-0"), firstPath);
  assert.deepEqual(replies, ["Task complete", "Task complete", "Task complete"]);
  assert.equal(await git(worktree, "branch", "--show-current"), "oracle");
  assert.equal(await git(worktree, "rev-parse", "HEAD"), await git(primary, "rev-parse", "HEAD"));
  assert.equal(await git(worktree, "status", "--porcelain"), "");
  assert.equal(await git(primary, "status", "--porcelain"), "");
});

test("task preparation preserves dirty files and unresolved manual merge conflicts", async (t) => {
  const { worktree, advance } = await fixture(t);
  const workspace = workspaceFor(worktree);
  await writeFile(join(worktree, "file.txt"), "local change\n");
  await advance("remote change\n");
  await assert.rejects(workspace.task(input().address), { code: "workspace_sync_dirty" });
  assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), "local change\n");
  await git(worktree, "commit", "-am", "conflicting Oracle work");
  const before = await git(worktree, "rev-parse", "HEAD");
  await git(worktree, "fetch", "origin", "main");
  await assert.rejects(git(worktree, "merge", "--no-edit", "origin/main"));
  const conflicted = await readFile(join(worktree, "file.txt"), "utf8");
  await assert.rejects(workspace.task(input().address), { code: "workspace_sync_conflict" });
  assert.equal(await git(worktree, "rev-parse", "HEAD"), before);
  assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), conflicted);
  assert.ok(await git(worktree, "rev-parse", "--verify", "MERGE_HEAD"));
  await git(worktree, "merge", "--abort");
  assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), "local change\n");
});

for (const scenario of ["untracked", "conflict"] as const) {
  test(`Slack explains the ${scenario} workspace blocker and a fresh request runs after repair`, async (t) => {
    const { worktree, advance } = await fixture(t);
    const workspace = workspaceFor(worktree);
    const localPath = join(worktree, scenario === "untracked" ? "draft.txt" : "file.txt");
    await writeFile(localPath, "unfinished work\n");
    if (scenario === "conflict") await git(worktree, "commit", "-am", "local work");
    const before = await git(worktree, "rev-parse", "HEAD");
    await advance("remote change\n");
    if (scenario === "conflict") {
      await git(worktree, "fetch", "origin", "main");
      await assert.rejects(git(worktree, "merge", "--no-edit", "origin/main"));
    }
    const beforeContents = await readFile(localPath, "utf8");
    const sessions = createSessionStore({
      directory: await directory(t),
      limits: defaultLimits,
      now: () => testNow,
    });
    const messages: string[] = [];
    const faults: string[] = [];
    let coding = 0;
    const oracle = await createOracle({
      sessions,
      limits: defaultLimits,
      now: () => testNow,
      runner: {
        run: async ({ input: request }) => {
          await workspace.task(request.address);
          coding++;
          return { kind: "reply", text: "Resumed after workspace repair" };
        },
      },
      publish: async (_, text) => {
        messages.push(text);
      },
      onFault: (code) => {
        faults.push(code);
      },
    });
    t.after(() => oracle.close());
    const request = input("Continue the Slack task");
    assert.equal(await oracle.receive(request), "accepted");
    await oracle.idle();
    assert.equal(coding, 0);
    assert.equal(await git(worktree, "rev-parse", "HEAD"), before);
    assert.equal(await readFile(localPath, "utf8"), beforeContents);
    if (scenario === "conflict")
      assert.ok(await git(worktree, "rev-parse", "--verify", "MERGE_HEAD"));
    else await assert.rejects(git(worktree, "rev-parse", "--verify", "MERGE_HEAD"));
    assert.equal(messages.length, 1);
    assert.match(
      messages[0] ?? "",
      scenario === "untracked" ? /uncommitted changes/ : /merge conflict/,
    );
    assert.match(messages[0] ?? "", /maintainer/);
    assert.match(messages[0] ?? "", /fresh request/);
    assert.deepEqual(faults, [
      scenario === "untracked" ? "workspace_sync_dirty" : "workspace_sync_conflict",
    ]);
    assert.equal(sessions.snapshot(request.address)?.deliveries[0]?.state, "sent");
    if (scenario === "conflict") {
      await writeFile(localPath, "unfinished work\nremote change\n");
    }
    await git(worktree, "add", ".");
    await git(worktree, "commit", "-m", "save work and resolve blocker");
    await oracle.receive(input("Continue", { address: request.address }));
    await oracle.idle();
    assert.equal(coding, 1);
    assert.equal(messages.at(-1), "Resumed after workspace repair");
    assert.equal(messages.length, 2);
    assert.equal(await git(worktree, "status", "--porcelain"), "");
    assert.match(await readFile(localPath, "utf8"), /unfinished work/);
  });
}

test("manual runtime sync never updates an existing task checkout", async (t) => {
  const { primary, worktree, advance } = await fixture(t);
  const workspace = workspaceFor(worktree);
  const first = input("Active task");
  const task = await workspace.task(first.address);
  await writeFile(join(task, "unfinished.txt"), "active task work\n");
  await advance("updated runtime\n");
  await syncRuntime(worktree);
  assert.equal(await readFile(join(task, "file.txt"), "utf8"), "initial\n");
  assert.equal(await readFile(join(task, "unfinished.txt"), "utf8"), "active task work\n");
  assert.equal(await readFile(join(worktree, "file.txt"), "utf8"), "updated runtime\n");
  const next = await workspace.task(input("Next task").address);
  assert.equal(await git(next, "rev-parse", "HEAD"), await git(primary, "rev-parse", "HEAD"));
  assert.equal(await workspace.task(first.address), task);
});

test("Slack requests run from the chosen revision while newer main is unavailable", async (t) => {
  const { primary, worktree, advance } = await fixture(t);
  const pinned = await git(worktree, "rev-parse", "HEAD");
  const workspace = workspaceFor(worktree);
  await advance("new main waiting for a manual update\n");
  await git(primary, "remote", "set-url", "origin", join(worktree, "unavailable-origin.git"));
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  let coding = 0;
  const messages: string[] = [];
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    runner: {
      run: async ({ input: request }) => {
        const task = await workspace.task(request.address);
        assert.equal(await git(task, "rev-parse", "HEAD"), pinned);
        coding++;
        return { kind: "reply", text: "Completed on the selected runtime" };
      },
    },
    publish: async (_, text) => {
      messages.push(text);
    },
  });
  t.after(() => oracle.close());
  const request = input("Answer without waiting for newer main");
  await oracle.receive(request);
  await oracle.idle();
  assert.equal(coding, 1);
  assert.deepEqual(messages, ["Completed on the selected runtime"]);
  assert.equal(sessions.snapshot(request.address)?.events[0]?.status, "completed");
  assert.equal(await git(worktree, "rev-parse", "HEAD"), pinned);
});
