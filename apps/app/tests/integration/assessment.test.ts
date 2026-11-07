import { expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../support/server";
import { requestAssessment, type AssessmentRequest } from "../../src/lib/assessment";

const observation: AssessmentRequest = {
  rule: { id: "rule-1", version: 1 },
  sourceId: "source-1",
  observation: {
    stage: "review",
    frames: [{ mediaTimeMs: 0, imageDataUrl: "data:image/jpeg;base64,/9j/" }],
  },
};

test("client transport sends only the observation and preserves rule rejection", async () => {
  server.use(
    http.post("/api/assessment", async ({ request }) => {
      expect(await request.json()).toEqual(observation);
      expect(request.headers.has("authorization")).toBe(false);
      return HttpResponse.json(
        { kind: "unavailable", reason: "rule_unavailable" },
        { status: 409 },
      );
    }),
  );
  expect(await requestAssessment(observation)).toEqual({
    kind: "unavailable",
    reason: "rule_unavailable",
  });
});

test.each(["positive", "rejected", "need_more_evidence"])(
  "client preserves the %s review result",
  async (outcome) => {
    const result = { kind: "review", outcome, explanation: "Visible evidence." };
    server.use(http.post("/api/assessment", () => HttpResponse.json(result)));
    expect(await requestAssessment(observation)).toEqual(result);
  },
);

test.each([
  [401, "unauthorized"],
  [403, "unauthorized"],
  [429, "rate_limited"],
  [413, "invalid_request"],
])("client maps HTTP %s without exposing error bodies", async (status, reason) => {
  server.use(
    http.post(
      "/api/assessment",
      () => new HttpResponse("private error", { status: Number(status) }),
    ),
  );
  expect(await requestAssessment(observation)).toEqual({ kind: "unavailable", reason });
});

test("mismatched stages and invalid result schemas cannot become review successes", async () => {
  server.use(
    http.post("/api/assessment", () =>
      HttpResponse.json({ kind: "assessment", matchProbability: 1, unclearProbability: 0 }),
    ),
  );
  expect(await requestAssessment(observation)).toEqual({
    kind: "unavailable",
    reason: "invalid_result",
  });
  server.use(
    http.post("/api/assessment", () => HttpResponse.json({ kind: "review", outcome: "unknown" })),
  );
  expect(await requestAssessment(observation)).toEqual({
    kind: "unavailable",
    reason: "invalid_result",
  });
});

test("network failure and cancellation remain explicit failures", async () => {
  server.use(http.post("/api/assessment", () => HttpResponse.error()));
  expect(await requestAssessment(observation)).toEqual({
    kind: "unavailable",
    reason: "network_error",
  });
  const controller = new AbortController();
  controller.abort();
  expect(await requestAssessment(observation, controller.signal)).toEqual({
    kind: "unavailable",
    reason: "cancelled",
  });
});
