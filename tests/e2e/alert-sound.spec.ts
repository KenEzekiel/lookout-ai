import { expect, test } from "@playwright/test";

const actor = {
  kind: "member",
  userId: "sound-owner",
  workspaceId: "sound-team",
  workspaceName: "Incident sound QA",
  name: "Sound operator",
  role: "owner",
};
const incident = {
  id: "sound-incident",
  deviceId: "sound-device",
  sessionId: "sound-session",
  eventId: "sound-event",
  eventTime: 1_790_000_000_000,
  receivedAt: 1_790_000_002_000,
  source: { id: "source", name: "Lobby camera", kind: "camera" },
  rule: {
    id: "rule",
    sourceId: "source",
    version: 1,
    enabled: true,
    definition: {
      name: "Possible fall",
      condition: { kind: "template", template: "fall" },
      durationSeconds: null,
      severity: "critical",
      escalationLevels: [
        { recipientIds: [actor.userId], acknowledgmentTimeoutSeconds: 60 },
        { recipientIds: [actor.userId], acknowledgmentTimeoutSeconds: null },
      ],
    },
  },
  status: "open",
  version: 1,
  owner: null,
  evidenceStatus: "pending",
  notificationStatus: "not-sent",
  timeline: [],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/access/principal", (route) => route.fulfill({ json: actor }));
  await page.route("**/api/incidents/inbox", (route) => route.fulfill({ json: { incidents: [] } }));
  await page.route("**/api/incidents/alerts", (route) =>
    route.fulfill({ json: { incidents: [incident] } }),
  );
});

test("operator opts into the original three-pulse alarm and can test, disable and silence it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/incidents");
  await expect(page.getByRole("article", { name: "Incoming incident" })).toBeVisible();
  await expect(page.getByText(/Incoming alerts connected/)).toContainText("Sound off.");
  const download = page.waitForResponse("**/sounds/incident-alert.wav");
  await page.getByRole("button", { name: "Enable sound and test" }).click();
  const response = await download;
  expect(response.ok()).toBe(true);
  const wav = await response.body();
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
  const sampleRate = wav.readUInt32LE(24);
  expect(wav.readUInt16LE(22)).toBe(1);
  expect(wav.readUInt16LE(34)).toBe(16);
  expect((wav.length - 44) / (sampleRate * 2)).toBeCloseTo(1.2);
  for (const start of [0, 0.4, 0.8]) {
    const peak = (from: number, to: number) => {
      let value = 0;
      for (let frame = Math.round(from * sampleRate); frame < Math.round(to * sampleRate); frame++)
        value = Math.max(value, Math.abs(wav.readInt16LE(44 + frame * 2)));
      return value;
    };
    expect(peak(start + 0.02, start + 0.25)).toBeGreaterThan(5000);
    expect(peak(start + 0.3, start + 0.39)).toBe(0);
  }
  await expect(page.getByText(/Incoming alerts connected/)).toContainText("Sound enabled.");
  await page.getByRole("button", { name: "Test sound", exact: true }).click();
  await page.getByRole("button", { name: "Turn sound off" }).click();
  await expect(page.getByText(/Incoming alerts connected/)).toContainText("Sound off.");
  await page.getByRole("button", { name: "Enable sound and test" }).click();
  await page.getByRole("button", { name: "Silence here" }).click();
  await expect(page.getByRole("article", { name: "Incoming incident" })).toHaveCount(0);
  await expect(
    page.getByText("Silenced in this browser. The incident still needs acknowledgment."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("unavailable audio keeps the incident actionable and can be retried", async ({ page }) => {
  await page.route("**/sounds/incident-alert.wav", (route) => route.fulfill({ status: 503 }));
  await page.goto("/incidents");
  await page.getByRole("button", { name: "Enable sound and test" }).click();
  await expect(page.getByText(/Sound playback is unavailable or blocked/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Acknowledge alert" })).toBeEnabled();
  await expect(page.getByRole("article", { name: "Incoming incident" })).toBeVisible();
  await page.unroute("**/sounds/incident-alert.wav");
  await page.getByRole("button", { name: "Enable sound and test" }).click();
  await expect(page.getByText(/Incoming alerts connected/)).toContainText("Sound enabled.");
  await expect(page.getByText(/Sound playback is unavailable or blocked/)).toHaveCount(0);
});
