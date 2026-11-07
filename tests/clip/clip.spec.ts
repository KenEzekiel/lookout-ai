import { expect, test, type Page } from "@playwright/test";

async function openClipPage(page: Page) {
  await page.route("**/__clip_test__", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Clip test</title>" }),
  );
  await page.goto("/__clip_test__");
}

test("a local file yields only a playable event interval", async ({ page }) => {
  await openClipPage(page);
  const result = await page.evaluate(async () => {
    const { buildEventClip } = (await import(
      new URL("/src/lib/event-clip.ts", location.href).href
    )) as typeof import("../../apps/app/src/lib/event-clip");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d")!;
    let frame = 0;
    const timer = window.setInterval(() => {
      context.fillStyle = frame++ % 2 ? "red" : "blue";
      context.fillRect(0, 0, 320, 180);
    }, 100);
    const recorder = new MediaRecorder(canvas.captureStream(10));
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start(300);
    await new Promise((resolve) => window.setTimeout(resolve, 2200));
    recorder.stop();
    await stopped;
    window.clearInterval(timer);
    const file = new File(chunks, "source.webm", { type: recorder.mimeType });
    const clip = await buildEventClip({
      kind: "file",
      deviceId: "camera-one",
      workspaceId: "workspace-one",
      epoch: 1,
      eventTimeMs: 1000,
      from: 400,
      to: 1600,
      file,
    });
    const video = document.createElement("video");
    const url = URL.createObjectURL(clip.blob);
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("The clip did not load."));
    });
    const durationMs = video.duration * 1000;
    URL.revokeObjectURL(url);
    return { size: clip.blob.size, type: clip.blob.type, durationMs };
  });
  expect(result.size).toBeGreaterThan(0);
  expect(result.type).toBe("video/mp4");
  expect(result.durationMs).toBeGreaterThan(1000);
  expect(result.durationMs).toBeLessThan(1500);
});

test("a late camera event preserves lead-in across recorder segments", async ({ page }) => {
  test.setTimeout(45_000);
  await page.context().grantPermissions(["camera"]);
  await openClipPage(page);
  const result = await page.evaluate(async () => {
    const { CaptureSession } = (await import(
      new URL("/src/lib/capture-session.ts", location.href).href
    )) as typeof import("../../apps/app/src/lib/capture-session");
    const { buildEventClip } = (await import(
      new URL("/src/lib/event-clip.ts", location.href).href
    )) as typeof import("../../apps/app/src/lib/event-clip");
    const video = document.createElement("video");
    document.body.append(video);
    const session = new CaptureSession(video, () => {}, {
      deviceId: "camera-one",
      workspaceId: "workspace-one",
    });
    await session.startCamera();
    await new Promise((resolve) => window.setTimeout(resolve, 6200));
    const eventTimeMs = Date.now() - 3000;
    const event = await session.preserveEventInterval({
      epoch: session.getSnapshot().epoch,
      sourceTimeMs: eventTimeMs,
    });
    session.stop();
    const clip = await buildEventClip(event);
    const oldEpochError = await session
      .preserveEventInterval({ epoch: event.epoch, sourceTimeMs: eventTimeMs })
      .then(
        () => "",
        (error: Error) => error.message,
      );
    video.remove();
    return {
      segmentCount: event.kind === "camera" ? event.segments.length : 0,
      eventTimeMs,
      from: event.from,
      to: event.to,
      size: clip.blob.size,
      type: clip.blob.type,
      oldEpochError,
    };
  });
  expect(result.segmentCount).toBeGreaterThan(1);
  expect(result.from).toBeLessThan(result.eventTimeMs);
  expect(result.to).toBeGreaterThan(result.eventTimeMs);
  expect(result.size).toBeGreaterThan(0);
  expect(result.type).toBe("video/mp4");
  expect(result.oldEpochError).toContain("inactive capture run");
});

test("a synthetic report receipt uploads only its preserved clip to the same incident", async ({
  page,
}) => {
  const uploads: { bytes: Buffer; duration: string | undefined; session: string | undefined }[] =
    [];
  await page.route("**/api/incidents/reports", async (route) => {
    await route.fulfill({
      json: {
        incident: {
          id: "incident-one",
          deviceId: "camera-one",
          sessionId: "capture-one",
          eventId: "event-one",
          eventTime: Date.now(),
          receivedAt: Date.now(),
          source: { id: "source-one", name: "Test video", kind: "replay" },
          rule: {
            id: "rule-one",
            sourceId: "source-one",
            version: 1,
            enabled: true,
            definition: {
              name: "Synthetic event",
              condition: { kind: "template", template: "fall" },
              durationSeconds: null,
              severity: "critical",
              recipientIds: ["operator-one"],
              escalationDelaySeconds: 60,
            },
          },
          status: "open",
          version: 1,
          owner: null,
          evidenceStatus: "preparing",
          evidenceReason: null,
          evidenceExpiresAt: null,
          notificationStatus: "not-sent",
          timeline: [
            { kind: "reported", at: Date.now(), actorId: "camera-one", actorName: "Test device" },
          ],
        },
      },
    });
  });
  await page.route("**/api/incidents/evidence-start/incident-one", (route) =>
    route.fulfill({
      json: { evidenceStatus: "uploading", evidenceReason: null, evidenceExpiresAt: null },
    }),
  );
  await page.route("**/api/incidents/evidence/incident-one", async (route) => {
    uploads.push({
      bytes: route.request().postDataBuffer()!,
      duration: route.request().headers()["x-clip-duration-ms"],
      session: route.request().headers()["x-lookout-session"],
    });
    await route.fulfill({
      json: {
        evidenceStatus: "ready",
        evidenceReason: null,
        evidenceExpiresAt: Date.now() + 604800000,
      },
    });
  });
  await openClipPage(page);
  const result = await page.evaluate(async () => {
    const { CaptureSession } = (await import(
      new URL("/src/lib/capture-session.ts", location.href).href
    )) as typeof import("../../apps/app/src/lib/capture-session");
    const { submitConfirmedEvent } = (await import(
      new URL("/src/lib/incident-evidence.ts", location.href).href
    )) as typeof import("../../apps/app/src/lib/incident-evidence");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d")!;
    let frame = 0;
    const timer = window.setInterval(() => {
      context.fillStyle = frame++ % 2 ? "red" : "blue";
      context.fillRect(0, 0, 320, 180);
    }, 100);
    const recorder = new MediaRecorder(canvas.captureStream(10));
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start(300);
    await new Promise((resolve) => window.setTimeout(resolve, 2200));
    recorder.stop();
    await stopped;
    window.clearInterval(timer);
    const file = new File(chunks, "source.webm", { type: recorder.mimeType });
    const video = document.createElement("video");
    document.body.append(video);
    const session = new CaptureSession(video, () => {}, {
      deviceId: "camera-one",
      workspaceId: "workspace-one",
    });
    await session.startFile(file);
    const submitted = await submitConfirmedEvent(
      session,
      { epoch: session.getSnapshot().epoch, sourceTimeMs: 1000 },
      {
        sessionId: "capture-one",
        eventId: "event-one",
        ruleId: "rule-one",
        ruleVersion: 1,
        eventTime: Date.now(),
      },
    );
    session.dispose();
    video.remove();
    return { id: submitted.incident.id, error: submitted.evidenceError };
  });
  expect(result.id).toBe("incident-one");
  expect(result.error).toBeNull();
  expect(uploads).toHaveLength(1);
  expect(uploads[0]!.session).toBe("capture-one");
  expect(Number(uploads[0]!.duration)).toBeGreaterThan(1500);
  expect(Number(uploads[0]!.duration)).toBeLessThan(3000);
  expect(uploads[0]!.bytes.subarray(4, 8).toString()).toBe("ftyp");
  expect(uploads[0]!.bytes.length).toBeGreaterThan(12);
});
