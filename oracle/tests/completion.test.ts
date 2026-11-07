import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createOracle, type TurnRunner } from "../dispatcher/index.js";
import { createSlackTransport } from "../dispatcher/slack.js";
import { defaultLimits, keyOf, type Incoming } from "../session/domain.js";
import { createSessionStore } from "../session/index.js";
import { createT3Runner } from "../session/run.js";
import type { T3Finish } from "../session/t3.js";
import { deferred, directory, input, testNow, untilAborted } from "./helpers.js";

async function fixture(
  t: TestContext,
  options: {
    run?: TurnRunner["run"];
    call?: (method: string, args: Record<string, unknown>) => Promise<void>;
  } = {},
) {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const faults: string[] = [];
  const checks = new Set<string>();
  const results: T3Finish[] = [];
  const drains: string[] = [];
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const transport = createSlackTransport({
    identity: { user_id: "UORACLE1", team_id: "TTEAM1" },
    onFault: (code) => faults.push(code),
    call: async (method, args) => {
      calls.push({ method, args });
      await options.call?.(method, args);
      if (method === "users.info")
        return { user: { id: args.user, team_id: "TTEAM1", is_bot: false, deleted: false } };
      const key = `${args.channel}:${args.timestamp}`;
      if (method === "reactions.add") {
        const document = sessions.snapshot({
          channel: String(args.channel),
          rootTs: String(args.timestamp),
        });
        assert.equal(document?.deliveries.at(-1)?.state, "sent");
        assert.equal(document?.deliveries.at(-1)?.kind, "result");
        if (checks.has(key)) throw { data: { error: "already_reacted" } };
        checks.add(key);
      }
      if (method === "reactions.remove" && !checks.delete(key))
        throw { data: { error: "no_reaction" } };
      return { ok: true };
    },
  });
  const runner = options.run
    ? { run: options.run }
    : createT3Runner({
        sessions,
        projectId: "project",
        instanceId: "instance",
        model: "model",
        workspace: async () => "/workspace/task",
        policy: async () => "Operating rules",
        context: async () => ({ kind: "available", messages: [], truncated: false }),
        profiles: async () => ({
          users: [],
          unresolved: [],
          mappings: "available",
          truncated: false,
        }),
        client: {
          launch: async () => ({ threadId: "thread", projectId: "project", runId: null }),
          send: async () => ({ threadId: "thread", runId: "run", delivery: "started" }),
          read: async () => ({
            threadId: "thread",
            projectId: "project",
            status: "idle",
            activeRunId: null,
            latestRunId: "run",
            pendingRequestCount: 0,
            worktreePath: "/workspace/task",
          }),
          finish: async ({ onProgress }) => {
            await onProgress?.("Checking.");
            return (
              results.shift() ?? { kind: "completed", reply: '{"kind":"reply","text":"Done."}' }
            );
          },
          stopAndDrain: async ({ threadId }) => {
            drains.push(threadId);
          },
        },
      });
  const oracle = await createOracle({
    sessions,
    runner,
    publish: transport.publish,
    setStatus: transport.setStatus,
    setCompleted: transport.setCompleted,
    limits: defaultLimits,
    now: () => testNow,
    onFault: (code) => faults.push(code),
  });
  t.after(() => oracle.close());
  const receive = async (request: Incoming) => {
    await transport.receive({
      event: {
        channel: request.address.channel,
        thread_ts: request.address.rootTs,
        ts: request.ts,
        user: request.actor,
        text: request.route === "direct" ? `<@UORACLE1> ${request.text}` : request.text,
      },
      teamId: "TTEAM1",
      listener: "message",
      oracle,
    });
  };
  return { oracle, receive, sessions, transport, calls, checks, faults, results, drains };
}

test("a confirmed final reply marks only its root message after progress and delivery", async (t) => {
  const f = await fixture(t);
  const request = input("Inspect", { address: { channel: "CROOT1", rootTs: "1900000000.000000" } });
  await f.receive(request);
  await f.oracle.idle();
  assert.deepEqual(
    f.calls.filter(({ method }) => method !== "users.info").map(({ method }) => method),
    [
      "reactions.remove",
      "agents.sessions.setStatus",
      "chat.postMessage",
      "chat.postMessage",
      "reactions.add",
      "agents.sessions.setStatus",
    ],
  );
  assert.deepEqual(f.calls.find(({ method }) => method === "reactions.add")?.args, {
    channel: request.address.channel,
    timestamp: request.address.rootTs,
    name: "white_check_mark",
  });
  assert.deepEqual([...f.checks], [keyOf(request.address)]);
  assert.deepEqual(f.faults, []);
  await f.receive(request);
  await f.oracle.idle();
  assert.equal(f.calls.filter(({ method }) => method === "reactions.add").length, 1);
});

test("a follow-up clears the check until its own final reply", async (t) => {
  const started = deferred<void>();
  const release = deferred<void>();
  t.after(() => release.resolve());
  const f = await fixture(t, {
    run: async ({ input: request }) => {
      if (request.text === "Follow up") {
        started.resolve();
        await release.promise;
      }
      return { kind: "reply", text: "Done." };
    },
  });
  const first = input();
  await f.receive(first);
  await f.oracle.idle();
  assert.equal(f.checks.has(keyOf(first.address)), true);
  await f.receive(input("Follow up", { address: first.address, route: "thread" }));
  await started.promise;
  assert.equal(f.checks.has(keyOf(first.address)), false);
  release.resolve();
  await f.oracle.idle();
  assert.equal(f.checks.has(keyOf(first.address)), true);
});

const incomplete: T3Finish[] = [
  { kind: "needs_input" },
  { kind: "ended", status: "interrupted" },
  { kind: "completed", reply: null },
  { kind: "completed", reply: "invalid response" },
];
for (const result of incomplete) {
  test(`${JSON.stringify(result)} does not mark the thread complete`, async (t) => {
    const f = await fixture(t);
    f.results.push(result);
    await f.receive(input());
    await f.oracle.idle();
    assert.equal(f.checks.size, 0);
    assert.equal(
      f.calls.some(({ method }) => method === "reactions.add"),
      false,
    );
    assert.equal(f.calls.filter(({ method }) => method === "chat.postMessage").length, 2);
    if (result.kind !== "completed") assert.deepEqual(f.drains, []);
  });
}

test("existing completion reactions are idempotent", async (t) => {
  const f = await fixture(t, {
    call: async (method, args) => {
      if (method === "reactions.add") f.checks.add(`${args.channel}:${args.timestamp}`);
    },
  });
  await f.receive(input());
  await f.oracle.idle();
  assert.equal(f.checks.size, 1);
  assert.deepEqual(f.faults, []);
});

test("a resumed conversation removes a check left by the previous process", async (t) => {
  const f = await fixture(t);
  const first = input();
  await f.receive(first);
  await f.oracle.idle();
  await f.oracle.close();
  assert.equal(f.checks.size, 1);
  const started = deferred<void>();
  const release = deferred<void>();
  t.after(() => release.resolve());
  const resumed = await createOracle({
    sessions: f.sessions,
    runner: {
      run: async () => {
        started.resolve();
        await release.promise;
        return { kind: "reply", text: "Resumed." };
      },
    },
    publish: f.transport.publish,
    setCompleted: f.transport.setCompleted,
    limits: defaultLimits,
    now: () => testNow,
  });
  t.after(() => resumed.close());
  await resumed.receive(input("Follow up", { address: first.address, route: "thread" }));
  await started.promise;
  assert.equal(f.checks.size, 0);
  release.resolve();
  await resumed.idle();
  assert.equal(f.checks.size, 1);
});

test("silent thread messages and uncertain final deliveries never add a check", async (t) => {
  let failDelivery = false;
  const f = await fixture(t, {
    call: async (method, args) => {
      if (failDelivery && method === "chat.postMessage" && args.text === "Done.")
        throw new Error("send_uncertain");
    },
  });
  const first = input();
  await f.receive(first);
  await f.oracle.idle();
  f.results.push({ kind: "completed", reply: '{"kind":"silent"}' });
  await f.receive(input("Ambient", { address: first.address, route: "thread" }));
  await f.oracle.idle();
  assert.equal(f.checks.size, 0);
  failDelivery = true;
  await f.receive(input("Follow up", { address: first.address, route: "thread" }));
  await f.oracle.idle();
  assert.equal(f.calls.filter(({ method }) => method === "reactions.add").length, 1);
  assert.equal(f.sessions.snapshot(first.address)?.deliveries.at(-1)?.state, "uncertain");
  assert.ok(f.faults.includes("delivery_uncertain"));
});

test("reaction permissions cannot prevent replies or processing another conversation", async (t) => {
  const f = await fixture(t, {
    call: async (method) => {
      if (method.startsWith("reactions.")) throw { data: { error: "missing_scope" } };
    },
  });
  await f.receive(input());
  await f.oracle.idle();
  await f.receive(input());
  await f.oracle.idle();
  assert.equal(
    f.calls.filter(({ method, args }) => method === "chat.postMessage" && args.text === "Done.")
      .length,
    2,
  );
  assert.deepEqual(f.faults, Array(4).fill("slack_completion_unavailable"));
});

test("queued work suppresses completion until the last reply", async (t) => {
  const started = deferred<void>();
  const release = deferred<void>();
  t.after(() => release.resolve());
  const f = await fixture(t, {
    run: async ({ input: request }) => {
      if (request.text === "First") {
        started.resolve();
        await release.promise;
      }
      return { kind: "reply", text: request.text };
    },
  });
  const first = input("First");
  await f.receive(first);
  await started.promise;
  await f.receive(input("Second", { address: first.address, route: "thread" }));
  release.resolve();
  await f.oracle.idle();
  const messages = f.calls.filter(
    ({ method }) => method === "chat.postMessage" || method === "reactions.add",
  );
  assert.deepEqual(
    messages.map(({ method, args }) => (method === "reactions.add" ? "check" : args.text)),
    ["First", "Second", "check"],
  );
});

for (const followUp of ["Follow up", "stop"]) {
  test(`${followUp} during a pending reaction leaves no stale completion mark`, async (t) => {
    const adding = deferred<void>();
    const releaseAdd = deferred<void>();
    const running = deferred<void>();
    const releaseRun = deferred<void>();
    t.after(() => {
      releaseAdd.resolve();
      releaseRun.resolve();
    });
    let holdAdd = true;
    const f = await fixture(t, {
      call: async (method) => {
        if (method === "reactions.add" && holdAdd) {
          holdAdd = false;
          adding.resolve();
          await releaseAdd.promise;
        }
      },
      run: async ({ input: request }) => {
        if (request.text === "Follow up") {
          running.resolve();
          await releaseRun.promise;
        }
        return { kind: "reply", text: request.text };
      },
    });
    const first = input("First");
    await f.receive(first);
    await adding.promise;
    await f.receive(input(followUp, { address: first.address, route: "thread" }));
    releaseAdd.resolve();
    if (followUp === "Follow up") await running.promise;
    else await f.oracle.idle();
    assert.equal(f.checks.size, 0);
    releaseRun.resolve();
    await f.oracle.idle();
    assert.equal(f.checks.size, followUp === "Follow up" ? 1 : 0);
  });
}

test("cancellation prevents a check for active and queued turns", async (t) => {
  const started = deferred<void>();
  const f = await fixture(t, {
    run: async ({ signal }) => {
      started.resolve();
      await untilAborted(signal);
      return { kind: "reply", text: "Late reply" };
    },
  });
  const first = input();
  await f.receive(first);
  await started.promise;
  await f.receive(input("Queued", { address: first.address, route: "thread" }));
  await f.receive(input("stop", { address: first.address, route: "thread" }));
  await f.oracle.idle();
  assert.equal(
    f.calls.some(({ method }) => method === "reactions.add"),
    false,
  );
  assert.equal(f.checks.size, 0);
});
