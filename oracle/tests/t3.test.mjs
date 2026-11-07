import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { T3Client, T3Error, T3UnsafeToReleaseError, connectT3 } from "../session/t3.ts";

const threadId = "thread-oracle";
const runId = "run-oracle";
const snapshot = (active = null, state = "completed", items = []) => ({
  thread: {
    threadId,
    projectId: "project",
    status: state,
    activeRunId: active,
    latestRunId: runId,
    pendingRequestCount: 0,
    worktreePath: "/workspace/oracle",
  },
  recentRuns: [{ runId, status: state }],
  items,
  nextPosition: null,
  hasMore: false,
});

test("creates an idle visible thread before any coding message", async () => {
  const calls = [];
  const client = new T3Client({
    async call(name, input) {
      calls.push({ name, input });
      return { threadId, projectId: "project", runId: null };
    },
  });
  const created = await client.launch({
    projectId: "project",
    title: "Slack request",
    requestId: "session-key",
    modelSelection: { instanceId: "codex", model: "model" },
    workspace: "/workspace/oracle",
  });
  assert.equal(created.runId, null);
  assert.equal(calls[0].name, "t3_thread_launch");
  assert.equal(Object.hasOwn(calls[0].input, "message"), false);
  assert.equal(calls[0].input.clientRequestId, "session-key");
  assert.deepEqual(calls[0].input.modelSelection, {
    instanceId: "codex",
    model: "model",
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "priority" },
    ],
  });
  assert.deepEqual(calls[0].input.workspaceStrategy, {
    type: "existing_worktree",
    worktreePath: "/workspace/oracle",
  });
});

test("sends into the saved thread with stable request id", async () => {
  const client = new T3Client({
    async call(name, input) {
      if (name === "t3_thread_configure") {
        assert.deepEqual(input, {
          threadId,
          modelSelection: {
            instanceId: "codex",
            model: "model",
            options: [
              { id: "reasoningEffort", value: "high" },
              { id: "serviceTier", value: "priority" },
            ],
          },
        });
        return { sequence: 1 };
      }
      assert.equal(name, "t3_thread_send");
      assert.deepEqual(input, {
        threadId,
        message: "Please edit the file",
        clientRequestId: "delivery-key",
        mode: "queue",
      });
      return { threadId, runId, delivery: "started" };
    },
  });
  await client.send({
    threadId,
    message: "Please edit the file",
    requestId: "delivery-key",
    modelSelection: { instanceId: "codex", model: "model" },
  });
});

for (const failure of ["unavailable", "unacknowledged"]) {
  test(`does not send a coding message when high effort and fast mode are ${failure}`, async () => {
    let sends = 0;
    const client = new T3Client({
      async call(name) {
        if (name === "t3_thread_configure") {
          if (failure === "unavailable") throw new T3Error();
          return {};
        }
        sends++;
        return { threadId, runId, delivery: "started" };
      },
    });
    await assert.rejects(
      client.send({
        threadId,
        message: "Please edit the file",
        requestId: "delivery-key",
        modelSelection: { instanceId: "codex", model: "model" },
      }),
    );
    assert.equal(sends, 0);
  });
}

test("reads final reply for exact run and joins a truncated message", async () => {
  const client = new T3Client({
    async call(name, input) {
      if (name === "t3_thread_wait") {
        assert.equal(input.runId, runId);
        assert.equal(input.untilDelegatedWorkSettled, true);
        return { threadId, runId, status: "completed", timedOut: false };
      }
      assert.equal(name, "t3_thread_read");
      if ("textOffset" in input)
        return snapshot(null, "completed", [
          {
            itemId: "reply",
            runId,
            type: "assistant_message",
            text: "complete",
            textTruncated: false,
          },
        ]);
      return snapshot(null, "completed", [
        {
          itemId: "old",
          runId: "other-run",
          type: "assistant_message",
          text: "wrong reply",
          textTruncated: false,
        },
        {
          itemId: "reply",
          runId,
          type: "assistant_message",
          text: "Work ",
          textTruncated: true,
          nextTextOffset: 5,
        },
      ]);
    },
  });
  assert.deepEqual(await client.finish({ threadId, runId, signal: new AbortController().signal }), {
    kind: "completed",
    reply: "Work complete",
  });
});

test("relays structured progress once per item and never forwards raw commentary", async () => {
  let waits = 0;
  const updates = [];
  const client = new T3Client({
    async call(name) {
      if (name === "t3_thread_wait") {
        waits++;
        return {
          threadId,
          runId,
          status: waits < 2 ? "running" : "completed",
          timedOut: waits < 2,
        };
      }
      const messages = [
        {
          itemId: "old",
          runId: "old-run",
          type: "assistant_message",
          text: '{"kind":"progress","text":"Old update"}',
          textTruncated: false,
        },
        {
          itemId: "raw",
          runId,
          type: "assistant_message",
          text: "Private internal commentary",
          textTruncated: false,
        },
        {
          itemId: "progress",
          runId,
          type: "assistant_message",
          text: '{"kind":"progress","text":"I am tracing the thread handler."}',
          textTruncated: false,
        },
      ];
      if (waits === 2)
        messages.push({
          itemId: "final",
          runId,
          type: "assistant_message",
          text: '{"kind":"reply","text":"Fixed."}',
          textTruncated: false,
        });
      return snapshot(waits < 2 ? runId : null, waits < 2 ? "running" : "completed", messages);
    },
  });
  const result = await client.finish({
    threadId,
    runId,
    signal: new AbortController().signal,
    onProgress: async (text) => {
      updates.push(text);
    },
  });
  assert.deepEqual(updates, ["I am tracing the thread handler."]);
  assert.equal(result.reply, '{"kind":"reply","text":"Fixed."}');
});

test("an abort resolves only after actual server stop reaches terminal state", async () => {
  const controller = new AbortController();
  controller.abort();
  let stops = 0;
  let sameRequestId;
  const client = new T3Client(
    {
      async call(name, input) {
        if (name === "t3_thread_interrupt") {
          assert.equal(input.stop, true);
          if (sameRequestId === undefined) sameRequestId = input.clientRequestId;
          assert.equal(input.clientRequestId, sameRequestId);
          stops++;
          return { threadId, runId, status: "interrupt_requested" };
        }
        if (name === "t3_thread_wait")
          return {
            threadId,
            runId,
            status: stops < 2 ? "running" : "interrupted",
            timedOut: stops < 2,
          };
        return snapshot(stops < 2 ? runId : null, stops < 2 ? "running" : "interrupted");
      },
    },
    { retryDelayMs: 1 },
  );
  await assert.rejects(client.finish({ threadId, runId, signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(stops, 2);
});

test("unproven cancellation fails with a distinct fatal lock outcome", async () => {
  const client = new T3Client(
    {
      async call() {
        throw new Error("secret server detail");
      },
    },
    { drainTimeoutMs: 1, retryDelayMs: 1 },
  );
  await assert.rejects(
    client.stopAndDrain({ threadId }),
    (error) => error instanceof T3UnsafeToReleaseError && !error.message.includes("secret"),
  );
});

test("cancellation deadline also bounds a server call that never answers", async () => {
  const client = new T3Client(
    {
      call() {
        return new Promise(() => {});
      },
    },
    { drainTimeoutMs: 5 },
  );
  await assert.rejects(client.stopAndDrain({ threadId }), T3UnsafeToReleaseError);
});

test("abort sends Stop while the previous wait is still pending", async () => {
  const controller = new AbortController();
  let releaseWait;
  let beganWait;
  const started = new Promise((resolve) => {
    beganWait = resolve;
  });
  let waits = 0;
  let stopDuringWait = false;
  const client = new T3Client({
    async call(name) {
      if (name === "t3_thread_wait") {
        waits++;
        if (waits === 1) {
          beganWait();
          return new Promise((resolve) => {
            releaseWait = resolve;
          });
        }
        return { threadId, runId, status: "interrupted", timedOut: false };
      }
      if (name === "t3_thread_interrupt") {
        stopDuringWait = true;
        releaseWait({ threadId, runId, status: "interrupted", timedOut: false });
        return { threadId, runId, status: "interrupt_requested" };
      }
      return snapshot(null, "interrupted");
    },
  });
  const finish = client.finish({ threadId, runId, signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(finish, { name: "AbortError" });
  assert.equal(stopDuringWait, true);
});

test("refuses repeated continuation offsets and safely drains the completed run", async () => {
  let stops = 0;
  const client = new T3Client({
    async call(name, input) {
      if (name === "t3_thread_interrupt") {
        stops++;
        return { threadId, runId, status: "no_active_run" };
      }
      if (name === "t3_thread_wait")
        return { threadId, runId, status: "completed", timedOut: false };
      if (input.limit === 1) return snapshot();
      return snapshot(null, "completed", [
        {
          itemId: "reply",
          runId,
          type: "assistant_message",
          text: "text",
          textTruncated: true,
          nextTextOffset: 4,
        },
      ]);
    },
  });
  await assert.rejects(
    client.finish({ threadId, runId, signal: new AbortController().signal }),
    T3Error,
  );
  assert.equal(stops, 1);
});

test("HTTP client pins high effort and fast mode on launch and every turn through MCP and SSE", async () => {
  const names = [];
  let effort = "low";
  let tier = "default";
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(request.headers.authorization, "Bearer private-test-token");
    if (body.method === "initialize") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "MCP-Session-Id": "session-oracle",
      });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            serverInfo: { name: "test", version: "1" },
          },
        }),
      );
      return;
    }
    assert.equal(request.headers["mcp-session-id"], "session-oracle");
    if (body.method === "notifications/initialized") {
      response.writeHead(202);
      response.end();
      return;
    }
    names.push(body.params.name);
    const args = body.params.arguments;
    let result = snapshot();
    if (body.params.name === "t3_thread_launch") {
      assert.deepEqual(args.modelSelection.options, [
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "priority" },
      ]);
      result = { threadId, projectId: "project", runId: null };
    }
    if (body.params.name === "t3_thread_configure") {
      effort = args.modelSelection.options.find((option) => option.id === "reasoningEffort")?.value;
      tier = args.modelSelection.options.find((option) => option.id === "serviceTier")?.value;
      result = { sequence: names.length };
    }
    if (body.params.name === "t3_thread_send") {
      assert.equal(effort, "high");
      assert.equal(tier, "priority");
      result = { threadId, runId, delivery: "started" };
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: result, content: [] } })}\n\n`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const client = await connectT3({
      endpoint: `http://127.0.0.1:${address.port}/mcp`,
      token: "private-test-token",
    });
    assert.equal((await client.read({ threadId })).threadId, threadId);
    const modelSelection = { instanceId: "codex", model: "gpt-6.1-sol" };
    await client.launch({
      projectId: "project",
      title: "Slack request",
      requestId: "session-key",
      modelSelection,
      workspace: "/workspace/oracle",
    });
    for (const requestId of ["first-turn", "follow-up"]) {
      effort = "low";
      tier = "default";
      await client.send({ threadId, message: "Please edit the file", requestId, modelSelection });
    }
    assert.deepEqual(names, [
      "t3_thread_read",
      "t3_thread_launch",
      "t3_thread_configure",
      "t3_thread_send",
      "t3_thread_configure",
      "t3_thread_send",
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("refuses external endpoints before sending the credential", async () => {
  await assert.rejects(
    connectT3({ endpoint: "https://example.invalid/mcp", token: "private-test-token" }),
    T3Error,
  );
});
