import assert from "node:assert/strict";
import test from "node:test";
import { createOracle } from "../dispatcher/index.js";
import { BoundaryError, defaultLimits } from "../session/domain.js";
import { createSessionStore } from "../session/index.js";
import { deferred, directory, input, testNow, untilAborted } from "./helpers.js";

for (const concurrency of [2, 24]) {
  test(
    `up to ${concurrency} conversations run together and excess requests finish once`,
    { timeout: 15_000 },
    async (t) => {
      const limits = { ...defaultLimits, maxConcurrentSessions: concurrency };
      const sessions = createSessionStore({
        directory: await directory(t),
        limits,
        now: () => testNow,
      });
      const full = deferred<void>();
      const release = deferred<void>();
      const replies: string[] = [];
      let running = 0;
      let maximum = 0;
      let started = 0;
      const oracle = await createOracle({
        sessions,
        limits,
        now: () => testNow,
        runner: {
          run: async ({ input: request }) => {
            started++;
            running++;
            maximum = Math.max(maximum, running);
            if (running === concurrency) full.resolve();
            await release.promise;
            running--;
            return { kind: "reply", text: request.text };
          },
        },
        publish: async (_, text) => {
          replies.push(text);
        },
      });
      t.after(async () => {
        release.resolve();
        await oracle.close();
      });
      const requests = Array.from({ length: concurrency === 24 ? 40 : 6 }, (_, i) =>
        input(`Task ${i}`),
      );
      for (const request of requests) assert.equal(await oracle.receive(request), "accepted");
      await full.promise;
      assert.equal(started, concurrency);
      assert.equal(replies.length, 0);
      release.resolve();
      await oracle.idle();
      assert.equal(maximum, concurrency);
      assert.equal(started, requests.length);
      assert.equal(new Set(replies).size, requests.length);
      assert.equal(replies.length, requests.length);
      assert.deepEqual(sessions.pending(), []);
    },
  );
}

test(
  "stopping one conversation leaves another active and preserves its reply",
  { timeout: 5_000 },
  async (t) => {
    const sessions = createSessionStore({
      directory: await directory(t),
      limits: defaultLimits,
      now: () => testNow,
    });
    const both = deferred<void>();
    const release = deferred<void>();
    const signals = new Map<string, AbortSignal>();
    const replies: string[] = [];
    const oracle = await createOracle({
      sessions,
      limits: defaultLimits,
      now: () => testNow,
      runner: {
        run: async ({ input: request, signal }) => {
          signals.set(request.text, signal);
          if (signals.size === 2) both.resolve();
          if (request.text === "Stop me") await untilAborted(signal);
          else await release.promise;
          return { kind: "reply", text: request.text };
        },
      },
      publish: async (_, text) => {
        replies.push(text);
      },
    });
    t.after(async () => {
      release.resolve();
      await oracle.close();
    });
    const first = input("Stop me");
    await oracle.receive(first);
    await oracle.receive(input("Keep running"));
    await both.promise;
    await oracle.receive(input("stop", { address: first.address, route: "thread" }));
    assert.equal(signals.get("Stop me")?.aborted, true);
    assert.equal(signals.get("Keep running")?.aborted, false);
    release.resolve();
    await oracle.idle();
    assert.ok(replies.includes("Keep running"));
    assert.ok(!replies.includes("Stop me"));
  },
);

test(
  "reload cancels parallel active turns and restores all requests after restart",
  { timeout: 5_000 },
  async (t) => {
    const limits = { ...defaultLimits, maxConcurrentSessions: 2 };
    const options = { directory: await directory(t), limits, now: () => testNow };
    const sessions = createSessionStore(options);
    const both = deferred<void>();
    const runs: string[] = [];
    const signals: AbortSignal[] = [];
    const oracle = await createOracle({
      sessions,
      limits,
      now: () => testNow,
      runner: {
        run: async ({ input: request, signal }) => {
          runs.push(request.text);
          signals.push(signal);
          if (runs.length === 2) both.resolve();
          await untilAborted(signal);
          return { kind: "reply", text: request.text };
        },
      },
      publish: async () => {},
    });
    t.after(() => oracle.close());
    await oracle.receive(input("Active A"));
    await oracle.receive(input("Active B"));
    await both.promise;
    const queued = input("Queued before reload");
    await oracle.receive(queued);
    await oracle.close("reload");
    assert.ok(signals.every((signal) => signal.aborted));
    assert.deepEqual(runs, ["Active A", "Active B"]);
    assert.equal(sessions.pending().length, 3);
    const recovered = await createOracle({
      sessions: createSessionStore(options),
      limits,
      now: () => testNow,
      runner: {
        run: async ({ input: request }) => {
          runs.push(request.text);
          return { kind: "reply", text: request.text };
        },
      },
      publish: async () => {},
    });
    t.after(() => recovered.close());
    recovered.retryPending();
    recovered.retryPending();
    await recovered.idle();
    assert.deepEqual(runs, [
      "Active A",
      "Active B",
      "Active A",
      "Active B",
      "Queued before reload",
    ]);
  },
);

test(
  "an ordinary turn failure does not abort other conversations",
  { timeout: 5_000 },
  async (t) => {
    const sessions = createSessionStore({
      directory: await directory(t),
      limits: defaultLimits,
      now: () => testNow,
    });
    const started = deferred<void>();
    const release = deferred<void>();
    const failed = deferred<void>();
    let otherSignal: AbortSignal | undefined;
    const replies: string[] = [];
    const oracle = await createOracle({
      sessions,
      limits: defaultLimits,
      now: () => testNow,
      runner: {
        run: async ({ input: request, signal }) => {
          if (request.text === "Fail") throw new Error("provider request failed");
          otherSignal = signal;
          started.resolve();
          await release.promise;
          return { kind: "reply", text: "Finished independently" };
        },
      },
      onFault: (code) => {
        if (code === "turn_failed") failed.resolve();
      },
      publish: async (_, text) => {
        replies.push(text);
      },
    });
    t.after(async () => {
      release.resolve();
      await oracle.close();
    });
    await oracle.receive(input("Continue"));
    await started.promise;
    await oracle.receive(input("Fail"));
    await failed.promise;
    assert.equal(otherSignal?.aborted, false);
    release.resolve();
    await oracle.idle();
    assert.ok(replies.includes("Finished independently"));
  },
);

test("uncertain backend shutdown stops parallel scheduling", { timeout: 5_000 }, async (t) => {
  const limits = { ...defaultLimits, maxConcurrentSessions: 2 };
  const sessions = createSessionStore({
    directory: await directory(t),
    limits,
    now: () => testNow,
  });
  const release = deferred<void>();
  const both = deferred<void>();
  const signals: AbortSignal[] = [];
  const faults: string[] = [];
  const oracle = await createOracle({
    sessions,
    limits,
    now: () => testNow,
    runner: {
      run: async ({ input: request, signal }) => {
        signals.push(signal);
        if (signals.length === 2) both.resolve();
        if (request.text === "Uncertain") {
          await release.promise;
          throw new BoundaryError("backend_work_uncertain");
        }
        assert.equal(request.text, "Other active task");
        await untilAborted(signal);
        return { kind: "silent" };
      },
    },
    publish: async () => {},
    onFault: (code) => {
      faults.push(code);
    },
  });
  t.after(async () => {
    release.resolve();
    await oracle.close();
  });
  await oracle.receive(input("Uncertain"));
  await oracle.receive(input("Other active task"));
  await both.promise;
  const queued = input("Do not start");
  await oracle.receive(queued);
  release.resolve();
  await oracle.idle();
  assert.ok(signals.every((signal) => signal.aborted));
  assert.ok(faults.includes("backend_work_uncertain"));
  assert.equal(sessions.snapshot(queued.address)?.events[0]?.status, "queued");
  assert.equal(await oracle.receive(input("Do not admit")), "ignored");
  await oracle.close();
});
