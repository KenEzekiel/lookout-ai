import { peerSessionSchema, peerSyncSchema } from "../../src/lib/peer";
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
import {
  captureSessionSchema,
  incidentInboxSchema,
  incidentSchema,
  reportReceiptSchema,
} from "../../src/lib/incidents";
import {
  type RuleInput,
  ruleSchema,
  sourceSchema,
  operatorConfigurationSchema,
  deviceConfigurationSchema,
} from "../../src/lib/rules";

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

async function configuredWorkspace() {
  const admin = await owner();
  const actor = memberSchema.parse(await (await admin.request("/api/access/principal")).json());
  const source = sourceSchema.parse(
    await (
      await admin.request("/api/config/sources", { name: "Living room", kind: "camera" })
    ).json(),
  );
  const input: RuleInput = {
    sourceId: source.id,
    enabled: true,
    definition: {
      name: "Possible fall",
      condition: { kind: "template", template: "fall" },
      durationSeconds: null,
      severity: "critical",
      recipientIds: [actor.userId],
      escalationDelaySeconds: 60,
    },
  };
  return { admin, actor, source, input };
}
async function paired(admin: Browser, name = "Monitoring browser") {
  const device = new Browser();
  const pairing = pairingSchema.parse(
    await (await device.request("/api/access/pairing/start", {})).json(),
  );
  expect(
    (await admin.request("/api/access/pairing/approve", { name, code: pairing.code })).status,
  ).toBe(200);
  expect((await device.request("/api/access/pairing/claim", {})).status).toBe(200);
  return device;
}

test("template and custom triggers persist, and a device receives edits and disabled versions", async () => {
  const { admin, input } = await configuredWorkspace();
  const device = await paired(admin);
  const response = await admin.request("/api/config/rules/create", input);
  expect(response.status).toBe(201);
  const fall = ruleSchema.parse(await response.json());
  expect(fall).toMatchObject({ ...input, version: 1 });
  const replay = sourceSchema.parse(
    await (
      await admin.request("/api/config/sources", { name: "Crash replay", kind: "replay" })
    ).json(),
  );
  const customInput: RuleInput = {
    ...input,
    sourceId: replay.id,
    definition: {
      ...input.definition,
      name: "Blocked exit",
      condition: {
        kind: "custom",
        text: "A vehicle blocks the marked emergency exit.",
        exclusions: "Vehicles passing without stopping.",
      },
      durationSeconds: 15,
      severity: "warning",
      escalationDelaySeconds: 90,
    },
  };
  const customResponse = await admin.request("/api/config/rules/create", customInput);
  expect(customResponse.status).toBe(201);
  const custom = ruleSchema.parse(await customResponse.json());
  expect(custom.definition.condition).toEqual(customInput.definition.condition);
  const reloaded = new Browser();
  reloaded.cookies = new Map(admin.cookies);
  const configuration = operatorConfigurationSchema.parse(
    await (await reloaded.request("/api/config/operator")).json(),
  );
  expect(configuration.rules).toEqual([fall, custom]);
  expect(configuration.sources).toHaveLength(2);
  const edit = { ...fall, definition: { ...fall.definition, escalationDelaySeconds: 120 } };
  const edited = ruleSchema.parse(
    await (await admin.request("/api/config/rules/update", edit)).json(),
  );
  expect(edited).toMatchObject({ version: 2, definition: { escalationDelaySeconds: 120 } });
  let delivered = deviceConfigurationSchema.parse(
    await (await device.request("/api/config/device")).json(),
  );
  expect(delivered.rules).toEqual([edited, custom]);
  const disabled = ruleSchema.parse(
    await (
      await admin.request("/api/config/rules/disable", { id: edited.id, version: edited.version })
    ).json(),
  );
  expect(disabled).toMatchObject({ version: 3, enabled: false });
  delivered = deviceConfigurationSchema.parse(
    await (await device.request("/api/config/device")).json(),
  );
  expect(delivered.rules).toEqual([disabled, custom]);
  const resumedDevice = new Browser();
  resumedDevice.cookies = new Map(device.cookies);
  expect(await (await resumedDevice.request("/api/config/device")).json()).toEqual(delivered);
  const reenabled = ruleSchema.parse(
    await (await admin.request("/api/config/rules/update", { ...disabled, enabled: true })).json(),
  );
  expect(reenabled).toMatchObject({ enabled: true, version: 4 });
});

test("invalid conditions, settings, sources and recipients reject the entire save", async () => {
  const { admin, input } = await configuredWorkspace();
  const outsider = await owner("Other workspace");
  const outsiderActor = memberSchema.parse(
    await (await outsider.request("/api/access/principal")).json(),
  );
  const outsiderSource = sourceSchema.parse(
    await (
      await outsider.request("/api/config/sources", { name: "Other camera", kind: "camera" })
    ).json(),
  );
  const invalid = [
    { ...input, definition: { ...input.definition, condition: { kind: "custom", text: "short" } } },
    {
      ...input,
      definition: { ...input.definition, condition: { kind: "template", template: "unknown" } },
    },
    { ...input, definition: { ...input.definition, recipientIds: [] } },
    {
      ...input,
      definition: {
        ...input.definition,
        recipientIds: [...input.definition.recipientIds, outsiderActor.userId],
      },
    },
    { ...input, definition: { ...input.definition, recipientIds: ["nonexistent"] } },
    {
      ...input,
      definition: {
        ...input.definition,
        recipientIds: [...input.definition.recipientIds, ...input.definition.recipientIds],
      },
    },
    { ...input, definition: { ...input.definition, escalationDelaySeconds: 0 } },
    { ...input, definition: { ...input.definition, durationSeconds: -1 } },
    { ...input, definition: { ...input.definition, severity: "unknown" } },
    { ...input, sourceId: outsiderSource.id },
    { ...input, sourceId: "nonexistent" },
  ];
  for (const body of invalid)
    expect((await admin.request("/api/config/rules/create", body)).status).toBe(400);
  const empty = operatorConfigurationSchema.parse(
    await (await admin.request("/api/config/operator")).json(),
  );
  expect(empty.rules).toEqual([]);
  const rule = ruleSchema.parse(
    await (await admin.request("/api/config/rules/create", input)).json(),
  );
  expect(
    (
      await admin.request("/api/config/rules/update", {
        ...rule,
        definition: {
          ...rule.definition,
          name: "Must not persist",
          recipientIds: [outsiderActor.userId],
        },
      })
    ).status,
  ).toBe(409);
  expect(
    operatorConfigurationSchema.parse(await (await admin.request("/api/config/operator")).json())
      .rules,
  ).toEqual([rule]);
  expect(
    (await admin.request("/api/config/sources", { name: "Living room", kind: "camera" })).status,
  ).toBe(409);
  expect((await admin.request("/api/config/sources", { name: "  ", kind: "camera" })).status).toBe(
    400,
  );
});

test("configuration enforces operator and device boundaries, workspace scope and revocation", async () => {
  const { admin, input } = await configuredWorkspace();
  const rule = ruleSchema.parse(
    await (await admin.request("/api/config/rules/create", input)).json(),
  );
  const device = await paired(admin);
  const otherOwner = await owner("Other workspace");
  const otherDevice = await paired(otherOwner);
  const visitor = new Browser();
  expect((await visitor.request("/api/config/operator")).status).toBe(401);
  expect((await visitor.request("/api/config/device")).status).toBe(401);
  expect(
    (await visitor.request("/api/config/sources", { name: "Bad", kind: "camera" })).status,
  ).toBe(401);
  expect((await visitor.request("/api/config/rules/create", input)).status).toBe(401);
  expect((await admin.request("/api/config/device")).status).toBe(403);
  expect((await device.request("/api/config/operator")).status).toBe(403);
  expect(
    (await device.request("/api/config/sources", { name: "Bad", kind: "camera" })).status,
  ).toBe(403);
  expect((await device.request("/api/config/rules/create", input)).status).toBe(403);
  expect((await device.request("/api/config/rules/update", rule)).status).toBe(403);
  expect(
    (await device.request("/api/config/rules/disable", { id: rule.id, version: rule.version }))
      .status,
  ).toBe(403);
  expect((await otherOwner.request("/api/config/rules/update", rule)).status).toBe(409);
  expect(
    (await otherOwner.request("/api/config/rules/disable", { id: rule.id, version: rule.version }))
      .status,
  ).toBe(409);
  expect(
    deviceConfigurationSchema.parse(
      await (await otherDevice.request("/api/config/device?workspaceId=" + input.sourceId)).json(),
    ),
  ).toEqual({ sources: [], rules: [] });
  expect(
    operatorConfigurationSchema.parse(
      await (await otherOwner.request("/api/config/operator")).json(),
    ).rules,
  ).toEqual([]);
  const deviceActor = devicePrincipalSchema.parse(
    await (await device.request("/api/access/devices/status")).json(),
  );
  expect(
    (await admin.request("/api/access/devices/revoke", { id: deviceActor.deviceId })).status,
  ).toBe(200);
  expect((await device.request("/api/config/device")).status).toBe(401);
  const crossOrigin = await harness.fetch(origin + "/api/config/rules/create", {
    method: "POST",
    headers: { Origin: "https://elsewhere.example", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  expect(crossOrigin.status).toBe(403);
});

test("concurrent edits cannot overwrite a rule saved from the same version", async () => {
  const { admin, input } = await configuredWorkspace();
  const rule = ruleSchema.parse(
    await (await admin.request("/api/config/rules/create", input)).json(),
  );
  const responses = await Promise.all([
    admin.request("/api/config/rules/update", {
      ...rule,
      definition: { ...rule.definition, name: "First edit" },
    }),
    admin.request("/api/config/rules/update", {
      ...rule,
      definition: { ...rule.definition, name: "Second edit" },
    }),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(
    (await admin.request("/api/config/rules/disable", { id: rule.id, version: rule.version }))
      .status,
  ).toBe(409);
  const configuration = operatorConfigurationSchema.parse(
    await (await admin.request("/api/config/operator")).json(),
  );
  expect(configuration.rules).toHaveLength(1);
  expect(configuration.rules[0]?.version).toBe(2);
});

test("operators configure rules and removing a recipient disables and versions affected rules", async () => {
  const { admin, input } = await configuredWorkspace();
  const invitation = inviteSchema.parse(
    await (await admin.request("/api/access/invitations", {})).json(),
  );
  const operator = new Browser();
  await operator.register("Responder");
  expect((await operator.request("/api/access/join", { code: invitation.code })).status).toBe(200);
  const actor = memberSchema.parse(await (await operator.request("/api/access/principal")).json());
  const shared = ruleSchema.parse(
    await (
      await operator.request("/api/config/rules/create", {
        ...input,
        definition: { ...input.definition, recipientIds: [actor.userId] },
      })
    ).json(),
  );
  const unaffected = ruleSchema.parse(
    await (await admin.request("/api/config/rules/create", input)).json(),
  );
  const device = await paired(admin);
  expect((await admin.request("/api/access/remove-member", { id: actor.userId })).status).toBe(200);
  expect((await operator.request("/api/config/operator")).status).toBe(403);
  expect((await operator.request("/api/config/rules/update", shared)).status).toBe(403);
  const delivered = deviceConfigurationSchema.parse(
    await (await device.request("/api/config/device")).json(),
  );
  expect(delivered.rules).toEqual([{ ...shared, enabled: false, version: 2 }, unaffected]);
  expect((await admin.request("/api/config/rules/update", { ...shared, version: 2 })).status).toBe(
    409,
  );
});

async function incidentSetup(escalationDelaySeconds = 60) {
  const workspace = await configuredWorkspace();
  const rule = ruleSchema.parse(
    await (
      await workspace.admin.request("/api/config/rules/create", {
        ...workspace.input,
        definition: { ...workspace.input.definition, escalationDelaySeconds },
      })
    ).json(),
  );
  const device = await paired(workspace.admin);
  const session = captureSessionSchema.parse(
    await (
      await device.request("/api/incidents/sessions", { sourceId: workspace.source.id })
    ).json(),
  );
  const report = {
    sessionId: session.id,
    eventId: crypto.randomUUID(),
    ruleId: rule.id,
    ruleVersion: rule.version,
    eventTime: Date.now(),
  };
  return { ...workspace, rule, device, session, report };
}
async function teammate(admin: Browser) {
  const invitation = inviteSchema.parse(
    await (await admin.request("/api/access/invitations", {})).json(),
  );
  const operator = new Browser();
  await operator.register("Responder");
  expect((await operator.request("/api/access/join", { code: invitation.code })).status).toBe(200);
  return operator;
}

test("device event retries create one persistent incident with authoritative source and rule snapshots", async () => {
  const { admin, device, report, source, rule } = await incidentSetup();
  const deliveries = await Promise.all([
    device.request("/api/incidents/reports", report),
    device.request("/api/incidents/reports", report),
  ]);
  expect(deliveries.map((result) => result.status).sort()).toEqual([200, 201]);
  const first = reportReceiptSchema.parse(await deliveries[0]!.json()).incident;
  const retry = reportReceiptSchema.parse(await deliveries[1]!.json()).incident;
  expect(retry).toEqual(first);
  expect(first).toMatchObject({
    source,
    rule,
    eventTime: report.eventTime,
    status: "open",
    version: 1,
    owner: null,
    evidenceStatus: "pending",
    notificationStatus: "not-sent",
  });
  expect(first.timeline).toHaveLength(1);
  const reloaded = new Browser();
  reloaded.cookies = new Map(admin.cookies);
  expect(
    incidentInboxSchema.parse(await (await reloaded.request("/api/incidents/inbox")).json())
      .incidents,
  ).toEqual([first]);
  await admin.request("/api/config/rules/update", {
    ...rule,
    definition: { ...rule.definition, name: "Changed later", severity: "warning" },
  });
  expect(
    incidentSchema.parse(await (await admin.request(`/api/incidents/detail/${first.id}`)).json()),
  ).toEqual(first);
  expect((await device.request("/api/incidents/reports", report)).status).toBe(200);
  expect(
    (await device.request("/api/incidents/reports", { ...report, eventTime: report.eventTime + 1 }))
      .status,
  ).toBe(409);
  expect(
    (await device.request("/api/incidents/reports", { ...report, ruleVersion: 2 })).status,
  ).toBe(409);
  expect(
    incidentInboxSchema.parse(await (await admin.request("/api/incidents/inbox")).json()).incidents,
  ).toHaveLength(1);
});

test("incoming delivery is recipient-scoped, retry-safe and stops for every recipient after a shared response", async () => {
  const { admin, device, report, rule, actor } = await incidentSetup();
  const operator = await teammate(admin);
  const operatorActor = memberSchema.parse(
    await (await operator.request("/api/access/principal")).json(),
  );
  const otherMember = await teammate(admin);
  const outsider = await owner("Other workspace");
  const alerts = async (browser: Browser) =>
    incidentInboxSchema.parse(await (await browser.request("/api/incidents/alerts")).json())
      .incidents;
  const currentRule = ruleSchema.parse(
    await (
      await admin.request("/api/config/rules/update", {
        ...rule,
        definition: { ...rule.definition, recipientIds: [actor.userId, operatorActor.userId] },
      })
    ).json(),
  );
  const currentReport = { ...report, ruleVersion: currentRule.version };
  const incident = reportReceiptSchema.parse(
    await (await device.request("/api/incidents/reports", currentReport)).json(),
  ).incident;
  expect(await alerts(admin)).toEqual([incident]);
  expect(await alerts(operator)).toEqual([incident]);
  expect(await alerts(otherMember)).toEqual([]);
  expect(await alerts(outsider)).toEqual([]);
  expect((await new Browser().request("/api/incidents/alerts")).status).toBe(401);
  expect((await device.request("/api/incidents/alerts")).status).toBe(403);
  await device.request("/api/incidents/reports", currentReport);
  expect(await alerts(admin)).toEqual([incident]);
  await admin.request("/api/config/rules/update", {
    ...currentRule,
    definition: { ...currentRule.definition, recipientIds: [actor.userId] },
  });
  expect(await alerts(operator)).toEqual([incident]);
  expect(
    (
      await operator.request(`/api/incidents/commands/${incident.id}`, {
        action: "acknowledge",
        version: 1,
      })
    ).status,
  ).toBe(200);
  expect(await alerts(admin)).toEqual([]);
  expect(await alerts(operator)).toEqual([]);
  expect(
    incidentSchema.parse(await (await admin.request(`/api/incidents/detail/${incident.id}`)).json())
      .owner,
  ).toEqual({ userId: operatorActor.userId, name: operatorActor.name });
  await admin.request("/api/access/remove-member", { id: operatorActor.userId });
  expect((await operator.request("/api/incidents/alerts")).status).toBe(403);
});

test("stale, disabled, ended, expired and superseded sessions cannot create new incidents", async () => {
  const { admin, device, report, source, rule } = await incidentSetup();
  const freshReport = () => ({ ...report, eventId: crypto.randomUUID() });
  expect(
    (await device.request("/api/incidents/reports", { ...freshReport(), ruleVersion: 2 })).status,
  ).toBe(409);
  expect(
    (
      await device.request("/api/incidents/reports", {
        ...freshReport(),
        eventTime: Date.now() + 120_000,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await device.request("/api/incidents/reports", {
        ...freshReport(),
        eventTime: Date.now() - 60_000,
      })
    ).status,
  ).toBe(409);
  const current = captureSessionSchema.parse(
    await (await device.request("/api/incidents/sessions", { sourceId: source.id })).json(),
  );
  expect((await device.request("/api/incidents/reports", freshReport())).status).toBe(409);
  const currentReport = { ...freshReport(), sessionId: current.id };
  await device.request("/api/incidents/sessions/end", { id: current.id });
  expect((await device.request("/api/incidents/reports", currentReport)).status).toBe(409);
  const expired = captureSessionSchema.parse(
    await (await device.request("/api/incidents/sessions", { sourceId: source.id })).json(),
  );
  const env = await harness.getWorker<Cloudflare.Env>().getEnv();
  await env.DB.prepare("UPDATE incident_capture_session SET expires_at=0 WHERE id=?")
    .bind(expired.id)
    .run();
  expect(
    (await device.request("/api/incidents/reports", { ...freshReport(), sessionId: expired.id }))
      .status,
  ).toBe(409);
  const active = captureSessionSchema.parse(
    await (await device.request("/api/incidents/sessions", { sourceId: source.id })).json(),
  );
  await admin.request("/api/config/rules/disable", { id: rule.id, version: rule.version });
  expect(
    (await device.request("/api/incidents/reports", { ...freshReport(), sessionId: active.id }))
      .status,
  ).toBe(409);
  expect(
    (
      await device.request("/api/incidents/reports", {
        ...freshReport(),
        sessionId: active.id,
        ruleVersion: 2,
      })
    ).status,
  ).toBe(409);
  expect(
    incidentInboxSchema.parse(await (await admin.request("/api/incidents/inbox")).json()).incidents,
  ).toEqual([]);
});

test("report and incident endpoints enforce workspace, device, origin and membership boundaries", async () => {
  const { admin, device, report, actor, source } = await incidentSetup();
  const other = await owner("Unrelated workspace");
  const otherDevice = await paired(other);
  const visitor = new Browser();
  const accepted = await device.request("/api/incidents/reports", report);
  expect(accepted.status).toBe(201);
  const incident = reportReceiptSchema.parse(await accepted.json()).incident;
  expect((await visitor.request("/api/incidents/reports", report)).status).toBe(401);
  expect((await visitor.request("/api/incidents/inbox")).status).toBe(401);
  expect((await admin.request("/api/incidents/reports", report)).status).toBe(403);
  expect((await admin.request("/api/incidents/sessions", { sourceId: source.id })).status).toBe(
    403,
  );
  expect(
    (await otherDevice.request("/api/incidents/sessions", { sourceId: source.id })).status,
  ).toBe(403);
  expect((await otherDevice.request("/api/incidents/reports", report)).status).toBe(409);
  expect((await device.request("/api/incidents/inbox")).status).toBe(403);
  expect((await device.request(`/api/incidents/detail/${incident.id}`)).status).toBe(403);
  expect(
    (
      await device.request(`/api/incidents/commands/${incident.id}`, {
        action: "acknowledge",
        version: 1,
      })
    ).status,
  ).toBe(403);
  expect((await other.request(`/api/incidents/detail/${incident.id}`)).status).toBe(404);
  expect(
    (
      await other.request(`/api/incidents/commands/${incident.id}`, {
        action: "dismiss",
        version: 1,
      })
    ).status,
  ).toBe(409);
  expect(
    incidentInboxSchema.parse(
      await (await other.request(`/api/incidents/inbox?workspaceId=${actor.workspaceId}`)).json(),
    ).incidents,
  ).toEqual([]);
  expect(
    (
      await device.request("/api/incidents/reports", {
        ...report,
        eventId: "forged",
        recipientIds: [actor.userId],
      })
    ).status,
  ).toBe(400);
  const denied = await harness.fetch(origin + "/api/incidents/reports", {
    method: "POST",
    headers: { Origin: "https://other.example", "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
  expect(denied.status).toBe(403);
  const operator = await teammate(admin);
  const operatorActor = memberSchema.parse(
    await (await operator.request("/api/access/principal")).json(),
  );
  await admin.request("/api/access/remove-member", { id: operatorActor.userId });
  expect((await operator.request(`/api/incidents/detail/${incident.id}`)).status).toBe(403);
  expect(
    (
      await operator.request(`/api/incidents/commands/${incident.id}`, {
        action: "acknowledge",
        version: 1,
      })
    ).status,
  ).toBe(403);
  const deviceActor = devicePrincipalSchema.parse(
    await (await device.request("/api/access/principal")).json(),
  );
  await admin.request("/api/access/devices/revoke", { id: deviceActor.deviceId });
  expect((await device.request("/api/incidents/reports", report)).status).toBe(401);
  expect((await device.request("/api/incidents/sessions", { sourceId: source.id })).status).toBe(
    401,
  );
  expect(
    incidentSchema.parse(await (await admin.request(`/api/incidents/detail/${incident.id}`)).json())
      .status,
  ).toBe("open");
});

test("acknowledgment records one owner and stale concurrent responses never overwrite newer state", async () => {
  const { admin, device, report } = await incidentSetup();
  const operator = await teammate(admin);
  const incident = reportReceiptSchema.parse(
    await (await device.request("/api/incidents/reports", report)).json(),
  ).incident;
  const path = `/api/incidents/commands/${incident.id}`;
  expect((await admin.request(path, { action: "resolve", version: 1 })).status).toBe(409);
  const responses = await Promise.all([
    admin.request(path, { action: "acknowledge", version: 1 }),
    operator.request(path, { action: "acknowledge", version: 1 }),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  const acknowledged = incidentSchema.parse(
    await (await operator.request(`/api/incidents/detail/${incident.id}`)).json(),
  );
  expect(acknowledged).toMatchObject({
    status: "acknowledged",
    version: 2,
    evidenceStatus: "pending",
  });
  expect(acknowledged.owner?.userId).toBe(acknowledged.timeline[1]?.actorId);
  expect(acknowledged.timeline).toHaveLength(2);
  expect((await admin.request(path, { action: "dismiss", version: 1 })).status).toBe(409);
  const resolved = await operator.request(path, { action: "resolve", version: 2 });
  expect(resolved.status).toBe(200);
  const result = incidentSchema.parse(await resolved.json());
  expect(result).toMatchObject({ status: "resolved", version: 3, owner: acknowledged.owner });
  expect(result.timeline.map((entry) => entry.kind)).toEqual([
    "reported",
    "acknowledged",
    "resolved",
  ]);
  expect((await admin.request(path, { action: "dismiss", version: 3 })).status).toBe(409);
  expect((await admin.request(path, { action: "reopen", version: 3 })).status).toBe(400);
  expect(
    incidentSchema.parse(
      await (await admin.request(`/api/incidents/detail/${incident.id}`)).json(),
    ),
  ).toEqual(result);
});

test("dismiss records incorrect-alert feedback independently of resolution", async () => {
  const { admin, device, report } = await incidentSetup();
  const incident = reportReceiptSchema.parse(
    await (await device.request("/api/incidents/reports", report)).json(),
  ).incident;
  const path = `/api/incidents/commands/${incident.id}`;
  const response = await admin.request(path, { action: "dismiss", version: 1 });
  expect(response.status).toBe(200);
  const dismissed = incidentSchema.parse(await response.json());
  expect(dismissed).toMatchObject({ status: "dismissed", version: 2, owner: null });
  expect(dismissed.timeline.map((entry) => entry.kind)).toEqual(["reported", "dismissed"]);
  expect((await admin.request(path, { action: "acknowledge", version: 2 })).status).toBe(409);
  expect((await admin.request(path, { action: "resolve", version: 2 })).status).toBe(409);
  expect(
    reportReceiptSchema.parse(await (await device.request("/api/incidents/reports", report)).json())
      .incident,
  ).toEqual(dismissed);
});

async function liveSetup() {
  const admin = await owner();
  const device = await paired(admin);
  const actor = devicePrincipalSchema.parse(
    await (await device.request("/api/access/principal")).json(),
  );
  const source = { runId: crypto.randomUUID(), kind: "camera" };
  expect((await device.request("/api/peer/device", source)).status).toBe(200);
  return { admin, device, actor, source };
}

test("live signaling exchanges one offer and answer and closing preserves the device source", async () => {
  const { admin, device, actor, source } = await liveSetup();
  const opened = await admin.request("/api/peer/open", { deviceId: actor.deviceId });
  expect(opened.status).toBe(201);
  const session = peerSessionSchema.parse(await opened.json());
  expect(session).toMatchObject({ ...source, offer: null, answer: null });
  expect(
    (await admin.request("/api/peer/offer", { id: session.id, sdp: "offer-sdp" })).status,
  ).toBe(200);
  expect((await admin.request("/api/peer/offer", { id: session.id, sdp: "replace" })).status).toBe(
    409,
  );
  expect(
    peerSyncSchema.parse(await (await device.request("/api/peer/device", source)).json()).session,
  ).toMatchObject({ id: session.id, offer: "offer-sdp" });
  expect(
    (await device.request("/api/peer/answer", { id: session.id, sdp: "answer-sdp" })).status,
  ).toBe(200);
  expect(
    peerSessionSchema.parse(
      await (await admin.request("/api/peer/poll", { id: session.id })).json(),
    ).answer,
  ).toBe("answer-sdp");
  expect((await admin.request("/api/peer/close", { id: session.id })).status).toBe(200);
  expect((await admin.request("/api/peer/close", { id: session.id })).status).toBe(200);
  expect(
    peerSyncSchema.parse(await (await device.request("/api/peer/device", source)).json()).session,
  ).toBeNull();
  expect((await admin.request("/api/peer/open", { deviceId: actor.deviceId })).status).toBe(201);
  const env = await harness.getWorker<Cloudflare.Env>().getEnv();
  expect(
    (await env.DB.prepare("SELECT count(*) AS count FROM incident").first<{ count: number }>())
      ?.count,
  ).toBe(0);
});

test("live viewing denies visitors, other workspaces, other operators and other devices", async () => {
  const { admin, device, actor, source } = await liveSetup();
  const operator = await teammate(admin);
  const outsider = await owner("Outside");
  const otherDevice = await paired(admin);
  const visitor = new Browser();
  const opened = peerSessionSchema.parse(
    await (await admin.request("/api/peer/open", { deviceId: actor.deviceId })).json(),
  );
  const body = { id: opened.id };
  expect((await visitor.request("/api/peer/open", { deviceId: actor.deviceId })).status).toBe(401);
  expect((await outsider.request("/api/peer/open", { deviceId: actor.deviceId })).status).toBe(409);
  expect((await device.request("/api/peer/open", { deviceId: actor.deviceId })).status).toBe(403);
  expect((await operator.request("/api/peer/poll", body)).status).toBe(410);
  expect((await outsider.request("/api/peer/offer", { ...body, sdp: "forged" })).status).toBe(410);
  expect((await otherDevice.request("/api/peer/answer", { ...body, sdp: "forged" })).status).toBe(
    410,
  );
  expect((await operator.request("/api/peer/close", body)).status).toBe(200);
  expect((await admin.request("/api/peer/poll", body)).status).toBe(200);
  expect((await admin.request("/api/peer/answer", { ...body, sdp: "forged" })).status).toBe(403);
  expect((await admin.request("/api/peer/device", source)).status).toBe(403);
  expect((await admin.request("/api/peer/offer", { ...body, sdp: "x".repeat(32769) })).status).toBe(
    400,
  );
  const crossOrigin = await harness.fetch(origin + "/api/peer/close", {
    method: "POST",
    headers: { Origin: "https://elsewhere.example", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(crossOrigin.status).toBe(403);
});

test("concurrent live viewers admit one operator and source stop, restart and expiry end sessions", async () => {
  const { admin, device, actor, source } = await liveSetup();
  const operator = await teammate(admin);
  const results = await Promise.all([
    admin.request("/api/peer/open", { deviceId: actor.deviceId }),
    operator.request("/api/peer/open", { deviceId: actor.deviceId }),
  ]);
  expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
  await device.request("/api/peer/stop", source);
  expect((await admin.request("/api/peer/open", { deviceId: actor.deviceId })).status).toBe(409);
  await device.request("/api/peer/device", source);
  const session = peerSessionSchema.parse(
    await (await admin.request("/api/peer/open", { deviceId: actor.deviceId })).json(),
  );
  const next = { ...source, runId: crypto.randomUUID() };
  await device.request("/api/peer/device", next);
  expect((await admin.request("/api/peer/poll", { id: session.id })).status).toBe(410);
  await device.request("/api/peer/stop", source);
  const current = peerSessionSchema.parse(
    await (await admin.request("/api/peer/open", { deviceId: actor.deviceId })).json(),
  );
  const env = await harness.getWorker<Cloudflare.Env>().getEnv();
  await env.DB.prepare("UPDATE peer_source SET expires_at=0 WHERE device_id=?")
    .bind(actor.deviceId)
    .run();
  expect((await admin.request("/api/peer/poll", { id: current.id })).status).toBe(410);
  await device.request("/api/peer/device", next);
  const expired = peerSessionSchema.parse(
    await (await admin.request("/api/peer/open", { deviceId: actor.deviceId })).json(),
  );
  await env.DB.prepare("UPDATE peer_session SET expires_at=0 WHERE id=?").bind(expired.id).run();
  expect((await admin.request("/api/peer/poll", { id: expired.id })).status).toBe(410);
});

test("device revocation and member removal terminate both sides of live signaling", async () => {
  const { admin, device, actor, source } = await liveSetup();
  const operator = await teammate(admin);
  const operatorActor = memberSchema.parse(
    await (await operator.request("/api/access/principal")).json(),
  );
  const session = peerSessionSchema.parse(
    await (await operator.request("/api/peer/open", { deviceId: actor.deviceId })).json(),
  );
  await admin.request("/api/access/remove-member", { id: operatorActor.userId });
  expect((await operator.request("/api/peer/poll", { id: session.id })).status).toBe(403);
  expect(
    peerSyncSchema.parse(await (await device.request("/api/peer/device", source)).json()).session,
  ).toBeNull();
  const current = peerSessionSchema.parse(
    await (await admin.request("/api/peer/open", { deviceId: actor.deviceId })).json(),
  );
  await admin.request("/api/access/devices/revoke", { id: actor.deviceId });
  expect((await admin.request("/api/peer/poll", { id: current.id })).status).toBe(410);
  expect((await device.request("/api/peer/device", source)).status).toBe(401);
});

test("a real alarm survives object eviction and publishes one follow-up using the incident policy snapshot", async () => {
  const { admin, device, report, rule } = await incidentSetup(1);
  const created = reportReceiptSchema.parse(
    await (await device.request("/api/incidents/reports", report)).json(),
  ).incident;
  expect(created.followUp).toEqual({ kind: "scheduled", dueAt: created.receivedAt + 1000 });
  await harness.getWorker().evictDurableObject("INCIDENT_FOLLOW_UP", { name: created.id });
  await admin.request("/api/config/rules/update", {
    ...rule,
    definition: { ...rule.definition, escalationDelaySeconds: 3600 },
  });
  const detail = async () =>
    incidentSchema.parse(await (await admin.request(`/api/incidents/detail/${created.id}`)).json());
  await expect
    .poll(async () => (await detail()).followUp.kind, { timeout: 10_000 })
    .toBe("attempted");
  const attempted = await detail();
  expect(attempted).toMatchObject({ status: "open", owner: null, version: 1, rule });
  expect(attempted.timeline.map((entry) => entry.kind)).toEqual([
    "reported",
    "follow-up-attempted",
  ]);
  const env = await harness.getWorker<Cloudflare.Env>().getEnv();
  const alarm = env.INCIDENT_FOLLOW_UP.getByName(created.id);
  await Promise.all([alarm.dispatch(), alarm.dispatch()]);
  expect(await detail()).toEqual(attempted);
  expect(
    reportReceiptSchema.parse(await (await device.request("/api/incidents/reports", report)).json())
      .incident,
  ).toEqual(attempted);
  expect(
    incidentInboxSchema.parse(await (await admin.request("/api/incidents/alerts")).json())
      .incidents,
  ).toEqual([attempted]);
});

test("acknowledge, dismiss and resolve prevent new follow-up attempts, including repeated alarm delivery", async () => {
  const { admin, device, report } = await incidentSetup();
  const env = await harness.getWorker<Cloudflare.Env>().getEnv();
  for (const action of ["acknowledge", "dismiss", "resolve"]) {
    const created = reportReceiptSchema.parse(
      await (
        await device.request("/api/incidents/reports", {
          ...report,
          eventId: crypto.randomUUID(),
        })
      ).json(),
    ).incident;
    const path = `/api/incidents/commands/${created.id}`;
    const preparation =
      action === "resolve"
        ? await admin.request(path, { action: "acknowledge", version: 1 })
        : null;
    const response = await admin.request(path, { action, version: action === "resolve" ? 2 : 1 });
    expect([preparation?.status ?? 200, response.status]).toEqual([200, 200]);
    await env.DB.prepare("UPDATE incident SET follow_up_due_at=0 WHERE id=?")
      .bind(created.id)
      .run();
    const alarm = env.INCIDENT_FOLLOW_UP.getByName(created.id);
    await Promise.all([alarm.dispatch(), alarm.dispatch()]);
    const stopped = incidentSchema.parse(
      await (await admin.request(`/api/incidents/detail/${created.id}`)).json(),
    );
    expect(stopped.followUp.kind).toBe("cancelled");
    expect(stopped.timeline.some((entry) => entry.kind === "follow-up-attempted")).toBe(false);
  }
});

test("acknowledgment racing dispatch either follows the submitted attempt or prevents it atomically", async () => {
  const { admin, device, report } = await incidentSetup();
  const env = await harness.getWorker<Cloudflare.Env>().getEnv();
  for (let index = 0; index < 6; index++) {
    const created = reportReceiptSchema.parse(
      await (
        await device.request("/api/incidents/reports", {
          ...report,
          eventId: crypto.randomUUID(),
        })
      ).json(),
    ).incident;
    await env.DB.prepare("UPDATE incident SET follow_up_due_at=0 WHERE id=?")
      .bind(created.id)
      .run();
    const alarm = env.INCIDENT_FOLLOW_UP.getByName(created.id);
    const [, acknowledgment] = await Promise.all([
      alarm.dispatch(),
      admin.request(`/api/incidents/commands/${created.id}`, { action: "acknowledge", version: 1 }),
    ]);
    expect(acknowledgment.status).toBe(200);
    await alarm.dispatch();
    const result = incidentSchema.parse(
      await (await admin.request(`/api/incidents/detail/${created.id}`)).json(),
    );
    expect(result.status).toBe("acknowledged");
    expect(result.timeline.map((entry) => entry.kind)).toEqual(
      result.followUp.kind === "attempted"
        ? ["reported", "follow-up-attempted", "acknowledged"]
        : ["reported", "acknowledged"],
    );
  }
});

test("failed in-app publication leaves no partial attempt and retries without duplication", async () => {
  const { admin, device, report } = await incidentSetup();
  const created = reportReceiptSchema.parse(
    await (await device.request("/api/incidents/reports", report)).json(),
  ).incident;
  const env = await harness.getWorker<Cloudflare.Env>().getEnv();
  await env.DB.prepare("UPDATE incident SET follow_up_due_at=0 WHERE id=?").bind(created.id).run();
  await env.DB.prepare(
    "CREATE TRIGGER fail_follow_up BEFORE UPDATE OF follow_up_attempted_at ON incident BEGIN SELECT RAISE(ABORT,'synthetic delivery failure'); END",
  ).run();
  const failedAlarm = env.INCIDENT_FOLLOW_UP.getByName(created.id);
  await expect(failedAlarm.dispatch()).rejects.toBeInstanceOf(Error);
  const failed = incidentSchema.parse(
    await (await admin.request(`/api/incidents/detail/${created.id}`)).json(),
  );
  expect(failed.followUp.kind).toBe("scheduled");
  expect(failed.timeline.map((entry) => entry.kind)).toEqual(["reported"]);
  await env.DB.prepare("DROP TRIGGER fail_follow_up").run();
  await env.INCIDENT_FOLLOW_UP.getByName(created.id).dispatch();
  const recovered = incidentSchema.parse(
    await (await admin.request(`/api/incidents/detail/${created.id}`)).json(),
  );
  expect(recovered.followUp.kind).toBe("attempted");
  expect(recovered.timeline.map((entry) => entry.kind)).toEqual([
    "reported",
    "follow-up-attempted",
  ]);
});

test("a failed creation resets the object and recovers its durable intent through the real alarm", async () => {
  const { admin, device, report } = await incidentSetup(1);
  const worker = harness.getWorker();
  const env = await harness.getWorker<Cloudflare.Env>().getEnv();
  await env.DB.prepare(
    "CREATE TRIGGER fail_creation BEFORE INSERT ON incident BEGIN SELECT RAISE(ABORT,'synthetic insertion failure'); END",
  ).run();
  expect((await device.request("/api/incidents/reports", report)).status).toBe(500);
  const ids = await worker.listDurableObjectIds("INCIDENT_FOLLOW_UP");
  expect(ids).toHaveLength(1);
  await env.DB.prepare("DROP TRIGGER fail_creation").run();
  await expect(worker.evictDurableObject("INCIDENT_FOLLOW_UP", { id: ids[0]! })).rejects.toThrow(
    "it is not currently running",
  );
  const inbox = async () =>
    incidentInboxSchema.parse(await (await admin.request("/api/incidents/inbox")).json()).incidents;
  await expect
    .poll(async () => (await inbox())[0]?.followUp.kind, { timeout: 10_000 })
    .toBe("attempted");
  const recovered = await inbox();
  expect(recovered).toHaveLength(1);
  expect(recovered[0]?.timeline.map((entry) => entry.kind)).toEqual([
    "reported",
    "follow-up-attempted",
  ]);
  expect((await device.request("/api/incidents/reports", report)).status).toBe(200);
  expect(await inbox()).toEqual(recovered);
});
