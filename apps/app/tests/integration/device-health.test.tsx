import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, test } from "vitest";
import { server } from "../support/server";
import { getRouter } from "../../src/router";
import { type DeviceHealth } from "../../src/lib/device-health";

const owner = {
  kind: "member",
  userId: "owner",
  workspaceId: "workspace",
  workspaceName: "Demo",
  name: "Alex",
  role: "owner",
};
async function open() {
  server.use(
    http.get("/api/access/principal", () => HttpResponse.json(owner)),
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
  );
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/devices"] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />, { container: document });
  return userEvent.setup();
}

test("operators see contact, observations, applied versions, degradation and recovery separately", async () => {
  const observedAt = Date.now();
  let unavailable = false;
  let device: DeviceHealth = {
    id: "camera-one",
    name: "Lobby device",
    revokedAt: null,
    lastContactAt: observedAt,
    source: { id: "lobby", name: "Lobby camera", kind: "camera" },
    report: {
      sourceId: "lobby",
      capture: "running",
      lastObservationAt: observedAt,
      assessment: "ready",
      lastAssessmentAt: observedAt,
      configurationAvailable: true,
      appliedRules: [{ id: "fall", version: 1 }],
    },
    assignedRules: [{ id: "fall", name: "Possible fall", enabled: true, version: 2 }],
  };
  server.use(
    http.get("/api/health/operator", () =>
      unavailable
        ? HttpResponse.json({ message: "Connection lost" }, { status: 503 })
        : HttpResponse.json({ serverTime: observedAt, devices: [device] }),
    ),
  );
  const user = await open();
  const health = await screen.findByRole("listitem", { name: "Health of Lobby device" });
  expect(within(health).getByText("Configuration out of date")).toBeVisible();
  expect(within(health).getByText("Possible fall · Assigned v2 · Applied v1")).toBeVisible();
  expect(within(health).getByText("Source: Lobby camera")).toBeVisible();
  for (const label of ["Last contact", "Last observation", "Last assessment"])
    expect(within(health).getByText(label)).toBeVisible();
  async function refresh() {
    await user.click(screen.getByRole("button", { name: "Refresh health" }));
  }
  if (!device.report) throw new Error("Missing fixture report");
  device.report.appliedRules = [{ id: "fall", version: 2 }];
  await refresh();
  expect(await within(health).findByText("Monitoring")).toBeVisible();
  device.report.capture = "stopped";
  await refresh();
  expect(await within(health).findByText("Stopped")).toBeVisible();
  device.report.capture = "running";
  device.report.lastObservationAt = observedAt - 11_000;
  await refresh();
  expect(await within(health).findByText("Capture stalled")).toBeVisible();
  device.report.lastObservationAt = observedAt;
  device.report.assessment = "degraded";
  await refresh();
  expect(await within(health).findByText("Assessment degraded")).toBeVisible();
  device.lastContactAt = observedAt - 21_000;
  await refresh();
  expect(await within(health).findByText("Disconnected / stale")).toBeVisible();
  device.lastContactAt = observedAt;
  device.report.assessment = "ready";
  await refresh();
  expect(await within(health).findByText("Monitoring")).toBeVisible();
  unavailable = true;
  await refresh();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Health status unavailable. Connection lost",
  );
  expect(screen.queryByText("Monitoring", { exact: true })).not.toBeInTheDocument();
  unavailable = false;
  device = { ...device, revokedAt: observedAt };
  await refresh();
  expect(await screen.findByText("Access removed", { exact: true })).toBeVisible();
});

test("the operator sees loading, empty and never-reported health without a healthy claim", async () => {
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let devices: DeviceHealth[] = [];
  server.use(
    http.get("/api/health/operator", async () => {
      await waiting;
      return HttpResponse.json({ serverTime: Date.now(), devices });
    }),
  );
  const user = await open();
  expect(await screen.findByText("Loading monitoring health…")).toBeVisible();
  release();
  expect(await screen.findByText("Pair a device to see monitoring health.")).toBeVisible();
  devices = [
    {
      id: "new-device",
      name: "New device",
      revokedAt: null,
      lastContactAt: null,
      source: null,
      report: null,
      assignedRules: [],
    },
  ];
  await user.click(screen.getByRole("button", { name: "Refresh health" }));
  expect(await screen.findByText("No reports yet")).toBeVisible();
  expect(screen.queryByText("Monitoring", { exact: true })).not.toBeInTheDocument();
});
