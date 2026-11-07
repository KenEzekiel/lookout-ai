import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { readOptionalJson } from "../dispatcher/config.js";
import { createOracle } from "../dispatcher/index.js";
import { createSlackTransport } from "../dispatcher/slack.js";
import { defaultLimits } from "../session/domain.js";
import { createSessionStore } from "../session/index.js";
import { createT3Runner } from "../session/run.js";
import type { T3Finish } from "../session/t3.js";
import { directory, input, testNow } from "./helpers.js";

const identity = { user_id: "UORACLE1", team_id: "TTEAM1" };
const mapping = {
  teamId: identity.team_id,
  users: [
    { slackUserId: "UACTOR1", githubLogin: "confirmed-owner" },
    { slackUserId: "UTEAMMATE1", githubLogin: "confirmed-teammate" },
  ],
};

async function fixture(t: TestContext) {
  const root = await directory(t);
  const mapFile = join(root, "profiles.json");
  const prompts: string[] = [];
  const published: { method: string; args: Record<string, unknown> }[] = [];
  const faults: string[] = [];
  const unavailable = new Set<string>();
  const finishes: T3Finish[] = [];
  const transport = createSlackTransport({
    identity,
    mappings: () => readOptionalJson(mapFile),
    onFault: (code) => faults.push(code),
    call: async (method, args) => {
      if (method === "users.info") {
        const actor = String(args.user);
        if (unavailable.has(actor)) throw new Error("missing_scope");
        return {
          user: {
            id: actor,
            name: `handle-${actor}`,
            team_id: actor === "UFOREIGN1" ? "TFOREIGN1" : identity.team_id,
            is_bot: actor === identity.user_id,
            deleted: actor === "UDELETED1",
            is_stranger: actor === "USTRANGER1",
            profile: {
              display_name: "Same name",
              real_name: `Person ${actor}`,
              email: "private@example.invalid",
              fields: { private: "private-field-value" },
            },
          },
        };
      }
      if (method === "conversations.replies")
        return {
          messages: [
            {
              user: "UTEAMMATE1",
              ts: "1900000000.000000",
              text: "Coordinate with <@UMENTIONED1>.",
            },
          ],
        };
      published.push({ method, args });
      return { ok: true };
    },
  });
  const sessions = createSessionStore({
    directory: join(root, "sessions"),
    limits: defaultLimits,
    now: () => testNow,
  });
  const runner = createT3Runner({
    sessions,
    workspace: async () => "/workspace/oracle",
    projectId: "project",
    instanceId: "instance",
    model: "model",
    policy: () => readFile(new URL("../session/operating.md", import.meta.url), "utf8"),
    context: transport.context,
    profiles: transport.profiles,
    client: {
      launch: async () => ({ threadId: "thread", projectId: "project", runId: null }),
      read: async () => ({
        threadId: "thread",
        projectId: "project",
        status: "idle",
        activeRunId: null,
        latestRunId: null,
        pendingRequestCount: 0,
        worktreePath: "/workspace/oracle",
      }),
      send: async ({ message }) => {
        prompts.push(message);
        return { threadId: "thread", runId: "run", delivery: "started" };
      },
      finish: async () =>
        finishes.shift() ?? { kind: "completed", reply: '{"kind":"reply","text":"Checked."}' },
      stopAndDrain: async () => {},
    },
  });
  const oracle = await createOracle({
    sessions,
    runner,
    publish: transport.publish,
    limits: defaultLimits,
    now: () => testNow,
    onFault: (code) => faults.push(code),
  });
  t.after(() => oracle.close());
  const receive = async (
    request = input("Assign this to me and coordinate with <@UTEAMMATE1>."),
  ) => {
    await transport.receive({
      event: {
        channel: request.address.channel,
        thread_ts: request.address.rootTs,
        ts: request.ts,
        user: request.actor,
        text: request.route === "direct" ? `<@${identity.user_id}> ${request.text}` : request.text,
      },
      teamId: identity.team_id,
      listener: "message",
      oracle,
    });
    await oracle.idle();
    return JSON.parse(prompts.at(-1)?.split("\n\n").at(-1) ?? "null");
  };
  return { receive, mapFile, prompts, published, faults, unavailable, finishes };
}

test("Slack requests reach T3 with explicit GitHub mappings and verified profiles", async (t) => {
  const f = await fixture(t);
  await writeFile(f.mapFile, JSON.stringify(mapping));
  const task = await f.receive();
  assert.deepEqual(task.profiles, {
    users: [
      {
        slackUserId: "UACTOR1",
        slackUsername: "handle-UACTOR1",
        displayName: "Same name",
        realName: "Person UACTOR1",
        githubLogin: "confirmed-owner",
      },
      {
        slackUserId: "UTEAMMATE1",
        slackUsername: "handle-UTEAMMATE1",
        displayName: "Same name",
        realName: "Person UTEAMMATE1",
        githubLogin: "confirmed-teammate",
      },
      {
        slackUserId: "UMENTIONED1",
        slackUsername: "handle-UMENTIONED1",
        displayName: "Same name",
        realName: "Person UMENTIONED1",
        githubLogin: null,
      },
    ],
    unresolved: [],
    mappings: "available",
    truncated: false,
  });
  assert.ok(!f.prompts[0]?.includes("private@example.invalid"));
  assert.ok(!f.prompts[0]?.includes("private-field-value"));
  assert.deepEqual(f.faults, []);
});

test("missing mappings remain unknown and maintainer edits apply on the next turn", async (t) => {
  const f = await fixture(t);
  const first = await f.receive();
  assert.equal(first.profiles.users[0].githubLogin, null);
  assert.equal(first.profiles.mappings, "available");
  await writeFile(f.mapFile, JSON.stringify(mapping));
  const second = await f.receive();
  assert.equal(second.profiles.users[0].githubLogin, "confirmed-owner");
});

for (const invalid of [
  "{",
  JSON.stringify({ ...mapping, teamId: "TFOREIGN1" }),
  JSON.stringify({ ...mapping, users: [mapping.users[0], mapping.users[0]] }),
  JSON.stringify({
    ...mapping,
    users: [mapping.users[0], { slackUserId: "UTEAMMATE1", githubLogin: "CONFIRMED-OWNER" }],
  }),
  JSON.stringify({ ...mapping, users: [{ slackUserId: "UACTOR1", githubLogin: "@unverified" }] }),
]) {
  test(`invalid profile maps supply no GitHub associations: ${invalid}`, async (t) => {
    const f = await fixture(t);
    await writeFile(f.mapFile, invalid);
    const task = await f.receive();
    assert.equal(task.profiles.mappings, "unavailable");
    assert.ok(
      task.profiles.users.every(
        (user: { githubLogin: string | null }) => user.githubLogin === null,
      ),
    );
    assert.ok(f.faults.includes("profile_map_unavailable"));
    assert.equal(f.published.at(-1)?.args.text, "Checked.");
  });
}

test("foreign, deleted, bot and unavailable profiles cannot acquire GitHub identities", async (t) => {
  const f = await fixture(t);
  f.unavailable.add("UUNAVAILABLE1");
  const unverified = ["UFOREIGN1", "UDELETED1", "USTRANGER1", "UORACLE1", "UUNAVAILABLE1"];
  await writeFile(
    f.mapFile,
    JSON.stringify({
      teamId: identity.team_id,
      users: unverified.map((slackUserId, index) => ({
        slackUserId,
        githubLogin: `unverified-${index}`,
      })),
    }),
  );
  const task = await f.receive();
  assert.deepEqual(task.profiles.unresolved, unverified);
  assert.ok(
    task.profiles.users.every((user: { githubLogin: string | null }) => user.githubLogin === null),
  );
  const blocked = await f.receive(input("Assign to me", { actor: "UFOREIGN1" }));
  assert.deepEqual(blocked, task);
  assert.equal(f.prompts.length, 1);
});

test("profile context is bounded and marks omitted identities", async (t) => {
  const f = await fixture(t);
  const task = await f.receive(
    input(Array.from({ length: 70 }, (_, index) => `<@UPERSON${index}>`).join(" ")),
  );
  assert.equal(task.profiles.users.length, 64);
  assert.equal(task.profiles.truncated, true);
  assert.equal(task.profiles.users[0].slackUserId, "UACTOR1");
});

test("ordinary questions reach Slack and the next reply resumes with that question in history", async (t) => {
  const f = await fixture(t);
  const question = "<@UACTOR1> What is your GitHub login so I can assign #18 to you?";
  f.finishes.push({ kind: "completed", reply: JSON.stringify({ kind: "reply", text: question }) });
  const first = input("Assign #18 to me.");
  await f.receive(first);
  assert.deepEqual(f.published.at(-1), {
    method: "chat.postMessage",
    args: {
      channel: first.address.channel,
      thread_ts: first.address.rootTs,
      text: question,
      unfurl_links: false,
      unfurl_media: false,
    },
  });
  const continued = await f.receive(
    input("My GitHub login is confirmed-owner.", { address: first.address, route: "thread" }),
  );
  assert.ok(
    continued.history.some(
      (item: { role: string; text: string }) => item.role === "assistant" && item.text === question,
    ),
  );
  assert.equal(continued.request, "My GitHub login is confirmed-owner.");
  assert.equal(continued.profiles.users[0].githubLogin, null);
  await assert.rejects(readFile(f.mapFile), { code: "ENOENT" });
});

test("private backend input gates retain only a generic notice in Slack", async (t) => {
  const f = await fixture(t);
  f.finishes.push({ kind: "needs_input" });
  await f.receive();
  assert.equal(f.published.length, 1);
  assert.equal(
    f.published[0]?.args.text,
    "The coding thread needs input in T3 Code. Send a fresh request after resolving it.",
  );
});
