import assert from "node:assert/strict";
import test from "node:test";
import { createSlackTransport, routeSlack } from "../dispatcher/slack.js";
import { createOracle, type Oracle } from "../dispatcher/index.js";
import { defaultLimits, type Incoming } from "../session/domain.js";
import { createSessionStore } from "../session/index.js";
import { deferred, directory, testNow, untilAborted } from "./helpers.js";

const identity = { user_id: "UORACLE1", team_id: "TTEAM1" };
const event = {
  channel: "CCHAN1",
  user: "UACTOR1",
  ts: "1900000000.000001",
  text: "<@UORACLE1> inspect <@UOTHER1>",
};
const stoppedEvent = {
  type: "agent_session_stopped",
  channel: event.channel,
  thread_ts: event.ts,
  user: "UTEAMMATE1",
  event_ts: "1900000000.000004",
  streaming_message_ts: [],
};
const route = (wire: unknown, owns = false, listener: "mention" | "message" = "message") =>
  routeSlack({ event: wire, listener, identity, teamId: identity.team_id, owns: () => owns });

test("native stop on an old thread uses the current event timestamp", async (t) => {
  const address = { channel: event.channel, rootTs: "1700000000.000001" };
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    publish: async () => {},
    runner: { run: async () => ({ kind: "silent" }) },
  });
  t.after(() => oracle.close());
  await oracle.receive({
    address,
    ts: event.ts,
    actor: event.user,
    text: "Inspect",
    route: "direct",
  });
  await oracle.idle();
  const transport = createSlackTransport({
    identity,
    onFault: () => {},
    call: async (method, args) => {
      assert.equal(method, "users.info");
      return { user: { id: args.user, team_id: identity.team_id, is_bot: false, deleted: false } };
    },
  });
  await transport.receive({
    event: { ...stoppedEvent, thread_ts: address.rootTs },
    listener: "agent_session_stopped",
    teamId: identity.team_id,
    oracle,
  });
  assert.equal(sessions.snapshot(address)?.stopped, true);
  assert.deepEqual(sessions.snapshot(address)?.events.at(-1)?.input, {
    address,
    ts: stoppedEvent.event_ts,
    actor: stoppedEvent.user,
    text: "stop",
    route: "thread",
  });
});

test("mention and message listeners produce the same canonical input", () => {
  assert.deepEqual(route(event, false, "mention"), route(event));
  assert.equal(route(event)?.text, "inspect <@UOTHER1>");
});

test("routing rejects self, foreign workspaces, bots and subtypes", () => {
  for (const extra of [
    { user: "UORACLE1" },
    { team: "TFOREIGN1" },
    { user_team: "TFOREIGN1" },
    { bot_id: "BBOT1" },
    { bot_profile: {} },
    { subtype: "message_changed" },
  ])
    assert.equal(route({ ...event, ...extra }), undefined);
  assert.equal(
    routeSlack({ event, listener: "mention", identity, teamId: "TFOREIGN1", owns: () => true }),
    undefined,
  );
});

test("ambient messages and unowned replies remain silent", () => {
  assert.equal(route({ ...event, text: "general conversation" }, true), undefined);
  assert.equal(route({ ...event, text: "reply", thread_ts: "1900000000.000000" }), undefined);
  assert.equal(
    route({ ...event, text: "reply", thread_ts: "1900000000.000000" }, true)?.route,
    "thread",
  );
});

test("direct messages establish a session without a mention", () => {
  const routed = route({ ...event, channel: "DDIRECT1", channel_type: "im", text: "Inspect" });
  assert.equal(routed?.route, "direct");
  assert.equal(routed?.address.rootTs, event.ts);
});

test("edited, malformed, and unmatched mention payloads are ignored", () => {
  assert.equal(route({ ...event, ts: "bad" }), undefined);
  assert.equal(route({ ...event, text: "<@UOTHER1> inspect" }, false, "mention"), undefined);
  assert.equal(route({ ...event, user: undefined }), undefined);
});

test("another workspace teammate can continue an owned thread", () => {
  assert.equal(
    route({ ...event, user: "UTEAMMATE1", text: "Please inspect it", thread_ts: event.ts }, true)
      ?.actor,
    "UTEAMMATE1",
  );
});

test("a bare mention asks Oracle to use the preceding thread context", () => {
  assert.equal(
    route({ ...event, text: "<@UORACLE1>", thread_ts: event.ts }, true)?.text,
    "Respond to the latest request in this Slack thread.",
  );
});

test("membership verification accepts teammates and refuses external people and bots", async () => {
  const received: Incoming[] = [];
  const oracle: Oracle = {
    owns: () => true,
    receive: async (request) => {
      received.push(request);
      return "accepted";
    },
    idle: async () => {},
    retryPending: () => {},
    close: async () => {},
  };
  const transport = createSlackTransport({
    identity,
    onFault: () => {},
    call: async (method, args) => {
      assert.equal(method, "users.info");
      return {
        user: {
          id: args.user,
          team_id: args.user === "UFOREIGN1" ? "TFOREIGN1" : identity.team_id,
          is_bot: args.user === "UBOT1",
          deleted: args.user === "UDELETED1",
          is_stranger: args.user === "USTRANGER1",
        },
      };
    },
  });
  for (const user of ["UTEAMMATE1", "UFOREIGN1", "UBOT1", "UDELETED1", "USTRANGER1"])
    await transport.receive({
      event: { ...event, user },
      teamId: identity.team_id,
      listener: "mention",
      oracle,
    });
  assert.deepEqual(
    received.map((request) => request.actor),
    ["UTEAMMATE1"],
  );
});

test("thread context includes the preceding request and excludes later messages", async () => {
  const request = route({ ...event, text: "<@UORACLE1>" });
  assert.ok(request);
  const calls: Record<string, unknown>[] = [];
  const transport = createSlackTransport({
    identity,
    onFault: () => {},
    call: async (method, args) => {
      assert.equal(method, "conversations.replies");
      calls.push(args);
      if (!args.cursor)
        return {
          messages: [{ user: "UTEAMMATE1", ts: "1900000000.000000", text: "Inspect the bug" }],
          has_more: true,
          response_metadata: { next_cursor: "next" },
        };
      return {
        messages: [
          { user: event.user, ts: event.ts, text: event.text },
          { user: event.user, ts: "1900000000.000002", text: "A later request" },
        ],
        has_more: false,
      };
    },
  });
  assert.deepEqual(await transport.context(request), {
    kind: "available",
    messages: [{ actor: "UTEAMMATE1", ts: "1900000000.000000", text: "Inspect the bug" }],
    truncated: false,
  });
  assert.equal(calls[1]?.cursor, "next");
  assert.equal(calls[0]?.latest, request.ts);
});

test("context is bounded and a history refusal does not erase the current request", async () => {
  const request = route({ ...event, ts: "1900000001.000000" });
  assert.ok(request);
  let failed = false;
  const transport = createSlackTransport({
    identity,
    onFault: () => {},
    call: async () => {
      if (failed) throw new Error("missing_scope");
      return {
        messages: Array.from({ length: 40 }, (_, index) => ({
          user: event.user,
          ts: `1900000000.${String(index).padStart(6, "0")}`,
          text: `Request ${index}`,
        })),
      };
    },
  });
  const context = await transport.context(request);
  assert.equal(context.kind, "available");
  if (context.kind === "available") {
    assert.equal(context.truncated, true);
    assert.equal(context.messages.length, defaultLimits.maxHistoryTurns);
    assert.equal(context.messages.at(-1)?.text, "Request 39");
  }
  failed = true;
  assert.deepEqual(await transport.context(request), { kind: "unavailable" });
});

test("Slack results and status updates retain the originating thread", async () => {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const transport = createSlackTransport({
    identity,
    onFault: () => {},
    call: async (method, args) => {
      calls.push({ method, args });
      return { ok: true };
    },
  });
  const address = { channel: event.channel, rootTs: event.ts };
  await transport.setStatus(address, "processing");
  await transport.publish(address, "The handler is fixed.");
  await transport.setStatus(address, "active");
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["agents.sessions.setStatus", "chat.postMessage", "agents.sessions.setStatus"],
  );
  assert.ok(calls.every(({ args }) => args.thread_ts === event.ts));
  assert.equal(calls[1]?.args.channel, event.channel);
  assert.equal(calls[1]?.args.text, "The handler is fixed.");
  assert.equal(calls[2]?.args.status, "active");
  assert.ok(calls.every(({ args }) => args.blocks === undefined));
});

test("native stop cancels running and queued work while another thread keeps running", async (t) => {
  const sessions = createSessionStore({
    directory: await directory(t),
    limits: defaultLimits,
    now: () => testNow,
  });
  const started = deferred<void>();
  const otherStarted = deferred<void>();
  const finishOther = deferred<void>();
  const runs: string[] = [];
  const messages: { method: string; args: Record<string, unknown> }[] = [];
  let activeSignal: AbortSignal | undefined;
  let otherSignal: AbortSignal | undefined;
  const transport = createSlackTransport({
    identity,
    onFault: () => {},
    call: async (method, args) => {
      messages.push({ method, args });
      return method === "users.info"
        ? { user: { id: args.user, team_id: identity.team_id, is_bot: false, deleted: false } }
        : { ok: true };
    },
  });
  const oracle = await createOracle({
    sessions,
    limits: defaultLimits,
    now: () => testNow,
    publish: transport.publish,
    setStatus: transport.setStatus,
    runner: {
      async run({ input, signal }) {
        runs.push(input.text);
        if (input.text === "First") {
          activeSignal = signal;
          assert.ok(messages.some(({ args }) => args.status === "processing"));
          assert.equal(
            messages.some(({ method }) => method === "chat.postMessage"),
            false,
          );
          started.resolve();
          await untilAborted(signal);
          return { kind: "reply", text: "Late result" };
        }
        if (input.text === "Other thread") {
          otherSignal = signal;
          otherStarted.resolve();
          await finishOther.promise;
        }
        return { kind: "reply", text: input.text };
      },
    },
  });
  t.after(() => {
    finishOther.resolve();
    return oracle.close();
  });
  const receive = (wire: unknown) =>
    transport.receive({ event: wire, teamId: identity.team_id, listener: "message", oracle });
  const stop = () =>
    transport.receive({
      event: stoppedEvent,
      teamId: identity.team_id,
      listener: "agent_session_stopped",
      oracle,
    });
  await receive({ ...event, text: "<@UORACLE1> First" });
  await started.promise;
  await receive({ ...event, text: "Queued", ts: "1900000000.000002", thread_ts: event.ts });
  await receive({ ...event, text: "<@UORACLE1> Other thread", ts: "1900000000.000003" });
  await otherStarted.promise;
  await stop();
  await stop();
  assert.equal(activeSignal?.aborted, true);
  assert.equal(otherSignal?.aborted, false);
  finishOther.resolve();
  await oracle.idle();
  assert.equal(activeSignal?.aborted, true);
  assert.deepEqual(runs, ["First", "Other thread"]);
  assert.equal(sessions.snapshot({ channel: event.channel, rootTs: event.ts })?.stopped, true);
  assert.ok(
    sessions
      .snapshot({ channel: event.channel, rootTs: event.ts })
      ?.events.some((item) => item.input.text === "Queued" && item.status === "cancelled"),
  );
  const replies = messages.filter(({ method }) => method === "chat.postMessage");
  assert.equal(
    replies.some(({ args }) => args.text === "Late result"),
    false,
  );
  const confirmations = replies.filter(({ args }) => String(args.text).startsWith("Stopped."));
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0]?.args.thread_ts, event.ts);
  assert.ok(
    messages.some(
      ({ method, args }) =>
        method === "agents.sessions.setStatus" &&
        args.thread_ts === event.ts &&
        args.status === "active",
    ),
  );
  await receive({
    ...event,
    text: "Unmentioned follow-up",
    ts: "1900000000.000005",
    thread_ts: event.ts,
  });
  await receive({
    ...event,
    text: "<@UORACLE1> Resume",
    ts: "1900000000.000006",
    thread_ts: event.ts,
  });
  await oracle.idle();
  await stop();
  assert.deepEqual(runs, ["First", "Other thread", "Resume"]);
  assert.equal(sessions.snapshot({ channel: event.channel, rootTs: event.ts })?.stopped, false);
});

test("native stop events reject foreign members, bots, malformed payloads and unowned threads", async () => {
  const received: Incoming[] = [];
  const oracle: Oracle = {
    owns: (address) => address.channel === event.channel && address.rootTs === event.ts,
    receive: async (request) => {
      received.push(request);
      return "stopped";
    },
    idle: async () => {},
    retryPending: () => {},
    close: async () => {},
  };
  const transport = createSlackTransport({
    identity,
    onFault: () => {},
    call: async (method, args) => {
      assert.equal(method, "users.info");
      return {
        user: {
          id: args.user,
          team_id: args.user === "UFOREIGN1" ? "TFOREIGN1" : identity.team_id,
          is_bot: args.user === "UBOT1",
          deleted: args.user === "UDELETED1",
          is_stranger: args.user === "USTRANGER1",
        },
      };
    },
  });
  const receive = (wire: unknown, teamId = identity.team_id) =>
    transport.receive({ event: wire, teamId, listener: "agent_session_stopped", oracle });
  for (const extra of [
    { type: "block_actions" },
    { user: "UFOREIGN1" },
    { user: "UBOT1" },
    { user: "UDELETED1" },
    { user: "USTRANGER1" },
    { user: identity.user_id },
    { user: undefined },
    { channel: "COTHER1" },
    { thread_ts: "1900000000.000002" },
    { thread_ts: "invalid" },
    { event_ts: "invalid" },
    { event_ts: undefined },
  ])
    await receive({ ...stoppedEvent, ...extra });
  await receive(stoppedEvent, "TFOREIGN1");
  assert.deepEqual(received, []);
  await receive(stoppedEvent);
  assert.deepEqual(received, [
    {
      address: { channel: event.channel, rootTs: event.ts },
      ts: "1900000000.000004",
      actor: "UTEAMMATE1",
      text: "stop",
      route: "thread",
    },
  ]);
});

test("native status failures do not post custom stop controls", async () => {
  const calls: string[] = [];
  const transport = createSlackTransport({
    identity,
    onFault: () => {},
    call: async (method) => {
      calls.push(method);
      if (method === "agents.sessions.setStatus") throw new Error("missing_scope");
      return { ok: true };
    },
  });
  await assert.rejects(
    transport.setStatus({ channel: event.channel, rootTs: event.ts }, "processing"),
    /missing_scope/,
  );
  assert.deepEqual(calls, ["agents.sessions.setStatus"]);
});
