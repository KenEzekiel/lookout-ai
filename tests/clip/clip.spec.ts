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

test("a reviewed camera event uploads its clip while monitoring continues and retries the same bytes", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.context().grantPermissions(["camera"]);
  let reports = 0;
  let assessments = 0;
  await page.route("**/api/incidents/sessions", (route) =>
    route.fulfill({
      json: {
        id: "capture-one",
        sourceId: "source-one",
        startedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      },
    }),
  );
  await page.route("**/api/incidents/sessions/end", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/assessment", (route) => {
    assessments += 1;
    return route.fulfill({
      json: route.request().postData()?.includes('"stage":"review"')
        ? { kind: "review", outcome: "positive", explanation: "Confirmed" }
        : { kind: "assessment", matchProbability: 0.9, unclearProbability: 0.1 },
    });
  });
  const uploads: { bytes: Buffer; duration: string | undefined; session: string | undefined }[] =
    [];
  await page.route("**/api/incidents/reports", async (route) => {
    reports += 1;
    await route.fulfill({
      json: {
        incident: {
          ...route.request().postDataJSON(),
          id: "incident-one",
          deviceId: "camera-one",
          sessionId: "capture-one",
          receivedAt: Date.now(),
          source: { id: "source-one", name: "Test camera", kind: "camera" },
          rule: {
            id: "rule-one",
            sourceId: "source-one",
            version: 1,
            enabled: true,
            definition: {
              name: "Fall",
              condition: { kind: "template", template: "fall" },
              durationSeconds: null,
              severity: "critical",
              escalationLevels: [
                { recipientIds: ["operator-one"], acknowledgmentTimeoutSeconds: 60 },
                { recipientIds: ["operator-one"], acknowledgmentTimeoutSeconds: null },
              ],
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
    if (uploads.length === 1) {
      await route.fulfill({ status: 503, json: { message: "Upload interrupted" } });
      return;
    }
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
    const { DeviceMonitoring } = (await import(
      new URL("/src/lib/device-monitoring.ts", location.href).href
    )) as typeof import("../../apps/app/src/lib/device-monitoring");
    const video = document.createElement("video");
    document.body.append(video);
    const session = new CaptureSession(video, () => {}, {
      deviceId: "camera-one",
      workspaceId: "workspace-one",
    });
    await session.startCamera();
    const statuses: string[] = [];
    const completed = new Promise<void>((resolve, reject) => {
      const controller = new DeviceMonitoring(
        session,
        "source-one",
        session.getSnapshot().epoch,
        (status) => {
          if (!status.latest) return;
          const evidence = status.latest.evidence;
          statuses.push(evidence.kind);
          if (evidence.kind === "unavailable") {
            if (!evidence.retryable) {
              controller.dispose();
              reject(new Error(evidence.reason));
              return;
            }
            controller.retryEvidence();
          }
          if (evidence.kind === "ready") {
            controller.dispose();
            resolve();
          }
        },
      );
      controller.configure([
        {
          id: "rule-one",
          sourceId: "source-one",
          version: 1,
          enabled: true,
          definition: {
            name: "Fall",
            condition: { kind: "template", template: "fall" },
            durationSeconds: null,
            severity: "critical",
            escalationLevels: [
              { recipientIds: ["operator-one"], acknowledgmentTimeoutSeconds: null },
            ],
          },
        },
      ]);
    });
    await completed;
    session.dispose();
    video.remove();
    return statuses;
  });
  expect(result).toContain("preparing");
  expect(result).toContain("uploading");
  expect(result).toContain("unavailable");
  expect(result).toContain("ready");
  expect(reports).toBe(1);
  expect(assessments).toBeGreaterThan(2);
  expect(uploads).toHaveLength(2);
  expect(uploads[0]!.bytes.equals(uploads[1]!.bytes)).toBe(true);
  expect(uploads[0]!.session).toBe("capture-one");
  expect(Number(uploads[0]!.duration)).toBeGreaterThan(5000);
  expect(uploads[0]!.bytes.subarray(4, 8).toString()).toBe("ftyp");
});
