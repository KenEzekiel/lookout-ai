import assert from "node:assert/strict";
import test from "node:test";
import { createOracle } from "../dispatcher/index.js";
import { routeSlack } from "../dispatcher/slack.js";
import { defaultLimits } from "../session/domain.js";
import { createSessionStore } from "../session/index.js";
import { deferred, directory, input, testNow, untilAborted } from "./helpers.js";

test("deduplication across Slack listeners admits and executes one turn", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  let runs = 0;
  const messages: string[] = [];
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    runner: {
      async run() {
        runs++;
        return { kind: "reply", text: "Checked." };
      },
    },
    publish: async (_, text) => {
      messages.push(text);
    },
  });
  const wire = {
    channel: "CCHAN1",
    user: "UACTOR1",
    ts: "1900000000.000001",
    text: "<@UORACLE1> inspect",
  };
  const route = (listener: "mention" | "message") =>
    routeSlack({
      event: wire,
      listener,
      identity: { user_id: "UORACLE1", team_id: "TTEAM1" },
      teamId: "TTEAM1",
      owns: oracle.owns,
    });
  const mention = route("mention");
  const message = route("message");
  assert.ok(mention && message);
  assert.deepEqual(await Promise.all([oracle.receive(mention), oracle.receive(message)]), [
    "accepted",
    "duplicate",
  ]);
  await oracle.idle();
  assert.equal(runs, 1);
  assert.deepEqual(messages, ["Checked."]);
});

test("a turn outlives the former three-minute limit and delivers its result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const entered = deferred<void>();
  const release = deferred<void>();
  const messages: string[] = [];
  let activeSignal: AbortSignal | undefined;
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    runner: {
      async run({ signal, report }) {
        activeSignal = signal;
        entered.resolve();
        await release.promise;
        await report("Still working.");
        return { kind: "reply", text: "Finished the long request." };
      },
    },
    publish: async (_, text) => {
      messages.push(text);
    },
  });
  t.after(async () => {
    release.resolve();
    await oracle.close();
  });
  const request = input("Complete a long request");
  await oracle.receive(request);
  await entered.promise;
  t.mock.timers.tick(3_600_000);
  assert.equal(activeSignal?.aborted, false);
  assert.equal(sessions.snapshot(request.address)?.events[0]?.status, "running");
  assert.deepEqual(messages, []);
  release.resolve();
  await oracle.idle();
  assert.deepEqual(messages, ["Still working.", "Finished the long request."]);
  assert.equal(sessions.snapshot(request.address)?.events[0]?.status, "completed");
});

test("conversation FIFO preserves order while an unrelated conversation runs", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const entered = deferred<void>();
  const release = deferred<void>();
  const events: string[] = [];
  let concurrent = 0;
  const otherFinished = deferred<void>();
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    publish: async () => {},
    runner: {
      async run({ input: request }) {
        if (request.text !== "Other") concurrent++;
        if (request.text !== "Other") assert.equal(concurrent, 1);
        events.push(request.text);
        if (request.text === "First") {
          entered.resolve();
          await release.promise;
        }
        if (request.text !== "Other") concurrent--;
        else otherFinished.resolve();
        return { kind: "silent" };
      },
    },
  });
  const first = input("First");
  await oracle.receive(first);
  await entered.promise;
  await oracle.receive(input("Second", { address: first.address, route: "thread" }));
  await oracle.receive(input("Third", { address: first.address, route: "thread" }));
  await oracle.receive(input("Other"));
  await otherFinished.promise;
  assert.deepEqual(events, ["First", "Other"]);
  release.resolve();
  await oracle.idle();
  assert.deepEqual(events, ["First", "Other", "Second", "Third"]);
});

test("stop aborts immediately, cancels queued thread work, and direct work resumes", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const entered = deferred<void>();
  const cleaned = deferred<void>();
  const otherStarted = deferred<void>();
  let activeSignal: AbortSignal | undefined;
  const runs: string[] = [];
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    publish: async () => {},
    runner: {
      async run({ input: request, signal }) {
        runs.push(request.text);
        if (request.text === "First") {
          activeSignal = signal;
          entered.resolve();
          await untilAborted(signal);
          await cleaned.promise;
        }
        if (request.text === "Other session") otherStarted.resolve();
        return { kind: "silent" };
      },
    },
  });
  const first = input("First");
  await oracle.receive(first);
  await entered.promise;
  await oracle.receive(input("Queued", { address: first.address, route: "thread" }));
  const stopping = oracle.receive(input("stop", { address: first.address, route: "thread" }));
  assert.equal(activeSignal?.aborted, true);
  await stopping;
  await oracle.receive(input("Other session"));
  await otherStarted.promise;
  assert.deepEqual(runs, ["First", "Other session"]);
  cleaned.resolve();
  await oracle.idle();
  assert.deepEqual(runs, ["First", "Other session"]);
  assert.equal(
    await oracle.receive(input("Plain reply", { address: first.address, route: "thread" })),
    "ignored",
  );
  await oracle.receive(input("Resume", { address: first.address }));
  await oracle.idle();
  assert.deepEqual(runs, ["First", "Other session", "Resume"]);
  assert.equal(
    sessions
      .snapshot(first.address)
      ?.events.some((event) => event.input.text === "Queued" && event.status === "cancelled"),
    true,
  );
});

test("an old stop delivery cannot interrupt current work", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const started = deferred<void>();
  const release = deferred<void>();
  let signal: AbortSignal | undefined;
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    publish: async () => {},
    runner: {
      async run(args) {
        signal = args.signal;
        started.resolve();
        await release.promise;
        return { kind: "silent" };
      },
    },
  });
  const first = input();
  await oracle.receive(first);
  await started.promise;
  assert.equal(
    await oracle.receive(input("stop", { address: first.address, ts: "1700000000.000001" })),
    "ignored",
  );
  assert.equal(signal?.aborted, false);
  release.resolve();
  await oracle.idle();
});

test("persistence precedes processing status and completed reply delivery", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    setStatus: async (address, status) => {
      if (status === "processing")
        assert.equal(sessions.snapshot(address)?.events[0]?.status, "queued");
    },
    runner: {
      async run() {
        return { kind: "reply", text: "Observed." };
      },
    },
    publish: async (address, text) => {
      const document = sessions.snapshot(address);
      assert.equal(document?.deliveries.at(-1)?.state, "attempting");
      assert.equal(document?.events[0]?.status, "completed");
      if (text === "Observed.") assert.equal(document?.history.at(-1)?.text, text);
    },
  });
  await oracle.receive(input());
  await oracle.idle();
});

test("ambiguous Slack sends are never automatically retried", async (t) => {
  const options = { directory: await directory(t), limits: defaultLimits, now: () => testNow };
  const sessions = createSessionStore(options);
  let sends = 0;
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    runner: {
      async run() {
        return { kind: "reply", text: "Checked." };
      },
    },
    publish: async () => {
      sends++;
      throw new Error("ambiguous_send");
    },
  });
  const request = input();
  await oracle.receive(request);
  await oracle.idle();
  assert.equal(sends, 1);
  assert.equal(sessions.snapshot(request.address)?.deliveries[0]?.state, "uncertain");
  const restarted = await createOracle({
    sessions: createSessionStore(options),
    limits: defaultLimits,
    now: () => testNow,
    runner: {
      async run() {
        throw new Error("must_not_replay");
      },
    },
    publish: async () => {
      sends++;
    },
  });
  await restarted.idle();
  assert.equal(sends, 1);
});

test("failed admission persists no acknowledgement and stops later work", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
    persist: async () => {
      throw new Error("storage_failed");
    },
  });
  let calls = 0;
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    runner: {
      async run() {
        calls++;
        return { kind: "silent" };
      },
    },
    publish: async () => {
      calls++;
    },
  });
  assert.equal(await oracle.receive(input()), "ignored");
  assert.equal(await oracle.receive(input()), "ignored");
  assert.equal(calls, 0);
});

test("raw runner failures become generic messages", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const outputs: string[] = [];
  const faults: string[] = [];
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    runner: {
      async run() {
        throw new Error("internal failure at /home/example/lookout");
      },
    },
    publish: async (_, text) => {
      outputs.push(text);
    },
    onFault: (code) => {
      faults.push(code);
    },
  });
  await oracle.receive(input());
  await oracle.idle();
  assert.deepEqual(outputs, ["The turn could not finish. Send a fresh request to continue."]);
  assert.deepEqual(faults, ["turn_failed"]);
});

test("shutdown clears processing for both active and queued conversations", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const entered = deferred<void>();
  const statuses = new Map<string, string>();
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    runner: {
      run: async ({ signal }) => {
        entered.resolve();
        await untilAborted(signal);
        return { kind: "silent" };
      },
    },
    publish: async () => {},
    setStatus: async (address, status) => {
      statuses.set(address.rootTs, status);
    },
  });
  const first = input("First");
  const second = input("Second");
  await oracle.receive(first);
  await entered.promise;
  await oracle.receive(second);
  assert.equal(statuses.get(second.address.rootTs), "processing");
  await oracle.close();
  assert.equal(statuses.get(first.address.rootTs), "active");
  assert.equal(statuses.get(second.address.rootTs), "active");
});

test("waking pending work during admission does not enqueue the same request twice", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const coding: string[] = [];
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    setStatus: async (_, status) => {
      if (status === "processing") oracle.retryPending();
    },
    runner: {
      run: async ({ input: request }) => {
        coding.push(request.text);
        return { kind: "reply", text: "Done" };
      },
    },
    publish: async () => {},
  });
  t.after(() => oracle.close());
  await oracle.receive(input("First"));
  await oracle.idle();
  assert.equal(await oracle.receive(input("Second")), "accepted");
  await oracle.idle();
  assert.deepEqual(coding, ["First", "Second"]);
});

test("an explicit stop stays stopped across a reload", async (t) => {
  const options = { directory: await directory(t), limits: defaultLimits, now: () => testNow };
  const sessions = createSessionStore(options);
  const entered = deferred<void>();
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    runner: {
      run: async ({ signal }) => {
        entered.resolve();
        await untilAborted(signal);
        return { kind: "silent" };
      },
    },
    publish: async () => {},
  });
  t.after(() => oracle.close());
  const request = input("Stop this task");
  await oracle.receive(request);
  await entered.promise;
  await oracle.receive(input("Follow up", { address: request.address, route: "thread" }));
  assert.equal(
    await oracle.receive(input("stop", { address: request.address, route: "thread" })),
    "stopped",
  );
  await oracle.close("reload");
  const recovered = createSessionStore(options);
  let resumed = 0;
  const next = await createOracle({
    sessions: recovered,
    limits: defaultLimits,
    now: () => testNow,
    runner: {
      run: async () => {
        resumed++;
        return { kind: "silent" };
      },
    },
    publish: async () => {},
  });
  t.after(() => next.close());
  next.retryPending();
  await next.idle();
  assert.equal(resumed, 0);
  assert.equal(recovered.snapshot(request.address)?.stopped, true);
  assert.deepEqual(recovered.pending(), []);
  assert.equal(recovered.snapshot(request.address)?.events[0]?.status, "cancelled");
});
