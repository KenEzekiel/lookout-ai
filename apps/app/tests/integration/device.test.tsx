import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, test } from "vitest";
import { getRouter } from "../../src/router";
import { server } from "../support/server";

const originals = {
  mediaDevices: Object.getOwnPropertyDescriptor(navigator, "mediaDevices"),
  recorder: Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder"),
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
  play: HTMLMediaElement.prototype.play,
  pause: HTMLMediaElement.prototype.pause,
  load: HTMLMediaElement.prototype.load,
  width: Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "videoWidth"),
  height: Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "videoHeight"),
  context: HTMLCanvasElement.prototype.getContext,
  toDataURL: HTMLCanvasElement.prototype.toDataURL,
};

let cameraError: DOMException | null;
let tracksStopped: number;
let recordersStopped: number;
let urlsRevoked: number;
let endCameraTrack: () => void;

class BrowserRecorder {
  state: RecordingState = "inactive";
  mimeType = "video/webm";
  ondataavailable: ((event: BlobEvent) => void) | null = null;

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    recordersStopped += 1;
  }
}

beforeEach(() => {
  server.use(
    http.get("/api/config/device", () => HttpResponse.json({ sources: [], rules: [] })),
    http.get("/api/access/principal", () =>
      HttpResponse.json({
        kind: "device",
        deviceId: "camera-one",
        workspaceId: "demo-workspace",
        workspaceName: "Demo workspace",
        name: "Camera one",
      }),
    ),
  );
  cameraError = null;
  tracksStopped = 0;
  recordersStopped = 0;
  urlsRevoked = 0;
  let ended: (() => void) | null = null;
  const track = {
    stop: () => {
      tracksStopped += 1;
    },
    addEventListener: (name: string, handler: () => void) => {
      if (name === "ended") ended = handler;
    },
    removeEventListener: (name: string) => {
      if (name === "ended") ended = null;
    },
  };
  endCameraTrack = () => {
    ended?.();
  };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        if (cameraError) throw cameraError;
        return {
          getTracks: () => [track],
          getVideoTracks: () => [track],
        } as unknown as MediaStream;
      },
    },
  });
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: BrowserRecorder,
  });
  URL.createObjectURL = () => "blob:test-video";
  URL.revokeObjectURL = () => {
    urlsRevoked += 1;
  };
  HTMLMediaElement.prototype.play = async () => {};
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get: () => 640,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    get: () => 360,
  });
  HTMLCanvasElement.prototype.getContext = (() =>
    ({
      drawImage: () => {},
    }) as unknown as CanvasRenderingContext2D) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,AAAA";
});

afterEach(() => {
  cleanup();
  if (originals.mediaDevices)
    Object.defineProperty(navigator, "mediaDevices", originals.mediaDevices);
  else Reflect.deleteProperty(navigator, "mediaDevices");
  if (originals.recorder) Object.defineProperty(globalThis, "MediaRecorder", originals.recorder);
  else Reflect.deleteProperty(globalThis, "MediaRecorder");
  URL.createObjectURL = originals.createObjectURL;
  URL.revokeObjectURL = originals.revokeObjectURL;
  HTMLMediaElement.prototype.play = originals.play;
  HTMLMediaElement.prototype.pause = originals.pause;
  HTMLMediaElement.prototype.load = originals.load;
  if (originals.width)
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", originals.width);
  else Reflect.deleteProperty(HTMLVideoElement.prototype, "videoWidth");
  if (originals.height)
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", originals.height);
  else Reflect.deleteProperty(HTMLVideoElement.prototype, "videoHeight");
  HTMLCanvasElement.prototype.getContext = originals.context;
  HTMLCanvasElement.prototype.toDataURL = originals.toDataURL;
});

async function renderDevice() {
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/device"] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />, { container: document });
  await screen.findByRole("heading", { name: "Capture station" });
}

test("a camera starts, retains samples, and releases its tracks on Stop", async () => {
  await renderDevice();
  expect(await screen.findByRole("heading", { name: "Capture station" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("button", { name: "Stop" })).toBeVisible();
  expect(screen.getByText("Samples retained").parentElement).toHaveTextContent("1");
  expect(screen.getByText("Last sample").parentElement).not.toHaveTextContent("—");
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(screen.getByRole("button", { name: "Start" })).toBeVisible();
  expect(tracksStopped).toBe(1);
  expect(recordersStopped).toBe(1);
  expect(screen.getByText("Samples retained").parentElement).toHaveTextContent("0");
});

test("a local video starts and seeking or restarting creates a new capture epoch", async () => {
  await renderDevice();
  await userEvent.click(screen.getByLabelText("Source type"));
  await userEvent.click(await screen.findByRole("option", { name: "Local video" }));
  const file = new File(["video data"], "crash.mp4", { type: "video/mp4" });
  await userEvent.upload(screen.getByLabelText("Video file"), file);
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("button", { name: "Stop" })).toBeVisible();
  expect(screen.getByText("crash.mp4")).toBeVisible();
  expect(screen.getByText("Capture run").parentElement).toHaveTextContent("1");

  screen.getByLabelText("Source video").dispatchEvent(new Event("pause"));
  expect(await screen.findByText("Paused")).toBeVisible();
  expect(screen.getByRole("button", { name: "Stop" })).toBeVisible();

  screen.getByLabelText("Source video").dispatchEvent(new Event("seeking"));
  await waitFor(() => expect(screen.getByText("Capture run").parentElement).toHaveTextContent("2"));
  expect(screen.getByText("Samples retained").parentElement).toHaveTextContent("0");

  screen.getByLabelText("Source video").dispatchEvent(new Event("play"));
  await waitFor(() => expect(screen.getByText("Running")).toBeVisible());

  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(screen.getByText("Capture run").parentElement).toHaveTextContent("3");
  expect(urlsRevoked).toBe(1);
});

test("permission refusal and unavailable cameras show actionable errors", async () => {
  cameraError = new DOMException("Denied", "NotAllowedError");
  await renderDevice();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Allow access in your browser");
  expect(screen.getByText("Source unavailable")).toBeVisible();

  cameraError = new DOMException("Missing", "NotFoundError");
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No camera was found");
  expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
});

test("a disconnected camera stops monitoring and reports the failure", async () => {
  await renderDevice();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("button", { name: "Stop" })).toBeVisible();
  endCameraTrack();
  expect(await screen.findByRole("alert")).toHaveTextContent("Camera disconnected");
  expect(screen.getByRole("button", { name: "Start" })).toBeVisible();
  expect(tracksStopped).toBe(1);
});

test("an unpaired visitor cannot open the capture station", async () => {
  server.use(http.get("/api/access/principal", () => HttpResponse.json({ kind: "visitor" })));
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/device"] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />, { container: document });
  expect(await screen.findByLabelText("Email")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
});

const monitoringRule = {
  id: "rule-one",
  version: 1,
  sourceId: "source-one",
  enabled: true,
  definition: {
    name: "Possible fall",
    condition: { kind: "template", template: "fall" },
    durationSeconds: null,
    severity: "critical",
    recipientIds: ["owner-one"],
    escalationDelaySeconds: 30,
  },
};
const configuredSource = { id: "source-one", name: "Living room", kind: "camera" };
type Report = {
  sessionId: string;
  eventId: string;
  ruleId: string;
  ruleVersion: number;
  eventTime: number;
};
function monitoringApi({
  outcome = "positive",
  failReport = false,
  durationSeconds = null,
}: {
  outcome?: "positive" | "rejected" | "need_more_evidence" | "unavailable";
  failReport?: boolean;
  durationSeconds?: number | null;
} = {}) {
  const reports: Report[] = [];
  const observations: { stage: string; frames: { id: string; mediaTimeMs: number }[] }[] = [];
  const ended: string[] = [];
  const sessionId = crypto.randomUUID();
  let rule = { ...monitoringRule, definition: { ...monitoringRule.definition, durationSeconds } };
  let probability = 0.9;
  server.use(
    http.get("/api/config/device", () =>
      HttpResponse.json({ sources: [configuredSource], rules: [rule] }),
    ),
    http.post("/api/incidents/sessions", () =>
      HttpResponse.json({
        id: sessionId,
        sourceId: configuredSource.id,
        startedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      }),
    ),
    http.post("/api/incidents/sessions/end", async ({ request }) => {
      const body = (await request.json()) as { id: string };
      if (body.id === sessionId) ended.push(body.id);
      return HttpResponse.json({ ok: true });
    }),
    http.post("/api/assessment", async ({ request }) => {
      const form = await request.formData();
      const metadata = JSON.parse(String(form.get("metadata")));
      observations.push(metadata.observation);
      if (metadata.observation.stage === "assessment")
        return HttpResponse.json({
          kind: "assessment",
          matchProbability: probability,
          unclearProbability: 0.1,
        });
      return HttpResponse.json(
        outcome === "unavailable"
          ? { kind: "unavailable", reason: "provider_error" }
          : { kind: "review", outcome, explanation: "Reviewed supplied footage." },
      );
    }),
    http.post("/api/incidents/reports", async ({ request }) => {
      const report = (await request.json()) as Report;
      reports.push(report);
      if (failReport && reports.length === 1)
        return HttpResponse.json({ message: "Response lost" }, { status: 503 });
      return HttpResponse.json({
        incident: {
          ...report,
          id: "incident-one",
          deviceId: "camera-one",
          receivedAt: Date.now(),
          source: configuredSource,
          rule,
          version: 1,
          evidenceStatus: "preparing",
          evidenceReason: null,
          evidenceExpiresAt: null,
          notificationStatus: "not-sent",
          timeline: [],
          status: "dismissed",
          owner: null,
        },
      });
    }),
  );
  return {
    reports,
    observations,
    ended,
    sessionId,
    clear: () => {
      probability = 0.01;
    },
    positive: () => {
      probability = 0.9;
    },
    edit: () => {
      rule = { ...rule, version: rule.version + 1, enabled: false };
    },
  };
}

async function startMonitoring() {
  await renderDevice();
  await userEvent.click(screen.getByLabelText("Assigned source"));
  await userEvent.click(await screen.findByRole("option", { name: "Living room" }));
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  const video = screen.getByLabelText("Source video") as HTMLVideoElement;
  return video;
}

test("a confirmed candidate reports one stable event, retries delivery and does not recreate a dismissed incident", async () => {
  const api = monitoringApi({ failReport: true });
  const video = await startMonitoring();
  await screen.findByText(/request unavailable/, {}, { timeout: 4000 });
  video.currentTime = 1;
  await screen.findByText("Latest incident reported", {}, { timeout: 4000 });
  expect(api.reports).toHaveLength(2);
  expect(api.reports[1]).toEqual(api.reports[0]);
  expect(api.reports[0]?.eventTime).toBeLessThanOrEqual(Date.now());
  expect(api.observations.map((observation) => observation.stage)).toEqual([
    "assessment",
    "review",
  ]);
  video.currentTime = 2;
  await screen.findByText(
    "Event still present. Initial alert will not repeat.",
    {},
    { timeout: 4000 },
  );
  expect(api.reports).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(api.ended).toEqual([api.sessionId]));
  expect(screen.getByText("AI monitoring stopped.")).toBeVisible();
}, 15000);

for (const outcome of ["rejected", "need_more_evidence", "unavailable"] as const) {
  test(`review ${outcome} remains distinct and never reports an incident`, async () => {
    const api = monitoringApi({ outcome });
    await startMonitoring();
    await screen.findByText(
      outcome === "rejected"
        ? /Candidate rejected/
        : outcome === "need_more_evidence"
          ? /More evidence needed/
          : /Review unavailable/,
      {},
      { timeout: 4000 },
    );
    expect(api.reports).toHaveLength(0);
    expect(api.observations.map((observation) => observation.stage)).toEqual([
      "assessment",
      "review",
    ]);
  });
}

test("a delayed assessment stays bounded and Stop invalidates its late positive result", async () => {
  const api = monitoringApi();
  let requests = 0;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.post("/api/assessment", async () => {
      requests += 1;
      await held;
      return HttpResponse.json({
        kind: "assessment",
        matchProbability: 0.99,
        unclearProbability: 0,
      });
    }),
  );
  const video = await startMonitoring();
  await waitFor(() => expect(requests).toBe(1));
  video.currentTime = 9;
  await screen.findByText(/assessment is behind capture/, {}, { timeout: 6500 });
  expect(requests).toBe(1);
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  release();
  await waitFor(() => expect(api.ended).toHaveLength(1));
  expect(api.reports).toHaveLength(0);
  expect(screen.getByText("AI monitoring stopped.")).toBeVisible();
}, 10000);

test("a disabled rule invalidates an in-flight review", async () => {
  const api = monitoringApi();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.post("/api/assessment", async ({ request }) => {
      const form = await request.formData();
      const metadata = JSON.parse(String(form.get("metadata")));
      if (metadata.observation.stage === "assessment")
        return HttpResponse.json({
          kind: "assessment",
          matchProbability: 0.99,
          unclearProbability: 0,
        });
      await held;
      return HttpResponse.json({
        kind: "review",
        outcome: "positive",
        explanation: "Late confirmation",
      });
    }),
  );
  await startMonitoring();
  await screen.findByText("Reviewing candidate…", {}, { timeout: 4000 });
  api.edit();
  await userEvent.click(screen.getByRole("button", { name: "Refresh assigned rules" }));
  await screen.findByText(
    "Not monitoring: no enabled rules for this source.",
    {},
    { timeout: 4000 },
  );
  release();
  expect(api.reports).toHaveLength(0);
}, 10000);

test("configured duration requires fresh positive observations before review", async () => {
  const api = monitoringApi({ durationSeconds: 3 });
  const video = await startMonitoring();
  await screen.findByText(
    "Candidate observed. Checking the configured duration.",
    {},
    { timeout: 4000 },
  );
  expect(api.reports).toHaveLength(0);
  expect(api.observations).toHaveLength(1);
  video.currentTime = 3;
  await screen.findByText("Latest incident reported", {}, { timeout: 5000 });
  expect(api.reports).toHaveLength(1);
  expect(api.observations.map((observation) => observation.stage)).toEqual([
    "assessment",
    "assessment",
    "review",
  ]);
}, 10000);

test("fresh clear observations rearm the source and a new event gets a new identity", async () => {
  const api = monitoringApi();
  const video = await startMonitoring();
  await screen.findByText("Latest incident reported", {}, { timeout: 4000 });
  api.clear();
  const playback = setInterval(() => {
    video.currentTime += 2;
  }, 500);
  try {
    await screen.findByText("Scene cleared. Armed for a new event.", {}, { timeout: 16000 });
    expect(api.reports).toHaveLength(1);
    api.positive();
    await waitFor(() => expect(api.reports).toHaveLength(2), { timeout: 10000 });
    expect(api.reports[1]?.eventId).not.toBe(api.reports[0]?.eventId);
    expect(api.reports[1]?.eventTime).toBeGreaterThan(api.reports[0]?.eventTime ?? 0);
    expect(api.observations.every(({ frames }) => frames.length <= 8)).toBe(true);
  } finally {
    clearInterval(playback);
  }
}, 30000);

test("seeking invalidates late review and starts a fresh capture session", async () => {
  const api = monitoringApi();
  server.use(
    http.get("/api/config/device", () =>
      HttpResponse.json({
        sources: [{ ...configuredSource, kind: "replay" }],
        rules: [monitoringRule],
      }),
    ),
  );
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.post("/api/assessment", async ({ request }) => {
      const form = await request.formData();
      const metadata = JSON.parse(String(form.get("metadata")));
      if (metadata.observation.stage === "assessment")
        return HttpResponse.json({
          kind: "assessment",
          matchProbability: 0.99,
          unclearProbability: 0,
        });
      await held;
      return HttpResponse.json({ kind: "review", outcome: "positive", explanation: "Late result" });
    }),
  );
  await renderDevice();
  await userEvent.click(screen.getByLabelText("Assigned source"));
  await userEvent.click(await screen.findByRole("option", { name: "Living room" }));
  await userEvent.click(screen.getByLabelText("Source type"));
  await userEvent.click(await screen.findByRole("option", { name: "Local video" }));
  await userEvent.upload(
    screen.getByLabelText("Video file"),
    new File(["video"], "fall.mp4", { type: "video/mp4" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByText("Reviewing candidate…", {}, { timeout: 4000 });
  screen.getByLabelText("Source video").dispatchEvent(new Event("seeking"));
  release();
  await waitFor(() => expect(screen.getByText("Capture run").parentElement).toHaveTextContent("2"));
  expect(api.reports).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
});
