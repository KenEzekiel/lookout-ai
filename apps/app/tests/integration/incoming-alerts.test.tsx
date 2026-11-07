import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, test } from "vitest";
import { server } from "../support/server";
import { getRouter } from "../../src/router";
import { incidentCommandSchema, incidentSchema, type Incident } from "../../src/lib/incidents";

const actor = {
  kind: "member",
  userId: "owner",
  workspaceId: "team",
  workspaceName: "Safety team",
  name: "Alex",
  role: "owner",
};
const reported = incidentSchema.parse({
  id: "fall",
  deviceId: "device",
  sessionId: "capture",
  eventId: "event",
  eventTime: 1_790_000_000_000,
  receivedAt: 1_790_000_002_000,
  source: { id: "source", name: "Living room", kind: "replay" },
  rule: {
    id: "rule",
    sourceId: "source",
    version: 4,
    enabled: true,
    definition: {
      name: "Possible fall",
      condition: { kind: "template", template: "fall" },
      durationSeconds: null,
      severity: "critical",
      recipientIds: ["owner"],
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
  timeline: [],
});
let deliveries: Incident[];
let commands: unknown[];
beforeEach(() => {
  sessionStorage.clear();
  deliveries = [];
  commands = [];
  server.use(
    http.get("/api/access/principal", () => HttpResponse.json(actor)),
    http.get("/api/incidents/inbox", () => HttpResponse.json({ incidents: [] })),
    http.get("/api/incidents/alerts", () => HttpResponse.json({ incidents: deliveries })),
    http.get("/api/incidents/detail/fall", () => HttpResponse.json(reported)),
    http.post("/api/incidents/commands/fall", async ({ request }) => {
      const input = incidentCommandSchema.parse(await request.json());
      commands.push(input);
      deliveries = [];
      return HttpResponse.json({
        ...reported,
        status: "acknowledged",
        version: 2,
        owner: { userId: "owner", name: "Alex" },
      });
    }),
  );
});
async function open(path = "/incidents") {
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: [path] }),
    scrollRestoration: false,
  });
  await router.load();
  const rendered = render(<RouterProvider router={router} />, { container: document });
  await screen.findByText(/Incoming alerts connected/);
  return { user: userEvent.setup(), ...rendered };
}

test("a connected operator receives context once, silences locally and keeps it silenced across navigation and reload", async () => {
  const view = await open();
  expect(screen.queryByRole("dialog", { name: "Incoming incident" })).not.toBeInTheDocument();
  deliveries = [reported];
  fireEvent(window, new Event("online"));
  const alert = await screen.findByRole("dialog", { name: "Incoming incident" });
  expect(alert).toHaveTextContent("Possible fall");
  expect(alert).toHaveTextContent("Living room");
  expect(alert).toHaveTextContent("Replayed footage");
  expect(alert).toHaveTextContent("Evidence preparing");
  fireEvent(window, new Event("focus"));
  expect(screen.getAllByRole("dialog", { name: "Incoming incident" })).toHaveLength(1);
  await view.user.click(within(alert).getByRole("button", { name: "Silence here" }));
  expect(screen.queryByRole("dialog", { name: "Incoming incident" })).not.toBeInTheDocument();
  expect(commands).toEqual([]);
  view.unmount();
  cleanup();
  await open();
  expect(screen.queryByRole("dialog", { name: "Incoming incident" })).not.toBeInTheDocument();
  expect(commands).toEqual([]);
});

test("opening an alert navigates to evidence-pending detail without acknowledging", async () => {
  deliveries = [reported];
  const { user } = await open();
  await user.click(await screen.findByRole("link", { name: "Open incident" }));
  expect(await screen.findByRole("heading", { name: "Possible fall" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Preparing evidence" })).toBeVisible();
  expect(screen.getByText("No owner yet")).toBeVisible();
  expect(commands).toEqual([]);
  expect(screen.queryByRole("dialog", { name: "Incoming incident" })).not.toBeInTheDocument();
});

test("acknowledgment sends the last-read version, removes the alert and confirms shared ownership", async () => {
  deliveries = [reported];
  const { user } = await open();
  await user.click(await screen.findByRole("button", { name: "Acknowledge alert" }));
  expect(await screen.findByText("You are handling Possible fall.")).toBeVisible();
  expect(commands).toEqual([{ action: "acknowledge", version: 1 }]);
  expect(screen.queryByRole("dialog", { name: "Incoming incident" })).not.toBeInTheDocument();
});

test("another operator's response removes the incoming interruption on reconnect", async () => {
  deliveries = [reported];
  await open();
  await screen.findByRole("dialog", { name: "Incoming incident" });
  deliveries = [];
  fireEvent(window, new Event("online"));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Incoming incident" })).not.toBeInTheDocument(),
  );
  expect(commands).toEqual([]);
});

test("failed delivery and reconnect are visible, retry recovers, and a stale command refreshes shared state", async () => {
  server.use(
    http.get("/api/incidents/alerts", () =>
      HttpResponse.json({ message: "Offline" }, { status: 503 }),
    ),
  );
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/incidents"] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />, { container: document });
  expect(await screen.findByText(/Incoming alerts unavailable/)).toBeVisible();
  const user = userEvent.setup();
  deliveries = [reported];
  server.use(http.get("/api/incidents/alerts", () => HttpResponse.json({ incidents: deliveries })));
  await user.click(screen.getByRole("button", { name: "Retry alerts" }));
  expect(await screen.findByRole("dialog", { name: "Incoming incident" })).toBeVisible();
  server.use(
    http.post("/api/incidents/commands/fall", () => {
      deliveries = [];
      return HttpResponse.json(
        { message: "Incident changed. Reload before responding." },
        { status: 409 },
      );
    }),
  );
  await user.click(screen.getByRole("button", { name: "Acknowledge alert" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Incident changed");
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Incoming incident" })).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("You are handling Possible fall.")).not.toBeInTheDocument();
});

test("blocked sound leaves an actionable visible alert and never acknowledges", async () => {
  deliveries = [reported];
  const { user } = await open();
  await user.click(screen.getByRole("button", { name: "Enable sound and test" }));
  expect(
    await within(screen.getByRole("dialog", { name: "Incoming incident" })).findByText(
      /Sound playback is unavailable or blocked/,
    ),
  ).toBeVisible();
  expect(screen.getByRole("dialog", { name: "Incoming incident" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Acknowledge alert" })).toBeEnabled();
  expect(commands).toEqual([]);
});

test("silencing one incident advances to the next eligible incident", async () => {
  deliveries = [
    reported,
    {
      ...reported,
      id: "second",
      rule: {
        ...reported.rule,
        definition: { ...reported.rule.definition, name: "Possible crash" },
      },
    },
  ];
  const { user } = await open();
  expect(await screen.findByText("Incoming incident · 2 waiting")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Silence here" }));
  expect(await screen.findByRole("heading", { name: "Possible crash" })).toBeVisible();
  expect(commands).toEqual([]);
});

test("one durable follow-up re-alerts a locally silenced incident and repeated delivery stays silenced", async () => {
  deliveries = [reported];
  const { user } = await open();
  await user.click(await screen.findByRole("button", { name: "Silence here" }));
  expect(screen.queryByRole("dialog", { name: "Incoming incident" })).not.toBeInTheDocument();
  deliveries = [
    incidentSchema.parse({
      ...reported,
      followUp: {
        kind: "attempted",
        dueAt: reported.receivedAt + 60_000,
        attemptedAt: reported.receivedAt + 60_010,
      },
    }),
  ];
  fireEvent(window, new Event("focus"));
  const alert = await screen.findByRole("dialog", { name: "Incoming incident" });
  expect(alert).toHaveTextContent("Incident follow-up");
  expect(commands).toEqual([]);
  fireEvent(window, new Event("focus"));
  expect(screen.getAllByRole("dialog", { name: "Incoming incident" })).toHaveLength(1);
  await user.click(within(alert).getByRole("button", { name: "Silence here" }));
  fireEvent(window, new Event("online"));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Incoming incident" })).not.toBeInTheDocument(),
  );
  expect(commands).toEqual([]);
});

test("Escape silences locally and restores keyboard access without acknowledging", async () => {
  const { user } = await open();
  const control = screen.getByRole("button", { name: "Enable sound and test" });
  control.focus();
  deliveries = [reported];
  fireEvent(window, new Event("online"));
  const alert = await screen.findByRole("dialog", { name: "Incoming incident" });
  await waitFor(() => expect(alert).toContainElement(document.activeElement as HTMLElement));
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Incoming incident" })).not.toBeInTheDocument(),
  );
  expect(commands).toEqual([]);
  await waitFor(() => expect(control).toHaveFocus());
});

test("an alert interrupts trigger editing and silence restores its draft and focus", async () => {
  server.use(
    http.get("/api/config/operator", () =>
      HttpResponse.json({
        sources: [reported.source],
        rules: [],
        recipients: [{ userId: "owner", name: "Alex", role: "owner" }],
      }),
    ),
  );
  const { user } = await open("/triggers");
  await user.click(await screen.findByRole("button", { name: "New trigger" }));
  const editor = await screen.findByRole("dialog", { name: "New trigger" });
  const name = within(editor).getByLabelText("Incident name");
  await user.type(name, "Unsaved lobby rule");
  deliveries = [reported];
  fireEvent(window, new Event("online"));
  const alert = await screen.findByRole("dialog", { name: "Incoming incident" });
  await waitFor(() => expect(alert.contains(document.activeElement)).toBe(true));
  await user.click(within(alert).getByRole("button", { name: "Silence here" }));
  await waitFor(() => expect(name).toHaveFocus());
  expect(name).toHaveValue("Unsaved lobby rule");
  expect(editor).toBeVisible();
  expect(commands).toEqual([]);
});
