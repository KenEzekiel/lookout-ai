import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, test } from "vitest";
import { server } from "../support/server";
import { getRouter } from "../../src/router";
import { type Principal } from "../../src/lib/access";
import {
  type Incident,
  incidentSchema,
  incidentCommandSchema,
  responseTransitions,
} from "../../src/lib/incidents";

const actor = {
  kind: "member",
  userId: "owner",
  workspaceId: "team",
  workspaceName: "Safety team",
  name: "Alex",
  role: "owner",
} satisfies Principal;
function reportedIncident(): Incident {
  return incidentSchema.parse({
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
        escalationLevels: [
          { recipientIds: ["owner"], acknowledgmentTimeoutSeconds: 60 },
          { recipientIds: ["owner"], acknowledgmentTimeoutSeconds: null },
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
      {
        kind: "reported",
        at: 1_790_000_002_000,
        actorId: "device",
        actorName: "Living room monitor",
      },
    ],
  });
}
let incident: Incident;
let principal: Principal;
beforeEach(() => {
  incident = reportedIncident();
  principal = actor;
  server.use(
    http.get("/api/access/principal", () => HttpResponse.json(principal)),
    http.get("/api/incidents/inbox", () => HttpResponse.json({ incidents: [incident] })),
    http.get("/api/incidents/detail/fall", () => HttpResponse.json(incident)),
    http.post("/api/incidents/commands/fall", async ({ request }) => {
      const input = incidentCommandSchema.parse(await request.json());
      if (input.version !== incident.version)
        return HttpResponse.json({ message: "Incident changed. Reload." }, { status: 409 });
      const transition = responseTransitions[input.action];
      incident = incidentSchema.parse({
        ...incident,
        status: transition.to,
        version: incident.version + 1,
        owner:
          input.action === "acknowledge"
            ? { userId: actor.userId, name: actor.name }
            : incident.owner,
        timeline: [
          ...incident.timeline,
          {
            kind: transition.to,
            at: 1_790_000_003_000,
            actorId: actor.userId,
            actorName: actor.name,
          },
        ],
      });
      return HttpResponse.json(incident);
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
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

test("inbox shows loading, an empty state, a request failure and recovery", async () => {
  let finish = () => {};
  const loaded = new Promise<void>((resolve) => {
    finish = resolve;
  });
  server.use(
    http.get("/api/incidents/inbox", async () => {
      await loaded;
      return HttpResponse.json({ incidents: [] });
    }),
  );
  const user = await open();
  expect(await screen.findByText("Loading incidents…")).toBeVisible();
  finish();
  expect(await screen.findByRole("heading", { name: "No incidents yet" })).toBeVisible();
  expect(screen.getByRole("link", { name: "View triggers" })).toHaveAttribute("href", "/triggers");
  server.use(
    http.get("/api/incidents/inbox", () =>
      HttpResponse.json({ message: "Inbox unavailable. Reload to retry." }, { status: 503 }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Reload inbox" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Inbox unavailable");
  expect(screen.queryByText("No incidents yet")).not.toBeInTheDocument();
  server.use(http.get("/api/incidents/inbox", () => HttpResponse.json({ incidents: [incident] })));
  await user.click(screen.getByRole("button", { name: "Reload inbox" }));
  expect(await screen.findByRole("link", { name: /Possible fall/ })).toHaveTextContent(
    "Living room",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("an operator opens an incident, acknowledges ownership with evidence pending and resolves separately", async () => {
  const user = await open();
  expect(await screen.findByRole("link", { name: "Incidents" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "Devices" })).not.toHaveAttribute("aria-current");
  const event = await screen.findByRole("link", { name: /Possible fall/ });
  expect(event).toHaveTextContent("Replayed footage");
  expect(event).toHaveTextContent("No owner yet");
  await user.click(event);
  expect(await screen.findByRole("heading", { name: "Possible fall" })).toBeVisible();
  expect(screen.getByText("Rule version 4")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Preparing evidence" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Play|Replay/ })).not.toBeInTheDocument();
  expect(incident.status).toBe("open");
  await user.click(screen.getByRole("button", { name: "Acknowledge" }));
  expect(await screen.findByText("Owned by Alex")).toBeVisible();
  expect(screen.getByText("You are handling this incident.")).toHaveRole("status");
  expect(screen.getByText("Acknowledged by Alex")).toBeVisible();
  expect(incident.status).toBe("acknowledged");
  await user.click(screen.getByRole("button", { name: "Resolve" }));
  expect(await screen.findByText("Incident resolved.")).toBeVisible();
  expect(screen.getByText("Resolved by Alex")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Dismiss as incorrect" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Back to inbox" }));
  expect(await screen.findByRole("link", { name: /Possible fall/ })).toHaveTextContent("Resolved");
});

test("dismiss records an incorrect alert without implying resolution", async () => {
  const user = await open("/incidents/fall");
  await user.click(await screen.findByRole("button", { name: "Dismiss as incorrect" }));
  expect(await screen.findByText("Dismissed as an incorrect alert.")).toBeVisible();
  expect(screen.getByText("Dismissed by Alex")).toBeVisible();
  expect(screen.getByText("No owner yet")).toBeVisible();
  expect(screen.queryByText("Resolved by Alex")).not.toBeInTheDocument();
  expect(incident.status).toBe("dismissed");
});

test("stale actions show a conflict, and reload retrieves the other operator's ownership", async () => {
  const user = await open("/incidents/fall");
  await screen.findByRole("button", { name: "Acknowledge" });
  server.use(
    http.post("/api/incidents/commands/fall", () =>
      HttpResponse.json(
        { message: "Incident changed. Reload the incident before responding." },
        { status: 409 },
      ),
    ),
  );
  incident = incidentSchema.parse({
    ...incident,
    status: "acknowledged",
    version: 2,
    owner: { userId: "other", name: "Taylor" },
  });
  await user.click(screen.getByRole("button", { name: "Acknowledge" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Incident changed");
  expect(screen.queryByText("You are handling this incident.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reload incident" }));
  expect(await screen.findByText("Owned by Taylor")).toBeVisible();
  expect(screen.getByRole("button", { name: "Resolve" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
});

test("detail loading and permission failures hide the incident, and reload recovers", async () => {
  let finish = () => {};
  const loaded = new Promise<void>((resolve) => {
    finish = resolve;
  });
  server.use(
    http.get("/api/incidents/detail/fall", async () => {
      await loaded;
      return HttpResponse.json(
        { message: "Incident not found in this workspace." },
        { status: 404 },
      );
    }),
  );
  const user = await open("/incidents/fall");
  expect(await screen.findByText("Loading incident…")).toBeVisible();
  finish();
  expect(await screen.findByRole("alert")).toHaveTextContent("Incident not found");
  expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
  server.use(http.get("/api/incidents/detail/fall", () => HttpResponse.json(incident)));
  await user.click(screen.getByRole("button", { name: "Reload incident" }));
  expect(await screen.findByRole("button", { name: "Acknowledge" })).toBeVisible();
});

test("paired devices cannot access operator incident controls", async () => {
  principal = {
    kind: "device",
    deviceId: "device",
    workspaceId: "team",
    workspaceName: "Safety team",
    name: "Monitor",
  };
  server.use(http.get("/api/config/device", () => HttpResponse.json({ sources: [], rules: [] })));
  await open("/incidents/fall");
  expect(await screen.findByRole("heading", { name: "Device connected" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Incident inbox" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
});

test("evidence moves from preparing to uploading, unavailable, and ready replay without changing response", async () => {
  const user = await open("/incidents/fall");
  expect(await screen.findByRole("heading", { name: "Preparing evidence" })).toBeVisible();
  incident = incidentSchema.parse({ ...incident, evidenceStatus: "uploading" });
  await user.click(screen.getByRole("button", { name: "Reload incident" }));
  expect(await screen.findByRole("heading", { name: "Uploading evidence" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Acknowledge" })).toBeEnabled();
  incident = incidentSchema.parse({
    ...incident,
    evidenceStatus: "unavailable",
    evidenceReason: "No camera footage remained.",
  });
  await user.click(screen.getByRole("button", { name: "Reload incident" }));
  expect(await screen.findByRole("heading", { name: "Evidence unavailable" })).toBeVisible();
  expect(screen.getByText("No camera footage remained.")).toBeVisible();
  expect(screen.queryByLabelText("Event clip replay")).not.toBeInTheDocument();
  incident = incidentSchema.parse({
    ...incident,
    evidenceStatus: "ready",
    evidenceReason: null,
    evidenceExpiresAt: 1_790_604_800_000,
  });
  await user.click(screen.getByRole("button", { name: "Reload incident" }));
  expect(await screen.findByRole("heading", { name: "Saved event replay" })).toBeVisible();
  const video = screen.getByLabelText("Event clip replay");
  expect(video).toHaveAttribute("controls");
  expect(video).toHaveAttribute("src", "/api/incidents/evidence/fall");
  expect(screen.getByRole("button", { name: "Acknowledge" })).toBeEnabled();
});

test("detail shows the scheduled follow-up and cancellation after acknowledgment", async () => {
  incident = incidentSchema.parse({
    ...incident,
    escalationActivations: [incident.receivedAt],
    escalationDueAt: incident.receivedAt + 60_000,
    followUp: { kind: "scheduled", dueAt: incident.receivedAt + 60_000 },
  });
  const user = await open("/incidents/fall");
  expect(await screen.findByText(/Next level due/)).toBeVisible();
  expect(screen.getByText(/Acknowledge to stop escalation/)).toBeVisible();
  server.use(
    http.post("/api/incidents/commands/fall", async () => {
      incident = incidentSchema.parse({
        ...incident,
        status: "acknowledged",
        version: 2,
        owner: { userId: actor.userId, name: actor.name },
        followUp: { kind: "cancelled", dueAt: incident.receivedAt + 60_000 },
      });
      return HttpResponse.json(incident);
    }),
  );
  await user.click(screen.getByRole("button", { name: "Acknowledge" }));
  expect(
    await screen.findByText("Pending escalation cancelled by the incident response."),
  ).toBeVisible();
});

test("an attempted follow-up is visibly distinct from operator acknowledgment", async () => {
  incident = incidentSchema.parse({
    ...incident,
    escalationActivations: [incident.receivedAt, incident.receivedAt + 60_010],
    followUp: {
      kind: "attempted",
      dueAt: incident.receivedAt + 60_000,
      attemptedAt: incident.receivedAt + 60_010,
    },
    timeline: [
      ...incident.timeline,
      {
        kind: "follow-up-attempted",
        at: incident.receivedAt + 60_010,
        actorId: "system",
        actorName: "Lookout",
      },
    ],
  });
  await open("/incidents/fall");
  expect(await screen.findByText("Level 2: Active")).toBeVisible();
  expect(screen.getAllByText(/Display is not confirmed/)).toHaveLength(2);
  expect(screen.getByText("Level 2 escalation published by Lookout")).toBeVisible();
  expect(screen.getByText("No owner yet")).toBeVisible();
  expect(screen.queryByText("Acknowledged by Lookout")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Acknowledge" })).toBeEnabled();
});
