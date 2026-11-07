import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { defaultLimits } from "../session/domain.js";
import { atomicJson, createSessionStore } from "../session/index.js";
import { acquireInstanceLock } from "../session/lock.js";
import { directory, input, testNow } from "./helpers.js";

test("atomic snapshots preserve queued work without replaying running turns", async (t) => {
  const path = await directory(t);
  const options = { directory: path, limits: defaultLimits, now: () => testNow };
  const store = createSessionStore(options);
  await store.recover();
  const first = input();
  await store.admit(first);
  await store.claim(first);
  await store.complete(first, { kind: "reply", text: "Inspected the source." });
  const second = input("Next task", { address: first.address });
  const third = input("Queued task", { address: first.address });
  await store.admit(second);
  await store.claim(second);
  await store.admit(third);
  await store.delivery(first.address, "result", "Ready.");
  const recovered = createSessionStore(options);
  await recovered.recover();
  assert.deepEqual(
    recovered.snapshot(first.address)?.events.map((event) => event.status),
    ["completed", "interrupted", "queued"],
  );
  assert.equal(recovered.snapshot(first.address)?.history.length, 2);
  assert.equal(recovered.snapshot(first.address)?.deliveries[0]?.state, "uncertain");
  await assert.rejects(recovered.claim(second), /turn_cancelled/);
  assert.deepEqual(recovered.pending(), [third]);
  assert.equal(await recovered.admit(first), "duplicate");
  assert.ok((await readdir(path)).every((name) => /^[a-f0-9]{64}\.json$/.test(name)));
});

test("failed mutation leaves an uncertain journal intent after recovery", async (t) => {
  const options = { directory: await directory(t), limits: defaultLimits, now: () => testNow };
  const store = createSessionStore(options);
  await store.recover();
  const event = input();
  await store.admit(event);
  await store.claim(event);
  await assert.rejects(
    store.mutation(event, "src/example.ts", async () => {
      throw new Error("interrupted");
    }),
  );
  const recovered = createSessionStore(options);
  await recovered.recover();
  assert.equal(recovered.snapshot(event.address)?.mutations[0]?.state, "uncertain");
});

test("persistence failure never advances durable in-memory state and fails closed", async (t) => {
  let fail = false;
  const store = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
    persist: async (path, value) => {
      if (fail) throw new Error("disk_failure");
      await atomicJson(path, value);
    },
  });
  await store.recover();
  const event = input();
  await store.admit(event);
  fail = true;
  await assert.rejects(store.claim(event), /persistence_unavailable/);
  assert.equal(store.snapshot(event.address)?.events[0]?.status, "queued");
  fail = false;
  await assert.rejects(store.admit(input()), /persistence_unavailable/);
});

test("bounded dedup refuses new work rather than evicting admissible IDs", async (t) => {
  const store = createSessionStore({
    directory: await directory(t),
    limits: { ...defaultLimits, maxDedupEntries: 1 },
    now: () => testNow,
  });
  await store.recover();
  const first = input();
  assert.equal(await store.admit(first), "accepted");
  assert.equal(await store.admit(input("Next", { address: first.address })), "busy");
  assert.equal(await store.admit(first), "duplicate");
});

test("old deliveries and oversized messages cannot establish sessions", async (t) => {
  const store = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  await store.recover();
  const old = input("Old", { ts: "1700000000.000001" });
  assert.equal(await store.admit(old), "ignored");
  assert.equal(store.owns(old.address), false);
  assert.equal(await store.admit(input("a".repeat(defaultLimits.maxInputBytes + 1))), "ignored");
});

test("a second instance refuses the exclusive lock without stealing it", async (t) => {
  const path = await directory(t);
  const release = await acquireInstanceLock(path);
  await assert.rejects(acquireInstanceLock(path), /instance_lock_unavailable/);
  await release();
  await (
    await acquireInstanceLock(path)
  )();
});

test("queued requests retain capacity and survive admission pruning after an hour", async (t) => {
  let now = testNow;
  const limits = { ...defaultLimits, maxQueuedPerSession: 1, maxSessions: 1 };
  const store = createSessionStore({ directory: await directory(t), limits, now: () => now });
  await store.recover();
  const request = input();
  await store.admit(request);
  now += limits.maxEventAgeMs + limits.maxClockSkewMs + 1_000;
  const currentTs = `${Math.floor(now / 1_000)}.000001`;
  assert.equal(
    await store.admit(input("Another", { address: request.address, ts: currentTs })),
    "busy",
  );
  assert.equal(await store.admit(input("New session", { ts: currentTs })), "busy");
  assert.deepEqual(store.pending(), [request]);
});

test("legacy CI waiters recover as pending with a first attempt", async (t) => {
  const path = await directory(t);
  const options = { directory: path, limits: defaultLimits, now: () => testNow };
  const store = createSessionStore(options);
  await store.recover();
  const request = input();
  await store.admit(request);
  const document = store.snapshot(request.address);
  assert.ok(document);
  const [name] = await readdir(path);
  assert.ok(name);
  await atomicJson(join(path, name), {
    ...document,
    events: document.events.map(({ attempt: _attempt, ...event }) => ({
      ...event,
      status: "waiting_for_ci",
      waitNotified: true,
    })),
  });
  const recovered = createSessionStore(options);
  await recovered.recover();
  assert.deepEqual(recovered.pending(), [request]);
  await recovered.claim(request);
  assert.equal(recovered.snapshot(request.address)?.events[0]?.attempt, 0);
});
