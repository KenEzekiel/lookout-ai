import { createECDH, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { Miniflare, Response, convertV4MiniflareOptions } from "miniflare";
import { unstable_getMiniflareWorkerOptions, unstable_splitSqlQuery } from "wrangler";
import { afterEach, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { memberSchema, inviteSchema, pairingSchema } from "../../src/lib/access";
import { captureSessionSchema, reportReceiptSchema, incidentSchema } from "../../src/lib/incidents";
import { ruleSchema, sourceSchema } from "../../src/lib/rules";
import { pushSettingsSchema } from "../../src/lib/push";

const origin = "http://localhost:3000";
const vapid = createECDH("prime256v1");
vapid.generateKeys();
const receiver = createECDH("prime256v1");
receiver.generateKeys();
const authKey = randomBytes(16);
let runtime: Miniflare;
let providerStatus: number;
let sent: { url: string; headers: Headers; body: Buffer }[];

beforeEach(async () => {
  providerStatus = 201;
  sent = [];
  const { workerOptions, main } = unstable_getMiniflareWorkerOptions("./dist/server/wrangler.json");
  if (!main) throw new Error("The production Worker entry is missing.");
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      ...workerOptions,
      modulesRules: undefined,
      name: "lookout-app",
      cf: false,
      modules: [
        { type: "ESModule", path: main },
        ...(await readdir("./dist/server/assets"))
          .filter((file) => file.endsWith(".js"))
          .map((file): { type: "ESModule"; path: string } => ({
            type: "ESModule",
            path: resolve("./dist/server/assets", file),
          })),
      ],
      bindings: {
        APP_URL: origin,
        BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
        PUSH_PUBLIC_KEY: vapid.getPublicKey().toString("base64url"),
        PUSH_PRIVATE_KEY: vapid.getPrivateKey().toString("base64url"),
        PUSH_SUBJECT: "mailto:test@example.com",
      },
      outboundService: async (request) => {
        sent.push({
          url: request.url,
          headers: new Headers([...request.headers]),
          body: Buffer.from(await request.arrayBuffer()),
        });
        return new Response(null, { status: providerStatus });
      },
    }),
  );
  const db = await runtime.getD1Database("DB");
  for (const file of (await readdir("./migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    for (const statement of unstable_splitSqlQuery(await readFile(`./migrations/${file}`, "utf8")))
      await db.prepare(statement).run();
  }
});
afterEach(async () => {
  await runtime?.dispose();
});

let browserCount = 0;
class Browser {
  cookies = new Map<string, string>();
  ip = `192.0.2.${++browserCount}`;
  async request(path: string, body?: unknown) {
    const response = await runtime.dispatchFetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "cf-connecting-ip": this.ip,
        "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair?.indexOf("=") ?? -1;
      if (pair && index > 0) {
        if (/Max-Age=0/i.test(cookie)) this.cookies.delete(pair.slice(0, index));
        else this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    }
    return response;
  }
  async register() {
    assert.equal(
      (
        await this.request("/api/auth/sign-up/email", {
          name: "Operator",
          email: `${crypto.randomUUID()}@example.com`,
          password: "demo-password-123",
        })
      ).status,
      200,
    );
  }
}
async function owner() {
  const browser = new Browser();
  await browser.register();
  expect((await browser.request("/api/access/workspace", { name: "Safety team" })).status).toBe(
    201,
  );
  return browser;
}
async function teammate(admin: Browser) {
  const invitation = inviteSchema.parse(
    await (await admin.request("/api/access/invitations", {})).json(),
  );
  const browser = new Browser();
  await browser.register();
  expect((await browser.request("/api/access/join", { code: invitation.code })).status).toBe(200);
  return browser;
}
function subscription(suffix = crypto.randomUUID()) {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`,
    expirationTime: null,
    keys: {
      p256dh: receiver.getPublicKey().toString("base64url"),
      auth: authKey.toString("base64url"),
    },
  };
}
async function setupIncident(admin: Browser) {
  const actor = memberSchema.parse(await (await admin.request("/api/access/principal")).json());
  const source = sourceSchema.parse(
    await (await admin.request("/api/config/sources", { name: "Hall", kind: "camera" })).json(),
  );
  const rule = ruleSchema.parse(
    await (
      await admin.request("/api/config/rules/create", {
        sourceId: source.id,
        enabled: true,
        definition: {
          name: "Possible fall",
          condition: {
            kind: "custom",
            text: "A person falls to the ground and may need help.",
            exclusions: "Exclude deliberate exercises and sitting down.",
          },
          durationSeconds: null,
          severity: "critical",
          recipientIds: [actor.userId],
          escalationDelaySeconds: 60,
        },
      })
    ).json(),
  );
  const device = new Browser();
  const pairing = pairingSchema.parse(
    await (await device.request("/api/access/pairing/start", {})).json(),
  );
  expect(
    (await admin.request("/api/access/pairing/approve", { code: pairing.code, name: "Camera" }))
      .status,
  ).toBe(200);
  expect((await device.request("/api/access/pairing/claim", {})).status).toBe(200);
  const capture = captureSessionSchema.parse(
    await (await device.request("/api/incidents/sessions", { sourceId: source.id })).json(),
  );
  return {
    device,
    report: {
      sessionId: capture.id,
      eventId: crypto.randomUUID(),
      eventTime: Date.now(),
      ruleId: rule.id,
      ruleVersion: rule.version,
    },
  };
}
function decrypt(body: Buffer) {
  const salt = body.subarray(0, 16);
  const length = body[20]!;
  const sender = body.subarray(21, 21 + length);
  const shared = receiver.computeSecret(sender);
  const key = hkdfSync(
    "sha256",
    shared,
    authKey,
    Buffer.concat([Buffer.from("WebPush: info\0"), receiver.getPublicKey(), sender]),
    32,
  );
  const cek = hkdfSync("sha256", key, salt, "Content-Encoding: aes128gcm\0", 16);
  const nonce = hkdfSync("sha256", key, salt, "Content-Encoding: nonce\0", 12);
  const ciphertext = body.subarray(21 + length);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  let end = plaintext.length - 1;
  while (plaintext[end] === 0) end--;
  expect(plaintext[end]).toBe(2);
  return JSON.parse(plaintext.subarray(0, end).toString());
}

test("only live members register their own session and cannot claim another operator's endpoint", async () => {
  const admin = await owner();
  const operator = await teammate(admin);
  const { device } = await setupIncident(admin);
  const input = subscription();
  expect((await new Browser().request("/api/push/subscribe", input)).status).toBe(401);
  expect((await device.request("/api/push/subscribe", input)).status).toBe(403);
  expect((await admin.request("/api/push/subscribe", { ...input, userId: "forged" })).status).toBe(
    400,
  );
  expect(
    (
      await admin.request("/api/push/subscribe", {
        ...input,
        endpoint: "https://localhost/private",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await admin.request("/api/push/subscribe", {
        ...input,
        keys: { ...input.keys, p256dh: "A".repeat(87) },
      })
    ).status,
  ).toBe(400);
  expect((await admin.request("/api/push/subscribe", input)).status).toBe(200);
  expect((await admin.request("/api/push/subscribe", input)).status).toBe(200);
  expect((await operator.request("/api/push/subscribe", input)).status).toBe(409);
  expect(
    pushSettingsSchema.parse(await (await operator.request("/api/push/settings")).json()).endpoints,
  ).toEqual([]);
  expect(
    (await operator.request("/api/push/unsubscribe", { endpoint: input.endpoint })).status,
  ).toBe(200);
  expect(
    pushSettingsSchema.parse(await (await admin.request("/api/push/settings")).json()).endpoints,
  ).toEqual([input.endpoint]);
  expect(
    (
      await runtime.dispatchFetch(origin + "/api/push/subscribe", {
        method: "POST",
        headers: { Origin: "https://other.example" },
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(403);
});

test("reports send one encrypted minimal alert per subscribed recipient and preserve acknowledgment", async () => {
  const admin = await owner();
  const otherMember = await teammate(admin);
  const outsider = await owner();
  const input = subscription();
  await admin.request("/api/push/subscribe", input);
  await otherMember.request("/api/push/subscribe", subscription());
  await outsider.request("/api/push/subscribe", subscription());
  const { device, report } = await setupIncident(admin);
  const receipt = reportReceiptSchema.parse(
    await (await device.request("/api/incidents/reports", report)).json(),
  );
  expect(sent).toHaveLength(1);
  expect(sent[0]?.url).toBe(input.endpoint);
  expect(sent[0]?.headers.get("authorization")).toMatch(/^vapid t=.+, k=/);
  expect(sent[0]?.headers.get("content-encoding")).toBe("aes128gcm");
  expect(decrypt(sent[0]!.body)).toEqual({ incidentId: receipt.incident.id });
  expect(receipt.incident.notificationStatus).toBe("accepted");
  expect(receipt.incident.rule.definition.condition).toEqual({
    kind: "custom",
    text: "A person falls to the ground and may need help.",
    exclusions: "Exclude deliberate exercises and sitting down.",
  });
  await device.request("/api/incidents/reports", report);
  expect(sent).toHaveLength(1);
  await admin.request("/api/push/unsubscribe", { endpoint: input.endpoint });
  await admin.request("/api/push/subscribe", input);
  await device.request("/api/incidents/reports", report);
  expect(sent).toHaveLength(1);
  const detail = incidentSchema.parse(
    await (await admin.request(`/api/incidents/detail/${receipt.incident.id}`)).json(),
  );
  expect(detail).toMatchObject({
    status: "open",
    version: 1,
    owner: null,
    evidenceStatus: "pending",
  });
  expect((await outsider.request(`/api/incidents/detail/${detail.id}`)).status).toBe(404);
});

test.each([404, 410])(
  "terminal provider status %s removes an obsolete subscription",
  async (status) => {
    providerStatus = status;
    const admin = await owner();
    await admin.request("/api/push/subscribe", subscription());
    const { device, report } = await setupIncident(admin);
    const result = await device.request("/api/incidents/reports", report);
    expect(result.status).toBe(201);
    expect(reportReceiptSchema.parse(await result.json()).incident.notificationStatus).toBe(
      "failed",
    );
    expect(
      pushSettingsSchema.parse(await (await admin.request("/api/push/settings")).json()).endpoints,
    ).toEqual([]);
    expect(sent).toHaveLength(1);
  },
);

test("provider failure preserves the incident and subscription without duplicate initial attempts", async () => {
  providerStatus = 503;
  const admin = await owner();
  const input = subscription();
  await admin.request("/api/push/subscribe", input);
  const { device, report } = await setupIncident(admin);
  const results = await Promise.all([
    device.request("/api/incidents/reports", report),
    device.request("/api/incidents/reports", report),
  ]);
  expect(results.map((response) => response.status).sort()).toEqual([200, 201]);
  expect(sent).toHaveLength(1);
  expect(
    pushSettingsSchema.parse(await (await admin.request("/api/push/settings")).json()).endpoints,
  ).toEqual([input.endpoint]);
  const incident = reportReceiptSchema.parse(await results[0]!.json()).incident;
  expect(incident.status).toBe("open");
  expect(
    incidentSchema.parse(await (await admin.request(`/api/incidents/detail/${incident.id}`)).json())
      .notificationStatus,
  ).toBe("failed");
});

test("sign-out stops future push and denies incident retrieval", async () => {
  const admin = await owner();
  const { device, report } = await setupIncident(admin);
  await admin.request("/api/push/subscribe", subscription());
  const original = new Map(admin.cookies);
  expect((await admin.request("/api/auth/sign-out", {})).status).toBe(200);
  admin.cookies = original;
  const receipt = reportReceiptSchema.parse(
    await (await device.request("/api/incidents/reports", report)).json(),
  );
  expect(sent).toHaveLength(0);
  expect((await admin.request(`/api/incidents/detail/${receipt.incident.id}`)).status).toBe(401);
  expect((await admin.request("/api/push/subscribe", subscription())).status).toBe(401);
  const db = await runtime.getD1Database("DB");
  const count = z
    .object({ count: z.number() })
    .parse(await db.prepare("SELECT count(*) AS count FROM push_subscription").first());
  expect(count.count).toBe(0);
});

test.each(["session", "subscription"])(
  "expired %s prevents delivery and removes the subscription",
  async (kind) => {
    const admin = await owner();
    const { device, report } = await setupIncident(admin);
    await admin.request("/api/push/subscribe", subscription());
    const db = await runtime.getD1Database("DB");
    await db
      .prepare(
        kind === "session"
          ? "UPDATE session SET expires_at=0"
          : "UPDATE push_subscription SET expires_at=1",
      )
      .run();
    expect((await device.request("/api/incidents/reports", report)).status).toBe(201);
    expect(sent).toHaveLength(0);
    expect(
      z
        .object({ count: z.number() })
        .parse(await db.prepare("SELECT count(*) AS count FROM push_subscription").first()).count,
    ).toBe(0);
  },
);

test("the published notification worker opens the matching protected incident without acknowledgment", async () => {
  const admin = await owner();
  const { device, report } = await setupIncident(admin);
  const incident = reportReceiptSchema.parse(
    await (await device.request("/api/incidents/reports", report)).json(),
  ).incident;
  const script = await runtime.dispatchFetch(origin + "/push-worker.js");
  expect(script.status).toBe(200);
  const listeners = new Map<string, (event: unknown) => void>();
  const notifications: { title: string; options: unknown }[] = [];
  const navigations: string[] = [];
  const pending: Promise<unknown>[] = [];
  let focused = false;
  let closed = false;
  let existingWindow = true;
  runInNewContext(await script.text(), {
    URL,
    self: {
      location: { origin },
      addEventListener: (kind: string, listener: (event: unknown) => void) =>
        listeners.set(kind, listener),
      registration: {
        showNotification: async (title: string, options: unknown) => {
          notifications.push({ title, options });
        },
      },
      clients: {
        openWindow: async (url: string) => {
          navigations.push(url);
        },
        matchAll: async () =>
          existingWindow
            ? [
                {
                  url: origin + "/incidents",
                  navigate: async (url: string) => {
                    navigations.push(url);
                    return {
                      focus: async () => {
                        focused = true;
                      },
                    };
                  },
                },
              ]
            : [],
      },
    },
  });
  const waitUntil = (promise: Promise<unknown>) => pending.push(promise);
  listeners.get("push")?.({ data: { json: () => ({ incidentId: incident.id }) }, waitUntil });
  await Promise.all(pending.splice(0));
  expect(notifications).toHaveLength(1);
  expect(notifications[0]?.title).toBe("Lookout needs your attention");
  const options = z
    .object({ body: z.string(), data: z.object({ incidentId: z.string() }), tag: z.string() })
    .parse(notifications[0]?.options);
  expect(JSON.stringify(notifications)).not.toContain("Possible fall");
  listeners.get("notificationclick")?.({
    notification: {
      data: options.data,
      close: () => {
        closed = true;
      },
    },
    waitUntil,
  });
  await Promise.all(pending.splice(0));
  expect(navigations).toEqual([`${origin}/incidents/${incident.id}`]);
  expect(focused && closed).toBe(true);
  existingWindow = false;
  listeners.get("notificationclick")?.({
    notification: { data: options.data, close: () => {} },
    waitUntil,
  });
  await Promise.all(pending.splice(0));
  expect(navigations).toEqual([
    `${origin}/incidents/${incident.id}`,
    `${origin}/incidents/${incident.id}`,
  ]);
  const detail = incidentSchema.parse(
    await (await admin.request(`/api/incidents/detail/${incident.id}`)).json(),
  );
  expect(detail).toMatchObject({ status: "open", version: 1, owner: null });
  listeners.get("push")?.({
    data: { json: () => ({ incidentId: "https://evil.example/" }) },
    waitUntil,
  });
  expect(notifications).toHaveLength(1);
  await admin.request("/api/auth/sign-out", {});
  expect((await admin.request(`/api/incidents/detail/${incident.id}`)).status).toBe(401);
});

test("member removal deletes subscriptions and prevents retrieval or registration", async () => {
  const admin = await owner();
  const operator = await teammate(admin);
  const actor = memberSchema.parse(await (await operator.request("/api/access/principal")).json());
  await operator.request("/api/push/subscribe", subscription());
  const { device, report } = await setupIncident(admin);
  expect((await admin.request("/api/access/remove-member", { id: actor.userId })).status).toBe(200);
  const receipt = reportReceiptSchema.parse(
    await (await device.request("/api/incidents/reports", report)).json(),
  );
  expect(sent).toHaveLength(0);
  expect((await operator.request(`/api/incidents/detail/${receipt.incident.id}`)).status).toBe(403);
  expect((await operator.request("/api/push/subscribe", subscription())).status).toBe(403);
  const db = await runtime.getD1Database("DB");
  expect(
    z
      .object({ count: z.number() })
      .parse(
        await db
          .prepare("SELECT count(*) AS count FROM push_subscription WHERE user_id=?")
          .bind(actor.userId)
          .first(),
      ).count,
  ).toBe(0);
});
