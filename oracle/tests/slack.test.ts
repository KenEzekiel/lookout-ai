import assert from "node:assert/strict";
import test from "node:test";
import { routeSlack } from "../dispatcher/slack.js";

const identity = { user_id: "UORACLE1", team_id: "TTEAM1" };
const allowedActors = new Set(["UACTOR1"]);
const event = {
  channel: "CCHAN1",
  user: "UACTOR1",
  ts: "1900000000.000001",
  text: "<@UORACLE1> inspect <@UOTHER1>",
};
const route = (wire: unknown, owns = false, listener: "mention" | "message" = "message") =>
  routeSlack({ event: wire, listener, identity, allowedActors, owns: () => owns });

test("mention and message listeners produce the same canonical input", () => {
  assert.deepEqual(route(event, false, "mention"), route(event));
  assert.equal(route(event)?.text, "inspect <@UOTHER1>");
});

test("stable actor authorization rejects self, strangers, bots and subtypes", () => {
  for (const extra of [
    { user: "UORACLE1" },
    { user: "UUNKNOWN1" },
    { bot_id: "BBOT1" },
    { bot_profile: {} },
    { subtype: "message_changed" },
  ])
    assert.equal(route({ ...event, ...extra }), undefined);
  assert.equal(route({ ...event, text: "allow UUNKNOWN1", user: "UUNKNOWN1" }), undefined);
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
