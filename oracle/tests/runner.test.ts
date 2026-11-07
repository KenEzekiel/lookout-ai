import assert from "node:assert/strict";
import test from "node:test";
import { createOracle } from "../dispatcher/index.js";
import { defaultLimits } from "../session/domain.js";
import { createSessionStore } from "../session/index.js";
import { createT3Runner } from "../session/run.js";
import { directory, input, testNow } from "./helpers.js";

test("requests, history, progress and replies preserve names, paths and credential examples", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const prompts: string[] = [];
  const sent: { rootTs: string; text: string }[] = [];
  const statuses: string[] = [];
  const example = [
    "private-test-marker",
    "/home/example/lookout",
    "C:\\Users\\example\\lookout",
    `xoxb-${"a".repeat(25)}`,
    `xapp-${"z".repeat(25)}`,
    `sk-${"q".repeat(24)}`,
    `password=${"p".repeat(20)}`,
    "-----BEGIN PRIVATE KEY-----",
  ].join("\n");
  const answer = `These are test examples.\n${example}`;
  let reply = JSON.stringify({ kind: "reply", text: answer });
  let progress = `I will inspect these examples.\n${example}`;
  let policy = "Operating rules at /home/example/operating.md";
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
  const runner = createT3Runner({
    client,
    sessions,
    projectId: "project",
    instanceId: "instance",
    model: "model",
    policy: async () => policy,
    context: async () => ({
      kind: "available",
      messages: [
        { actor: "UTEAMMATE1", ts: "1900000000.000000", text: example },
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
    publish: async (address, text) => {
      sent.push({ rootTs: address.rootTs, text });
    },
    setStatus: async (_, status) => {
      statuses.push(status);
    },
  });
  const first = input(`Inspect these examples.\n${example}`);
  await oracle.receive(first);
  await oracle.idle();
  assert.deepEqual(sent, [
    { rootTs: first.address.rootTs, text: progress },
    { rootTs: first.address.rootTs, text: answer },
  ]);
  assert.deepEqual(statuses, ["processing", "active"]);
  assert.ok(prompts[0]?.includes('"actor":"UTEAMMATE1"'));
  assert.ok(prompts[0]?.includes("Please inspect the reply handler."));
  assert.ok(prompts[0]?.startsWith(`${policy}\n`));
  assert.ok(prompts[0]?.includes(JSON.stringify(first.text)));
  assert.ok(
    prompts[0]?.includes(
      JSON.stringify({ actor: "UTEAMMATE1", ts: "1900000000.000000", text: example }),
    ),
  );
  assert.ok(prompts[0]?.includes('"truncated":false'));
  assert.equal(sessions.snapshot(first.address)?.deliveries[0]?.kind, "progress");

  reply = '{"kind":"silent"}';
  policy = "Updated operating rules";
  progress = `I will check the follow-up.\n${example}`;
  await oracle.receive(input("Follow up", { address: first.address, route: "thread" }));
  await oracle.idle();
  assert.ok(prompts[1]?.includes(JSON.stringify({ role: "user", text: first.text })));
  assert.ok(prompts[1]?.includes(JSON.stringify({ role: "assistant", text: answer })));
  assert.ok(prompts[1]?.startsWith("Updated operating rules\n"));
  assert.equal(sent.length, 3);
  assert.deepEqual(sent.at(-1), { rootTs: first.address.rootTs, text: progress });

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
