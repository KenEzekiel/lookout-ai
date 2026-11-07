import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { beforeAll, beforeEach, afterAll, expect, test } from "vitest";
import { createTestHarness } from "wrangler";
import { memberSchema, pairingSchema, devicePrincipalSchema } from "../../src/lib/access";
import { ruleSchema, sourceSchema, conditionText } from "../../src/lib/rules";
import { type AssessmentRequest } from "../../src/lib/assessment";

const origin = "http://localhost:3000";
const apiKey = "test-only-lookout-relay-secret";
const requests: { path: string; authorization: string | undefined; body: unknown }[] = [];
let respond: (response: ServerResponse, path: string) => void;
const provider = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
  requests.push({ path: request.url ?? "", authorization: request.headers.authorization, body });
  respond(response, request.url ?? "");
});
const harness = createTestHarness();
beforeAll(async () => {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  assert(address && typeof address !== "string");
  await harness.update({
    workers: [
      {
        configPath: "./dist/server/wrangler.json",
        vars: { APP_URL: origin, OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1` },
        secrets: { BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), OPENAI_API_KEY: apiKey },
      },
    ],
  });
});
beforeEach(async () => {
  requests.length = 0;
  respond = (response, path) =>
    response.end(JSON.stringify(path.endsWith("decisions") ? decisions : review("positive")));
  await harness.listen();
  await harness.reset();
  await harness.getWorker<Cloudflare.Env>().applyD1Migrations("DB");
  harness.clearLogs();
});
afterAll(async () => {
  await harness.close();
  provider.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    provider.close((error) => (error ? reject(error) : resolve())),
  );
});
const observation: AssessmentRequest["observation"] = {
  stage: "assessment",
  frames: [
    {
      id: crypto.randomUUID(),
      mediaTimeMs: 0,
      image: new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }),
    },
    {
      id: crypto.randomUUID(),
      mediaTimeMs: 500,
      image: new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }),
    },
  ],
};
const decisions = {
  answers: [
    { type: "predicate", name: "unclear", probability: 0.2 },
    { type: "predicate", name: "match", probability: 0.75 },
  ],
  private_debug: apiKey,
};
function review(outcome: string) {
  return {
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ outcome, explanation: "Visible evidence reviewed." }),
          },
        ],
      },
    ],
  };
}
class Browser {
  cookies = new Map<string, string>();
  async request(path: string, body?: unknown, headers: Record<string, string> = {}) {
    let payload: string | FormData | ArrayBuffer | undefined =
      body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    if (body instanceof FormData) payload = body;
    else if (path === "/api/assessment" && typeof body === "object" && body !== null) {
      const form = new FormData();
      let index = 0;
      const metadata = JSON.stringify(body, (key, value) => {
        if (key === "image" && value instanceof Blob) {
          form.append(`frame-${index++}`, value, "frame.jpg");
          return undefined;
        }
        return value;
      });
      form.set("metadata", metadata);
      payload = form;
    }
    if (payload instanceof FormData) {
      const encoded = new Response(payload);
      headers = { "Content-Type": encoded.headers.get("content-type") ?? "", ...headers };
      payload = await encoded.arrayBuffer();
    }
    const response = await harness.fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
        ...headers,
      },
      body: payload,
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      if (!pair) continue;
      const index = pair.indexOf("=");
      if (index < 1) continue;
      if (/Max-Age=0/i.test(cookie)) this.cookies.delete(pair.slice(0, index));
      else this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  async register() {
    const response = await this.request("/api/auth/sign-up/email", {
      name: "Relay tester",
      email: `${crypto.randomUUID()}@example.com`,
      password: "test-password-123",
    });
    assert.equal(response.status, 200);
  }
}
async function configuredDevice() {
  const owner = new Browser();
  await owner.register();
  expect((await owner.request("/api/access/workspace", { name: "Relay test" })).status).toBe(201);
  const actor = memberSchema.parse(await (await owner.request("/api/access/principal")).json());
  const source = sourceSchema.parse(
    await (await owner.request("/api/config/sources", { name: "Camera", kind: "camera" })).json(),
  );
  const rule = ruleSchema.parse(
    await (
      await owner.request("/api/config/rules/create", {
        sourceId: source.id,
        enabled: true,
        definition: {
          name: "Fall",
          condition: { kind: "template", template: "fall" },
          durationSeconds: null,
          severity: "critical",
          recipientIds: [actor.userId],
          escalationDelaySeconds: 30,
        },
      })
    ).json(),
  );
  const browser = new Browser();
  const pairing = pairingSchema.parse(
    await (await browser.request("/api/access/pairing/start", {})).json(),
  );
  expect(
    (await owner.request("/api/access/pairing/approve", { code: pairing.code, name: "Camera" }))
      .status,
  ).toBe(200);
  expect((await browser.request("/api/access/pairing/claim", {})).status).toBe(200);
  const input: AssessmentRequest = {
    rule: { id: rule.id, version: rule.version },
    sourceId: source.id,
    observation,
  };
  return { browser, owner, rule, input, workspaceId: actor.workspaceId };
}

test("authorized device gets typed probabilities without retaining images, decisions or secrets", async () => {
  const { browser, input, rule } = await configuredDevice();
  const response = await browser.request("/api/assessment", input);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    kind: "assessment",
    matchProbability: 0.75,
    unclearProbability: 0.2,
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    path: "/v1/decisions",
    authorization: `Bearer ${apiKey}`,
    body: {
      model: "gpt-6-luna",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Monitoring condition: ${conditionText(rule.definition.condition)}`,
            },
            { type: "input_text", text: "Source time: 0 ms." },
            { type: "input_image", image_url: "data:image/jpeg;base64,/9j/", detail: "high" },
            { type: "input_text", text: "Source time: 500 ms." },
            { type: "input_image", image_url: "data:image/jpeg;base64,/9j/", detail: "high" },
          ],
        },
      ],
    },
  });
  const env = await harness.getWorker<Cloudflare.Env>().getEnv();
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  ).all<{ name: string }>();
  for (const { name } of tables.results) {
    const rows = await env.DB.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all();
    expect(JSON.stringify(rows)).not.toContain("data:image/jpeg");
    expect(JSON.stringify(rows)).not.toContain(apiKey);
    expect(JSON.stringify(rows)).not.toContain("matchProbability");
  }
  expect(JSON.stringify(harness.getLogs())).not.toContain("data:image/jpeg");
  expect(JSON.stringify(harness.getLogs())).not.toContain(apiKey);
});

test.each(["positive", "rejected", "need_more_evidence"])(
  "review preserves %s through the Worker",
  async (outcome) => {
    const { browser, input } = await configuredDevice();
    respond = (response) => response.end(JSON.stringify(review(outcome)));
    const result = await browser.request("/api/assessment", {
      ...input,
      observation: { ...observation, stage: "review" },
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      kind: "review",
      outcome,
      explanation: "Visible evidence reviewed.",
    });
    expect(requests[0]).toMatchObject({
      path: "/v1/responses",
      body: {
        model: "gpt-6.1-terra",
        reasoning: { effort: "medium" },
        store: false,
        max_output_tokens: 4096,
        text: {
          format: {
            type: "json_schema",
            strict: true,
            schema: { type: "object", additionalProperties: false },
          },
        },
      },
    });
  },
);

test("visitors, humans, wrong origins and revoked devices cannot call OpenAI", async () => {
  const visitor = new Browser();
  expect((await visitor.request("/api/assessment", {})).status).toBe(401);
  await visitor.register();
  expect((await visitor.request("/api/assessment", {})).status).toBe(403);
  const { browser, owner, input } = await configuredDevice();
  expect((await owner.request("/api/assessment", input)).status).toBe(403);
  expect(
    (await browser.request("/api/assessment", input, { Origin: "https://attacker.example" }))
      .status,
  ).toBe(403);
  const device = devicePrincipalSchema.parse(
    await (await browser.request("/api/access/principal")).json(),
  );
  expect((await owner.request("/api/access/devices/revoke", { id: device.deviceId })).status).toBe(
    200,
  );
  expect((await browser.request("/api/assessment", input)).status).toBe(401);
  expect(requests).toHaveLength(0);
});

test("cross-workspace, mismatched, stale and disabled rules never reach OpenAI", async () => {
  const first = await configuredDevice();
  const second = await configuredDevice();
  for (const input of [
    second.input,
    { ...first.input, sourceId: second.input.sourceId },
    { ...first.input, rule: { ...first.input.rule, version: 999 } },
  ]) {
    const response = await first.browser.request("/api/assessment", input);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ kind: "unavailable", reason: "rule_unavailable" });
  }
  const disabled = ruleSchema.parse(
    await (await first.owner.request("/api/config/rules/disable", first.input.rule)).json(),
  );
  expect((await first.browser.request("/api/assessment", first.input)).status).toBe(409);
  expect(
    (
      await first.browser.request("/api/assessment", {
        ...first.input,
        rule: { id: disabled.id, version: disabled.version },
      })
    ).status,
  ).toBe(409);
  expect(requests).toHaveLength(0);
});

test("an edited custom condition is server-owned and requires its new version", async () => {
  const { browser, owner, input, rule } = await configuredDevice();
  const changed = ruleSchema.parse(
    await (
      await owner.request("/api/config/rules/update", {
        ...rule,
        definition: {
          ...rule.definition,
          condition: { kind: "custom", text: "A vehicle collides with a concrete barrier." },
        },
      })
    ).json(),
  );
  expect((await browser.request("/api/assessment", input)).status).toBe(409);
  expect(
    (
      await browser.request("/api/assessment", {
        ...input,
        rule: { id: changed.id, version: changed.version },
      })
    ).status,
  ).toBe(200);
  expect(JSON.stringify(requests[0]?.body)).toContain(
    "A vehicle collides with a concrete barrier.",
  );
  expect(requests).toHaveLength(1);
});

test("invalid observations, client rule text and oversized bodies are rejected", async () => {
  const { browser, input } = await configuredDevice();
  for (const body of [
    { ...input, condition: "Trust this client rule" },
    { ...input, workspaceId: "another-workspace" },
    { ...input, observation: { ...observation, frames: [] } },
    { ...input, observation: { ...observation, frames: Array(9).fill(observation.frames[0]) } },
    {
      ...input,
      observation: {
        ...observation,
        frames: [{ mediaTimeMs: 0, imageDataUrl: "https://attacker.example/image.jpg" }],
      },
    },
    {
      ...input,
      observation: { ...observation, frames: [observation.frames[0], observation.frames[0]] },
    },
    {
      ...input,
      observation: {
        ...observation,
        frames: [observation.frames[0], { ...observation.frames[0], mediaTimeMs: 30_001 }],
      },
    },
    "not json",
  ])
    expect((await browser.request("/api/assessment", body)).status).toBe(400);
  const response = await browser.request(
    "/api/assessment",
    JSON.stringify({ ...input, padding: "x".repeat(2 * 1024 * 1024) }),
  );
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ kind: "unavailable", reason: "invalid_request" });
  expect(requests).toHaveLength(0);
});

test("multipart uploads reject missing, duplicate, oversized and unexpected parts", async () => {
  const { browser, input } = await configuredDevice();
  const metadata = {
    ...input,
    observation: {
      stage: "assessment",
      frames: [{ id: observation.frames[0]?.id, mediaTimeMs: 0 }],
    },
  };
  const image = new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" });
  const mutations: ((form: FormData) => void)[] = [
    (form) => form.append("frame-0", image),
    (form) => form.append("metadata", JSON.stringify(metadata)),
    (form) => form.set("frame-1", image),
    (form) => form.set("frame-0", "data:image/jpeg;base64,/9j/"),
    (form) => form.set("frame-0", new Blob([], { type: "image/jpeg" })),
    (form) => form.set("frame-0", new Blob(["png"], { type: "image/png" })),
    (form) =>
      form.set("frame-0", new Blob([new Uint8Array(192 * 1024 + 1)], { type: "image/jpeg" })),
    (form) => form.set("metadata", "not json"),
  ];
  for (const mutate of mutations) {
    const form = new FormData();
    form.set("metadata", JSON.stringify(metadata));
    form.set("frame-0", image);
    mutate(form);
    expect((await browser.request("/api/assessment", form)).status).toBe(400);
  }
  const oversized = new FormData();
  oversized.set("metadata", JSON.stringify(metadata));
  oversized.set("frame-0", new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "image/jpeg" }));
  expect((await browser.request("/api/assessment", oversized)).status).toBe(413);
  expect((await browser.request("/api/assessment", JSON.stringify(metadata))).status).toBe(400);
  expect(requests).toHaveLength(0);
});

test.each([
  { answers: [] },
  {
    answers: [
      { type: "predicate", name: "match", probability: 2 },
      { type: "predicate", name: "unclear", probability: 0 },
    ],
  },
  {
    answers: [
      { type: "predicate", name: "match", probability: 0.8 },
      { type: "predicate", name: "match", probability: 0.9 },
    ],
  },
])("malformed Decisions output cannot become a negative", async (body) => {
  const { browser, input } = await configuredDevice();
  respond = (response) => response.end(JSON.stringify(body));
  expect(await (await browser.request("/api/assessment", input)).json()).toEqual({
    kind: "unavailable",
    reason: "invalid_result",
  });
});

test.each([
  { status: "incomplete", output: [] },
  review("invented"),
  {
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "not json" }],
      },
    ],
  },
])("malformed or incomplete review is unavailable", async (body) => {
  const { browser, input } = await configuredDevice();
  respond = (response) => response.end(JSON.stringify(body));
  expect(
    await (
      await browser.request("/api/assessment", {
        ...input,
        observation: { ...observation, stage: "review" },
      })
    ).json(),
  ).toEqual({ kind: "unavailable", reason: "invalid_result" });
});

test("both refusal formats remain distinct from negative observations", async () => {
  const { browser, input } = await configuredDevice();
  respond = (response, path) =>
    response.end(
      JSON.stringify(
        path.endsWith("decisions")
          ? {
              answers: [
                { type: "refusal", name: "match" },
                { type: "predicate", name: "unclear", probability: 0.2 },
              ],
            }
          : {
              status: "completed",
              output: [
                {
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "refusal", refusal: "Cannot evaluate." }],
                },
              ],
            },
      ),
    );
  for (const stage of ["assessment", "review"]) {
    expect(
      await (
        await browser.request("/api/assessment", {
          ...input,
          observation: { ...observation, stage },
        })
      ).json(),
    ).toEqual({ kind: "unavailable", reason: "provider_refusal" });
  }
});

test("provider errors are sanitized without retries; malformed response bodies are bounded", async () => {
  const { browser, input } = await configuredDevice();
  respond = (response) => {
    response.writeHead(429);
    response.end(`${apiKey} private-image-data`);
  };
  expect(await (await browser.request("/api/assessment", input)).json()).toEqual({
    kind: "unavailable",
    reason: "provider_error",
  });
  expect(requests).toHaveLength(1);
  for (const body of ["not json", "x".repeat(65 * 1024)]) {
    respond = (response) => response.end(body);
    expect(await (await browser.request("/api/assessment", input)).json()).toEqual({
      kind: "unavailable",
      reason: "invalid_result",
    });
  }
  expect(JSON.stringify(harness.getLogs())).not.toContain(apiKey);
});

test("the deadline covers a stalled provider body through the Worker", async () => {
  const { browser, input } = await configuredDevice();
  respond = (response) => {
    response.writeHead(200);
    response.write('{"answers":');
  };
  const result = await browser.request("/api/assessment", input);
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ kind: "unavailable", reason: "timeout" });
  expect(requests).toHaveLength(1);
});

test("review and device admission quotas cap external usage", async () => {
  const { browser, input } = await configuredDevice();
  for (let index = 0; index < 7; index++) {
    const result = await browser.request("/api/assessment", {
      ...input,
      observation: { ...observation, stage: "review" },
    });
    expect(result.status).toBe(index < 6 ? 200 : 429);
  }
  expect(requests).toHaveLength(6);
  const responses = await Promise.all(
    Array.from({ length: 54 }, () => browser.request("/api/assessment", input)),
  );
  expect(responses.filter((response) => response.status === 200)).toHaveLength(53);
  expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
});

test("workspace quotas apply across devices", async () => {
  const { browser, input, workspaceId } = await configuredDevice();
  const env = await harness.getWorker<Cloudflare.Env>().getEnv();
  await env.DB.prepare("INSERT INTO attempt_limit(key,count,expires_at) VALUES (?,240,?)")
    .bind(`assessment:workspace:${workspaceId}`, Date.now() + 60_000)
    .run();
  expect((await browser.request("/api/assessment", input)).status).toBe(429);
  expect(requests).toHaveLength(0);
});

test("provider redirects are not followed with the model credential", async () => {
  const { browser, input } = await configuredDevice();
  respond = (response) => {
    response.writeHead(302, { Location: "/credential-sink" });
    response.end();
  };
  expect(await (await browser.request("/api/assessment", input)).json()).toEqual({
    kind: "unavailable",
    reason: "provider_error",
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.path).toBe("/v1/decisions");
});

test("missing model credentials produce an explicit failure without external requests", async () => {
  const { browser, input } = await configuredDevice();
  await harness.update((options) => ({
    ...options,
    workers: options.workers.map((worker) =>
      "configPath" in worker
        ? { ...worker, secrets: { ...worker.secrets, OPENAI_API_KEY: "" } }
        : worker,
    ),
  }));
  const response = await browser.request("/api/assessment", input);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ kind: "unavailable", reason: "provider_not_configured" });
  expect(requests).toHaveLength(0);
});

function frameForm(input: AssessmentRequest, uploadIds: string[] = []) {
  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({
      ...input,
      observation: {
        ...input.observation,
        frames: input.observation.frames.map(({ id, mediaTimeMs }) => ({ id, mediaTimeMs })),
      },
    }),
  );
  input.observation.frames.forEach((frame, index) => {
    if (uploadIds.includes(frame.id)) form.set(`frame-${index}`, frame.image, "frame.jpg");
  });
  return form;
}

async function anotherDevice(owner: Browser) {
  const browser = new Browser();
  const pairing = pairingSchema.parse(
    await (await browser.request("/api/access/pairing/start", {})).json(),
  );
  expect(
    (
      await owner.request("/api/access/pairing/approve", {
        code: pairing.code,
        name: "Other camera",
      })
    ).status,
  ).toBe(200);
  expect((await browser.request("/api/access/pairing/claim", {})).status).toBe(200);
  return browser;
}

test("overlapping windows reuse cached frames and missing frames explicitly request re-upload", async () => {
  const { browser, input } = await configuredDevice();
  const missing = await browser.request("/api/assessment", frameForm(input));
  expect(missing.status).toBe(409);
  expect(await missing.json()).toEqual({
    kind: "frames_missing",
    frameIds: input.observation.frames.map((frame) => frame.id),
  });
  expect(requests).toHaveLength(0);
  const first = await browser.request("/api/assessment", input);
  expect(first.status).toBe(200);
  const receipts = first.headers.get("X-Lookout-Frames");
  const next = {
    id: crypto.randomUUID(),
    mediaTimeMs: 1_000,
    image: new Blob([new Uint8Array([255, 216, 254])], { type: "image/jpeg" }),
  };
  const overlapping = {
    ...input,
    observation: { ...input.observation, frames: [...input.observation.frames, next] },
  };
  const second = await browser.request("/api/assessment", frameForm(overlapping, [next.id]));
  expect(second.status).toBe(200);
  expect(JSON.stringify(requests[1]?.body)).toContain("data:image/jpeg;base64,/9j+");
  const repeated = await browser.request("/api/assessment", frameForm(input));
  expect(repeated.status).toBe(200);
  expect(repeated.headers.get("X-Lookout-Frames")).toBe(receipts);
  expect(requests[2]?.body).toEqual(requests[0]?.body);
});

test("cache references are isolated between devices, workspaces and sources", async () => {
  const { browser, owner, input, rule } = await configuredDevice();
  expect((await browser.request("/api/assessment", input)).status).toBe(200);
  const peer = await anotherDevice(owner);
  expect((await peer.request("/api/assessment", frameForm(input))).status).toBe(409);
  const other = await configuredDevice();
  expect((await other.browser.request("/api/assessment", frameForm(other.input))).status).toBe(409);
  const source = sourceSchema.parse(
    await (
      await owner.request("/api/config/sources", { name: "Second source", kind: "camera" })
    ).json(),
  );
  const otherRule = ruleSchema.parse(
    await (
      await owner.request("/api/config/rules/create", {
        sourceId: source.id,
        enabled: true,
        definition: rule.definition,
      })
    ).json(),
  );
  const otherSource = {
    ...input,
    sourceId: source.id,
    rule: { id: otherRule.id, version: otherRule.version },
  };
  expect((await browser.request("/api/assessment", frameForm(otherSource))).status).toBe(409);
  expect(requests).toHaveLength(1);
});

test("cached IDs cannot change bytes or timestamps and concurrent reads preserve the window", async () => {
  const { browser, input } = await configuredDevice();
  expect((await browser.request("/api/assessment", input)).status).toBe(200);
  const changed = {
    ...input,
    observation: {
      ...input.observation,
      frames: input.observation.frames.map((frame) => ({
        ...frame,
        image: new Blob(["different"], { type: "image/jpeg" }),
      })),
    },
  };
  expect((await browser.request("/api/assessment", changed)).status).toBe(400);
  const retimed = {
    ...input,
    observation: {
      ...input.observation,
      frames: input.observation.frames.map((frame) => ({
        ...frame,
        mediaTimeMs: frame.mediaTimeMs + 1,
      })),
    },
  };
  expect((await browser.request("/api/assessment", frameForm(retimed))).status).toBe(400);
  const concurrent = await Promise.all(
    Array.from({ length: 4 }, () => browser.request("/api/assessment", frameForm(input))),
  );
  expect(concurrent.map((response) => response.status)).toEqual([200, 200, 200, 200]);
  expect(requests).toHaveLength(5);
});

test.each([3, 192 * 1024])(
  "device cache evicts oldest frames at its count or byte cap (%s-byte frames)",
  async (size) => {
    const { browser, input } = await configuredDevice();
    expect((await browser.request("/api/assessment", input)).status).toBe(200);
    let latest = input;
    for (let batch = 0; batch < 9; batch++) {
      latest = {
        ...input,
        observation: {
          ...input.observation,
          frames: Array.from({ length: 8 }, (_, index) => ({
            id: crypto.randomUUID(),
            mediaTimeMs: index,
            image: new Blob([new Uint8Array(size)], { type: "image/jpeg" }),
          })),
        },
      };
      expect((await browser.request("/api/assessment", latest)).status).toBe(200);
    }
    expect((await browser.request("/api/assessment", frameForm(input))).status).toBe(409);
    expect((await browser.request("/api/assessment", frameForm(latest))).status).toBe(200);
  },
);

test("workspace cache evicts across devices while retaining the active request", async () => {
  const { browser, owner, input } = await configuredDevice();
  expect((await browser.request("/api/assessment", input)).status).toBe(200);
  for (let device = 0; device < 4; device++) {
    const peer = await anotherDevice(owner);
    for (let batch = 0; batch < 7; batch++) {
      const upload = {
        ...input,
        observation: {
          ...input.observation,
          frames: Array.from({ length: 8 }, (_, index) => ({
            id: crypto.randomUUID(),
            mediaTimeMs: index,
            image: new Blob(["jpg"], { type: "image/jpeg" }),
          })),
        },
      };
      expect((await peer.request("/api/assessment", upload)).status).toBe(200);
    }
  }
  expect((await browser.request("/api/assessment", frameForm(input))).status).toBe(409);
});

test("frames expire after 60 seconds without read-based renewal and can be re-uploaded", async () => {
  const { browser, input } = await configuredDevice();
  const first = await browser.request("/api/assessment", input);
  expect(first.status).toBe(200);
  const repeated = await browser.request("/api/assessment", frameForm(input));
  expect(repeated.headers.get("X-Lookout-Frames")).toBe(first.headers.get("X-Lookout-Frames"));
  await new Promise((resolve) => setTimeout(resolve, 60_050));
  expect((await browser.request("/api/assessment", frameForm(input))).status).toBe(409);
  expect(requests).toHaveLength(2);
  expect((await browser.request("/api/assessment", input)).status).toBe(200);
}, 75_000);
