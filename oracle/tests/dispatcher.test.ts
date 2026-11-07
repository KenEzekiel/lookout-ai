import assert from "node:assert/strict";
import test from "node:test";
import { createOracle } from "../dispatcher/index.js";
import { routeSlack } from "../dispatcher/slack.js";
import { BoundaryError, defaultLimits } from "../session/domain.js";
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

test("global FIFO holds the checkout for complete model turns", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const entered = deferred<void>();
  const release = deferred<void>();
  const events: string[] = [];
  let concurrent = 0;
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    publish: async () => {},
    runner: {
      async run({ input: request }) {
        concurrent++;
        assert.equal(concurrent, 1);
        events.push(request.text);
        if (request.text === "First") {
          entered.resolve();
          await release.promise;
        }
        concurrent--;
        return { kind: "silent" };
      },
    },
  });
  await oracle.receive(input("First"));
  await entered.promise;
  await oracle.receive(input("Second"));
  await oracle.receive(input("Third"));
  assert.deepEqual(events, ["First"]);
  release.resolve();
  await oracle.idle();
  assert.deepEqual(events, ["First", "Second", "Third"]);
});

test("stop aborts immediately, cancels queued thread work, and direct work resumes", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const entered = deferred<void>();
  const cleaned = deferred<void>();
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
  assert.deepEqual(runs, ["First"]);
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

test(
  "a request waits for CI and resumes automatically without resending",
  { timeout: 2_000 },
  async (t) => {
    const sessions = createSessionStore({
      directory: await directory(t),
      limits: defaultLimits,
      now: () => testNow,
    });
    const messages: string[] = [];
    const finished = deferred<void>();
    let verified = false;
    let codingTurns = 0;
    const oracle = await createOracle({
      sessions,
      limits: defaultLimits,
      now: () => testNow,
      retryIntervalMs: 10,
      runner: {
        run: async () => {
          if (!verified) throw new BoundaryError("workspace_main_unverified");
          codingTurns++;
          return { kind: "reply", text: "Finished the original request." };
        },
      },
      publish: async (_, text) => {
        messages.push(text);
        if (text === "Finished the original request.") finished.resolve();
      },
    });
    t.after(() => oracle.close());
    const request = input("What can we work on while waiting?");
    await oracle.receive(request);
    await oracle.idle();
    assert.equal(sessions.snapshot(request.address)?.events[0]?.status, "waiting_for_ci");
    assert.equal(sessions.snapshot(request.address)?.history.length, 0);
    assert.deepEqual(messages, [
      "I'm keeping this request queued while main finishes CI. I'll continue here automatically when it's ready.",
    ]);
    verified = true;
    await finished.promise;
    await oracle.idle();
    assert.equal(codingTurns, 1);
    assert.equal(sessions.snapshot(request.address)?.events[0]?.status, "completed");
    assert.equal(await oracle.receive(request), "duplicate");
    assert.equal(messages.length, 2);
  },
);
