import assert from "node:assert/strict";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";
import { createSlackFiles } from "../dispatcher/files.js";
import { createOracle } from "../dispatcher/index.js";
import { createSlackTransport } from "../dispatcher/slack.js";
import { defaultLimits } from "../session/domain.js";
import { createSessionStore } from "../session/index.js";
import { createT3Runner } from "../session/run.js";
import { directory, input, testNow } from "./helpers.js";

const identity = { user_id: "UORACLE1", team_id: "TTEAM1" };
const promptSchema = z.object({
  files: z.object({
    outputDirectory: z.string(),
    attachments: z.array(z.object({ id: z.string(), status: z.string(), path: z.string() })),
  }),
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

test("Slack files reach the coding session as bytes and generated files return to the original thread", async (t) => {
  const workspace = await directory(t);
  const sessions = createSessionStore({
    directory: join(workspace, "state"),
    limits: defaultLimits,
    now: () => testNow,
  });
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const uploaded: Uint8Array[] = [];
  let run = 0;
  const call = async (method: string, args: Record<string, unknown>) => {
    calls.push({ method, args });
    if (method === "users.info")
      return { user: { id: args.user, team_id: identity.team_id, is_bot: false, deleted: false } };
    if (method === "conversations.replies")
      return {
        messages: [
          {
            user: "UACTOR1",
            ts: "1899999999.000001",
            text: "Earlier image",
            files: [{ id: "FIMAGE1" }],
          },
        ],
      };
    if (method === "files.info")
      return {
        file: {
          id: args.file,
          name: args.file === "FIMAGE1" ? "image.png" : "notes.txt",
          mimetype: args.file === "FIMAGE1" ? "image/png" : "text/plain",
          size: args.file === "FIMAGE1" ? png.length : 5,
          url_private_download: `https://files.slack.com/${args.file}`,
        },
      };
    if (method === "files.getUploadURLExternal")
      return { file_id: "FOUTPUT1", upload_url: "https://files.slack.com/upload/1" };
    return { ok: true };
  };
  const files = createSlackFiles({
    botToken: "test-token",
    call,
    fetch: async (url, init) => {
      assert.equal(init?.redirect, "error");
      if (init?.method === "POST") {
        assert.ok(init.body instanceof Uint8Array);
        uploaded.push(init.body);
        return new Response("OK");
      }
      assert.deepEqual(init?.headers, { Authorization: "Bearer test-token" });
      return new Response(String(url).endsWith("FIMAGE1") ? png : "hello");
    },
  });
  const transport = createSlackTransport({ identity, call, onFault: () => {}, files });
  const client = {
    launch: async () => ({ threadId: "thread", projectId: "project", runId: null }),
    read: async () => ({
      threadId: "thread",
      projectId: "project",
      status: "idle",
      activeRunId: null,
      latestRunId: "run",
      pendingRequestCount: 0,
      worktreePath: workspace,
    }),
    send: async ({ message }) => {
      const data = promptSchema.parse(JSON.parse(message.split("\n\n").at(-1) ?? ""));
      assert.deepEqual(
        data.files.attachments.map((file) => file.id),
        run === 0 ? ["FTEXT1", "FIMAGE1"] : ["FIMAGE1"],
      );
      for (const attachment of data.files.attachments) {
        assert.equal(attachment.status, "available");
        assert.deepEqual(
          await readFile(attachment.path),
          attachment.id === "FIMAGE1" ? png : Buffer.from("hello"),
        );
      }
      await writeFile(join(data.files.outputDirectory, "report.txt"), "generated report");
      run++;
      return { threadId: "thread", runId: "run", delivery: "started" };
    },
    finish: async () => ({
      kind: "completed",
      reply: JSON.stringify({
        kind: "reply",
        text: "Here is the report.",
        files: [{ path: "report.txt", title: "Report" }],
      }),
    }),
    stopAndDrain: async () => {},
  } satisfies Parameters<typeof createT3Runner>[0]["client"];
  const runner = createT3Runner({
    client,
    sessions,
    projectId: "project",
    instanceId: "instance",
    model: "model",
    workspace: async () => workspace,
    policy: async () => "policy",
    context: transport.context,
    profiles: transport.profiles,
    files,
  });
  const oracle = await createOracle({
    sessions,
    runner,
    limits: defaultLimits,
    now: () => testNow,
    publish: transport.publish,
  });
  t.after(() => oracle.close());
  const event = {
    channel: "DDIRECT1",
    channel_type: "im",
    user: "UACTOR1",
    ts: "1900000000.000001",
    subtype: "file_share",
    files: [{ id: "FTEXT1" }],
  };
  await transport.receive({ event, teamId: identity.team_id, listener: "message", oracle });
  await oracle.idle();
  assert.equal(run, 1);
  assert.equal(Buffer.from(uploaded[0] ?? []).toString(), "generated report");
  const result = calls.find(({ method }) => method === "files.completeUploadExternal");
  assert.deepEqual(result?.args, {
    files: [{ id: "FOUTPUT1", title: "Report" }],
    channel_id: event.channel,
    thread_ts: event.ts,
    initial_comment: "Here is the report.",
  });
  assert.equal(
    calls.some(({ method }) => method === "chat.postMessage"),
    false,
  );
  const address = { channel: event.channel, rootTs: event.ts };
  assert.equal(sessions.snapshot(address)?.deliveries[0]?.state, "sent");
  assert.equal(sessions.snapshot(address)?.deliveries[0]?.files?.[0]?.title, "Report");
  const recovered = createSessionStore({
    directory: join(workspace, "state"),
    limits: defaultLimits,
    now: () => testNow,
  });
  await recovered.recover();
  assert.deepEqual(recovered.snapshot(address)?.events[0]?.input.files, [{ id: "FTEXT1" }]);
  await transport.receive({
    event: {
      ...event,
      subtype: undefined,
      files: undefined,
      text: "Use the earlier image",
      ts: "1900000000.000002",
      thread_ts: event.ts,
    },
    teamId: identity.team_id,
    listener: "message",
    oracle,
  });
  await oracle.idle();
  assert.equal(run, 2);
});

test("unavailable Slack files report reasons without discarding the request or leaking credentials", async (t) => {
  const workspace = await directory(t);
  let requests = 0;
  const files = createSlackFiles({
    botToken: "secret",
    call: async (_, args) => {
      if (args.file === "FMISSING1") throw new Error("not allowed");
      return {
        file: {
          id: args.file,
          size: args.file === "FLARGE1" ? 21 * 1024 * 1024 : 1,
          is_external: args.file === "FREMOTE1",
          url_private:
            args.file === "FHOST1"
              ? "https://files.slack.com.evil.test/file"
              : "https://files.slack.com/file",
        },
      };
    },
    fetch: async () => {
      requests++;
      return new Response("refused", { status: 403 });
    },
  });
  const request = input("inspect", {
    files: ["FHOST1", "FMISSING1", "FLARGE1", "FREMOTE1", "FDENIED1"].map((id) => ({ id })),
  });
  const result = await files.prepare(
    request,
    { kind: "unavailable" },
    workspace,
    new AbortController().signal,
  );
  assert.equal(requests, 1);
  assert.deepEqual(result.attachments, [
    { id: "FHOST1", status: "unavailable", reason: "file_host_unsupported" },
    { id: "FMISSING1", status: "unavailable", reason: "file_access_failed" },
    { id: "FLARGE1", status: "unavailable", reason: "file_too_large" },
    { id: "FREMOTE1", status: "unavailable", reason: "remote_file_unsupported" },
    { id: "FDENIED1", status: "unavailable", reason: "file_transfer_failed" },
  ]);
});

test("output files cannot escape the turn directory and failed uploads never complete or retry", async (t) => {
  const workspace = await directory(t);
  const calls: string[] = [];
  const files = createSlackFiles({
    botToken: "secret",
    call: async (method) => {
      calls.push(method);
      return { upload_url: "https://files.slack.com/upload", file_id: "FOUTPUT1" };
    },
    fetch: async () => new Response("failed", { status: 500 }),
  });
  const prepared = await files.prepare(
    input(),
    { kind: "unavailable" },
    workspace,
    new AbortController().signal,
  );
  const outside = join(workspace, "private.txt");
  await writeFile(outside, "private");
  await symlink(outside, join(prepared.outputDirectory, "link.txt"));
  for (const path of [outside, "../../private.txt", "link.txt", "."])
    await assert.rejects(files.resolveOutputs(prepared.outputDirectory, [{ path }]));
  await writeFile(join(prepared.outputDirectory, "result.txt"), "result");
  const outputs = await files.resolveOutputs(prepared.outputDirectory, [{ path: "result.txt" }]);
  await assert.rejects(files.publish(input().address, "result", outputs), /file_upload_failed/);
  assert.deepEqual(calls, ["files.getUploadURLExternal"]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    files.publish(input().address, "result", outputs, controller.signal),
    /turn_stopped/,
  );
  assert.deepEqual(calls, ["files.getUploadURLExternal"]);
});

test("downloads deduplicate files, enforce stream and count limits, and reject redirects", async (t) => {
  const workspace = await directory(t);
  const calls: unknown[] = [];
  let downloads = 0;
  const files = createSlackFiles({
    botToken: "secret",
    call: async (_, args) => {
      calls.push(args.file);
      return {
        file: { id: args.file, size: 1, url_private: `https://files.slack.com/${args.file}` },
      };
    },
    fetch: async (url) => {
      downloads++;
      if (String(url).endsWith("FLARGE1"))
        return new Response(new Uint8Array(20 * 1024 * 1024 + 1));
      if (String(url).endsWith("FREDIRECT1"))
        return new Response(null, { status: 302, headers: { Location: "https://external.test" } });
      return new Response("data");
    },
  });
  const request = input("inspect", {
    files: [
      "FLARGE1",
      "FREDIRECT1",
      ...Array.from({ length: 10 }, (_, index) => `FFILE${index}`),
    ].map((id) => ({ id })),
  });
  const result = await files.prepare(
    request,
    {
      kind: "available",
      messages: [{ actor: "UACTOR1", ts: request.ts, text: "earlier", files: [{ id: "FLARGE1" }] }],
      truncated: false,
    },
    workspace,
    new AbortController().signal,
  );
  assert.equal(calls.length, 10);
  assert.equal(downloads, 10);
  assert.equal(result.attachments.length, 12);
  assert.deepEqual(result.attachments[0], {
    id: "FLARGE1",
    status: "unavailable",
    reason: "file_too_large",
  });
  assert.deepEqual(result.attachments[1], {
    id: "FREDIRECT1",
    status: "unavailable",
    reason: "file_transfer_failed",
  });
  assert.deepEqual(result.attachments.at(-1), {
    id: "FFILE9",
    status: "unavailable",
    reason: "file_count_limit",
  });
});

test("ambiguous file completion is journaled uncertain and never automatically uploaded again", async (t) => {
  const workspace = await directory(t);
  const sessions = createSessionStore({
    directory: join(workspace, "state"),
    limits: defaultLimits,
    now: () => testNow,
  });
  const calls: string[] = [];
  const files = createSlackFiles({
    botToken: "secret",
    call: async (method) => {
      calls.push(method);
      if (method === "files.completeUploadExternal")
        throw new Error("connection lost after completion");
      return { upload_url: "https://files.slack.com/upload", file_id: "FOUTPUT1" };
    },
    fetch: async () => new Response("OK"),
  });
  const prepared = await files.prepare(
    input(),
    { kind: "unavailable" },
    workspace,
    new AbortController().signal,
  );
  await writeFile(join(prepared.outputDirectory, "result.txt"), "result");
  const outputs = await files.resolveOutputs(prepared.outputDirectory, [{ path: "result.txt" }]);
  const faults: string[] = [];
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    onFault: (code) => faults.push(code),
    runner: { run: async () => ({ kind: "reply", text: "Result", files: outputs }) },
    publish: async (address, text, attachments, signal) => {
      assert.ok(attachments);
      await files.publish(address, text, attachments, signal);
    },
  });
  t.after(() => oracle.close());
  const request = input();
  await oracle.receive(request);
  await oracle.idle();
  oracle.retryPending();
  await oracle.idle();
  assert.deepEqual(calls, ["files.getUploadURLExternal", "files.completeUploadExternal"]);
  assert.deepEqual(faults, ["delivery_uncertain"]);
  assert.equal(sessions.snapshot(request.address)?.deliveries[0]?.state, "uncertain");
  const recovered = createSessionStore({
    directory: join(workspace, "state"),
    limits: defaultLimits,
    now: () => testNow,
  });
  await recovered.recover();
  assert.equal(recovered.pending().length, 0);
  assert.equal(recovered.snapshot(request.address)?.deliveries[0]?.state, "uncertain");
});
