import assert from "node:assert/strict";
import test from "node:test";
import { createSlackTransport, routeSlack } from "../dispatcher/slack.js";
import type { Oracle } from "../dispatcher/index.js";
import { defaultLimits, type Incoming } from "../session/domain.js";

const identity = { user_id: "UORACLE1", team_id: "TTEAM1" };
const event = {
  channel: "CCHAN1",
  user: "UACTOR1",
  ts: "1900000000.000001",
  text: "<@UORACLE1> inspect <@UOTHER1>",
};
const route = (wire: unknown, owns = false, listener: "mention" | "message" = "message") =>
  routeSlack({ event: wire, listener, identity, teamId: identity.team_id, owns: () => owns });

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
  assert.equal(calls[2]?.args.status, "active");
});
