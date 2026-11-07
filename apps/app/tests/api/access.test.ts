import assert from "node:assert/strict";
import {
  inviteSchema,
  pairingSchema,
  memberSchema,
  devicePrincipalSchema,
  teamSchema,
} from "../../src/lib/access";
import { randomBytes } from "node:crypto";
import { beforeEach, afterAll, expect, test } from "vitest";
import { createTestHarness } from "wrangler";

const origin = "http://localhost:3000";
const harness = createTestHarness({
  workers: [
    {
      configPath: "./dist/server/wrangler.json",
      vars: { APP_URL: origin },
      secrets: { BETTER_AUTH_SECRET: randomBytes(32).toString("hex") },
    },
  ],
});
beforeEach(async () => {
  await harness.listen();
  await harness.reset();
  await harness.getWorker<Cloudflare.Env>().applyD1Migrations("DB");
});
afterAll(async () => {
  await harness.close();
});

let browserCount = 0;
class Browser {
  ip = `192.0.2.${++browserCount}`;
  cookies = new Map<string, string>();
  async request(path: string, body?: unknown) {
    const response = await harness.fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "cf-connecting-ip": this.ip,
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair?.indexOf("=") ?? -1;
      if (pair && index > 0) {
        const key = pair.slice(0, index);
        if (/Max-Age=0/i.test(cookie)) this.cookies.delete(key);
        else this.cookies.set(key, pair.slice(index + 1));
      }
    }
    return response;
  }
  async register(name = "Owner") {
    const email = `${crypto.randomUUID()}@example.com`;
    const response = await this.request("/api/auth/sign-up/email", {
      name,
      email,
      password: "demo-password-123",
    });
    assert.equal(response.status, 200, await response.clone().text());
    return email;
  }
}

test("registration persists a real session and sign-out removes access", async () => {
  const browser = new Browser();
  const email = await browser.register();
  expect(await (await browser.request("/api/access/principal")).json()).toMatchObject({
    kind: "unassigned-user",
  });
  const created = await browser.request("/api/access/workspace", { name: "My workspace" });
  expect(created.status).toBe(201);
  expect(await (await browser.request("/api/access/principal")).json()).toMatchObject({
    kind: "member",
    role: "owner",
  });
  const oldCookies = new Map(browser.cookies);
  expect((await browser.request("/api/auth/sign-out", {})).status).toBe(200);
  browser.cookies = oldCookies;
  expect((await browser.request("/api/access/team")).status).toBe(401);
  browser.cookies.clear();
  expect(
    (await browser.request("/api/auth/sign-in/email", { email, password: "wrong-password" }))
      .status,
  ).toBe(401);
  expect(
    (await browser.request("/api/auth/sign-in/email", { email, password: "demo-password-123" }))
      .status,
  ).toBe(200);
  expect((await browser.request("/api/access/team")).status).toBe(200);
});

async function owner(name = "Workspace") {
  const browser = new Browser();
  await browser.register(name);
  expect((await browser.request("/api/access/workspace", { name })).status).toBe(201);
  return browser;
}

test("invitations redeem once across link and code; operators cannot administer", async () => {
  const admin = await owner();
  const invitation = inviteSchema.parse(
    await (await admin.request("/api/access/invitations", {})).json(),
  );
  const operator = new Browser();
  await operator.register("Operator");
  expect((await operator.request("/api/access/join", { code: invitation.code })).status).toBe(200);
  expect(await (await operator.request("/api/access/principal")).json()).toMatchObject({
    kind: "member",
    role: "operator",
  });
  expect((await operator.request("/api/access/invitations", {})).status).toBe(403);
  expect(
    (await operator.request("/api/access/pairing/approve", { code: "123456", name: "Camera" }))
      .status,
  ).toBe(403);
  expect((await operator.request("/api/access/devices/activate", { name: "Camera" })).status).toBe(
    403,
  );
  const newcomer = new Browser();
  await newcomer.register();
  expect((await newcomer.request("/api/access/join", { token: invitation.token })).status).toBe(
    400,
  );
  expect((await operator.request("/api/access/workspace", { name: "Another" })).status).toBe(409);
  const actor = memberSchema.parse(await (await operator.request("/api/access/principal")).json());
  expect((await admin.request("/api/access/remove-member", { id: actor.userId })).status).toBe(200);
  expect((await operator.request("/api/access/team")).status).toBe(403);
  expect(await (await operator.request("/api/access/principal")).json()).toMatchObject({
    kind: "unassigned-user",
  });
});

test("concurrent invitation redemption admits exactly one person", async () => {
  const admin = await owner();
  const invitation = inviteSchema.parse(
    await (await admin.request("/api/access/invitations", {})).json(),
  );
  const first = new Browser();
  const second = new Browser();
  await first.register();
  await second.register();
  const responses = await Promise.all([
    first.request("/api/access/join", { code: invitation.code }),
    second.request("/api/access/join", { token: invitation.token }),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
});

test("invitation links work after registration and expired codes fail", async () => {
  const admin = await owner();
  const invitation = inviteSchema.parse(
    await (await admin.request("/api/access/invitations", {})).json(),
  );
  const newcomer = new Browser();
  expect((await newcomer.request("/api/access/join", { token: invitation.token })).status).toBe(
    401,
  );
  await newcomer.register();
  expect((await newcomer.request("/api/access/join", { token: invitation.token })).status).toBe(
    200,
  );
  const expired = inviteSchema.parse(
    await (await admin.request("/api/access/invitations", {})).json(),
  );
  const env = await harness.getWorker<Cloudflare.Env>().getEnv();
  await env.DB.prepare("UPDATE invitation SET expires_at=0 WHERE used_by IS NULL").run();
  const other = new Browser();
  await other.register();
  expect((await other.request("/api/access/join", { code: expired.code })).status).toBe(400);
});

test("device pairing is restricted to the claiming browser and revocation is immediate", async () => {
  const admin = await owner("First team");
  const otherOwner = await owner("Other team");
  const device = new Browser();
  const stranger = new Browser();
  const started = await device.request("/api/access/pairing/start", {});
  expect(started.status).toBe(201);
  const pairing = pairingSchema.parse(await started.json());
  expect(await (await device.request("/api/access/pairing/claim", {})).json()).toEqual({
    status: "pending",
  });
  expect(
    (
      await admin.request("/api/access/pairing/approve", {
        code: pairing.code,
        name: "Lobby camera",
      })
    ).status,
  ).toBe(200);
  expect((await stranger.request("/api/access/pairing/claim", { code: pairing.code })).status).toBe(
    410,
  );
  const claimed = await device.request("/api/access/pairing/claim", {});
  expect(claimed.status).toBe(200);
  const actor = devicePrincipalSchema.parse(
    await (await device.request("/api/access/devices/status")).json(),
  );
  expect(actor).toMatchObject({
    kind: "device",
    name: "Lobby camera",
    workspaceName: "First team",
  });
  expect(device.cookies.has("lookout_device")).toBe(true);
  const resumed = new Browser();
  resumed.cookies = new Map(device.cookies);
  expect((await resumed.request("/api/access/devices/status")).status).toBe(200);
  expect((await device.request("/api/access/team")).status).toBe(403);
  expect((await device.request("/api/access/invitations", {})).status).toBe(403);
  expect((await device.request("/api/access/remove-member", { id: "anything" })).status).toBe(403);
  expect(
    (await otherOwner.request("/api/access/devices/revoke", { id: actor.deviceId })).status,
  ).toBe(404);
  const otherTeam = teamSchema.parse(await (await otherOwner.request("/api/access/team")).json());
  expect(otherTeam.devices).toEqual([]);
  expect((await admin.request("/api/access/devices/revoke", { id: actor.deviceId })).status).toBe(
    200,
  );
  expect((await device.request("/api/access/devices/status")).status).toBe(401);
  expect((await device.request("/api/access/principal")).status).toBe(401);
});

test("same-browser activation invalidates the owner session, and owner sign-out elsewhere does not revoke devices", async () => {
  const admin = await owner();
  const copiedSession = new Browser();
  copiedSession.cookies = new Map(admin.cookies);
  const activated = await admin.request("/api/access/devices/activate", { name: "This browser" });
  expect(activated.status).toBe(200);
  expect((await copiedSession.request("/api/access/team")).status).toBe(401);
  expect((await admin.request("/api/access/team")).status).toBe(403);
  expect((await admin.request("/api/auth/sign-out", {})).status).toBe(200);
  expect((await admin.request("/api/access/devices/status")).status).toBe(200);
  expect((await admin.request("/api/access/devices/leave", {})).status).toBe(200);
  expect((await admin.request("/api/access/devices/status")).status).toBe(401);
});

test("invalid, unauthenticated, cross-origin and cross-workspace requests cannot mutate protected state", async () => {
  const visitor = new Browser();
  expect((await visitor.request("/api/access/team")).status).toBe(401);
  expect((await visitor.request("/api/access/workspace", { name: "No" })).status).toBe(401);
  const user = new Browser();
  await user.register();
  expect((await user.request("/api/access/workspace", { name: "   " })).status).toBe(400);
  const crossOrigin = await harness.fetch(origin + "/api/access/workspace", {
    method: "POST",
    headers: { Origin: "https://elsewhere.example", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bad" }),
  });
  expect(crossOrigin.status).toBe(403);
  const first = await owner();
  const second = await owner();
  const firstActor = memberSchema.parse(
    await (await first.request("/api/access/principal")).json(),
  );
  expect(
    (await second.request("/api/access/remove-member", { id: firstActor.userId })).status,
  ).toBe(404);
  expect((await first.request("/api/access/remove-member", { id: firstActor.userId })).status).toBe(
    404,
  );
});

test("pairing codes expire and incorrect invitation attempts are bounded", async () => {
  const admin = await owner();
  const device = new Browser();
  const pairing = pairingSchema.parse(
    await (await device.request("/api/access/pairing/start", {})).json(),
  );
  const env = await harness.getWorker<Cloudflare.Env>().getEnv();
  await env.DB.prepare("UPDATE pairing_request SET expires_at=0 WHERE device_id IS NULL").run();
  expect((await device.request("/api/access/pairing/claim", {})).status).toBe(410);
  expect(
    (await admin.request("/api/access/pairing/approve", { code: pairing.code, name: "Expired" }))
      .status,
  ).toBe(400);
  const newcomer = new Browser();
  await newcomer.register();
  for (let attempt = 0; attempt < 10; attempt++)
    expect((await newcomer.request("/api/access/join", { code: "000000" })).status).toBe(400);
  expect((await newcomer.request("/api/access/join", { code: "000000" })).status).toBe(429);
});
