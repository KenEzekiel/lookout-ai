import assert from "node:assert/strict";
import test from "node:test";
import { createOracle } from "../dispatcher/index.js";
import { defaultLimits } from "../session/domain.js";
import { createSessionStore } from "../session/index.js";
import { createT3Runner } from "../session/run.js";
import { createDisclosure } from "../tools/disclosure.js";
import { directory, input, testNow } from "./helpers.js";

test("thread context and model progress reach the same conversation without a canned ack", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const prompts: string[] = [];
  const sent: { rootTs: string; text: string }[] = [];
  const statuses: string[] = [];
  let reply = '{"kind":"reply","text":"The reply handler is fixed."}';
  let progress = "I will trace the reply handler.";
  let policy = "Operating rules";
  const client = {
    launch: async () => ({ threadId: "thread", projectId: "project", runId: null }),
    send: async ({ message }) => {
      prompts.push(message);
      return { threadId: "thread", runId: "run", delivery: "started" };
    },
    read: async () => ({
      threadId: "thread",
      projectId: "project",
      status: "idle",
      activeRunId: null,
      latestRunId: "run",
      pendingRequestCount: 0,
    }),
    finish: async ({ onProgress }) => {
      await onProgress?.(progress);
      return { kind: "completed", reply };
    },
    stopAndDrain: async () => {},
  } satisfies Parameters<typeof createT3Runner>[0]["client"];
  const disclosure = createDisclosure(["private-test-marker"]);
  const runner = createT3Runner({
    client,
    sessions,
    projectId: "project",
    instanceId: "instance",
    model: "model",
    policy: async () => policy,
    disclosure,
    context: async () => ({
      kind: "available",
      messages: [
        { actor: "UTEAMMATE1", ts: "1900000000.000000", text: "private-test-marker" },
        { actor: "UTEAMMATE1", ts: "1900000000.000000", text: "Please inspect the reply handler." },
      ],
      truncated: false,
    }),
  });
  const oracle = await createOracle({
    sessions,
    runner,
    limits: defaultLimits,
    now: () => testNow,
    disclosure,
    publish: async (address, text) => {
      sent.push({ rootTs: address.rootTs, text });
    },
    setStatus: async (_, status) => {
      statuses.push(status);
    },
  });
  const first = input("Respond to the latest request in this Slack thread.");
  await oracle.receive(first);
  await oracle.idle();
  assert.deepEqual(sent, [
    { rootTs: first.address.rootTs, text: progress },
    { rootTs: first.address.rootTs, text: "The reply handler is fixed." },
  ]);
  assert.deepEqual(statuses, ["processing", "active"]);
  assert.ok(prompts[0]?.includes('"actor":"UTEAMMATE1"'));
  assert.ok(prompts[0]?.includes("Please inspect the reply handler."));
  assert.equal(prompts[0]?.includes("private-test-marker"), false);
  assert.ok(prompts[0]?.includes('"truncated":true'));
  assert.equal(sessions.snapshot(first.address)?.deliveries[0]?.kind, "progress");

  reply = '{"kind":"silent"}';
  policy = "Updated operating rules";
  progress = "private-test-marker";
  await oracle.receive(input("Follow up", { address: first.address }));
  await oracle.idle();
  assert.ok(prompts[1]?.includes('"role":"assistant","text":"The reply handler is fixed."'));
  assert.ok(prompts[1]?.startsWith("Updated operating rules\n"));
  assert.equal(
    sent.some(({ text }) => text.includes(progress)),
    false,
  );
  assert.match(sent.at(-1)?.text ?? "", /did not pass the disclosure policy/);

  progress = "I will check the follow-up.";
  await oracle.receive(input("Please answer", { address: first.address }));
  await oracle.idle();
  assert.equal(sent.at(-1)?.text, "The turn could not finish. Send a fresh request to continue.");
});

test("a failed status indicator cannot prevent the final answer", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const messages: string[] = [];
  const faults: string[] = [];
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    disclosure: createDisclosure(),
    runner: { run: async () => ({ kind: "reply", text: "Checked." }) },
    publish: async (_, text) => {
      messages.push(text);
    },
    setStatus: async () => {
      throw new Error("missing_scope");
    },
    onFault: (code) => {
      faults.push(code);
    },
  });
  await oracle.receive(input());
  await oracle.idle();
  assert.deepEqual(messages, ["Checked."]);
  assert.deepEqual(faults, ["slack_status_unavailable", "slack_status_unavailable"]);
});
