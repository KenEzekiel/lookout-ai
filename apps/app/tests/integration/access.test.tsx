import { responseGate } from "../support/response-gate";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, sse } from "msw";
import { beforeEach, expect, onTestFinished, test } from "vitest";
import { server } from "../support/server";
import { getRouter } from "../../src/router";
import type { Principal, DevicePrincipal } from "../../src/lib/access";

const owner = {
  kind: "member",
  userId: "owner",
  workspaceId: "team",
  workspaceName: "Demo team",
  name: "Alex",
  role: "owner",
} satisfies Principal;
let principal: Principal;
let activeDevice: DevicePrincipal | null;
beforeEach(() => {
  principal = { kind: "visitor" };
  activeDevice = null;
  server.use(
    http.get("/api/access/principal", ({ request }) =>
      new URL(request.url).searchParams.get("mode") === "device"
        ? activeDevice
          ? HttpResponse.json(activeDevice)
          : HttpResponse.json({ message: "Device unavailable" }, { status: 401 })
        : HttpResponse.json(principal),
    ),
  );
});
async function open(path = "/devices") {
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: [path] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />, { container: document });
  return userEvent.setup();
}

test("devices update from SSE when another browser pairs or revokes a device", async () => {
  principal = owner;
  let publish:
    | ((devices: { id: string; name: string; revokedAt: number | null }[]) => void)
    | undefined;
  server.use(
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
    sse("/api/access/team/events", ({ client }) => {
      publish = (devices) => client.send({ data: JSON.stringify({ members: [], devices }) });
    }),
  );
  const user = await open("/devices");
  expect(await screen.findByText("No devices connected")).toBeVisible();
  await waitFor(() => expect(publish).toBeTypeOf("function"));
  act(() => publish?.([{ id: "new", name: "New camera", revokedAt: null }]));
  expect(await screen.findByRole("button", { name: "Live view of New camera" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Live view of New camera" }));
  expect(await screen.findByRole("button", { name: "Close live view" })).toBeVisible();
  act(() => publish?.([{ id: "new", name: "New camera", revokedAt: 1 }]));
  expect(await screen.findByText("Access removed", { exact: true })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Live view of New camera" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Close live view" })).not.toBeInTheDocument();
});

test("operators can manually refresh, retain the list on failure, and retry", async () => {
  principal = { ...owner, role: "operator" };
  let reads = 0;
  let fail = false;
  let release: (() => void) | undefined;
  server.use(
    http.get("/api/access/team", async () => {
      ++reads;
      if (reads === 2)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (fail) return HttpResponse.json({ message: "List unavailable." }, { status: 503 });
      return HttpResponse.json({
        members: [],
        devices: reads > 1 ? [{ id: "new", name: "Remote camera", revokedAt: null }] : [],
      });
    }),
  );
  const user = await open("/devices");
  expect(await screen.findByText("No devices connected")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByRole("button", { name: "Refreshing…" })).toBeDisabled();
  await waitFor(() => expect(release).toBeTypeOf("function"));
  act(() => release?.());
  expect(await screen.findByText("Remote camera")).toBeVisible();
  expect(await screen.findByText("Devices refreshed.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Add device" })).not.toBeInTheDocument();
  fail = true;
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("List unavailable.");
  expect(screen.getByText("Remote camera")).toBeVisible();
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

test("SSE reconnects with a fresh snapshot after a dropped connection", async () => {
  principal = owner;
  let connections = 0;
  server.use(
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
    sse("/api/access/team/events", ({ client }) => {
      if (++connections === 1) {
        client.send({ retry: 1 });
        client.close();
        return;
      }
      client.send({
        data: JSON.stringify({
          members: [],
          devices: [{ id: "reconnected", name: "Reconnected camera", revokedAt: null }],
        }),
      });
    }),
  );
  await open("/devices");
  expect(await screen.findByText("Reconnected camera")).toBeVisible();
  expect(connections).toBe(2);
});

test("access loss clears streamed devices and offers manual recovery", async () => {
  const stackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 40;
  onTestFinished(() => {
    Error.stackTraceLimit = stackTraceLimit;
  });
  principal = owner;
  const trace: string[] = [];
  const connection = responseGate();
  const revocations: (() => void)[] = [];
  server.use(
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
    sse<{ message: string; unavailable: string }>(
      "/api/access/team/events",
      ({ client, request }) => {
        trace.push("connected");
        request.signal.addEventListener("abort", () =>
          trace.push(`aborted: ${String(request.signal.reason?.stack ?? request.signal.reason)}`),
        );
        client.send({
          data: JSON.stringify({
            members: [],
            devices: [{ id: "private", name: "Private camera", revokedAt: null }],
          }),
        });
        revocations.push(() => {
          trace.push("sent unavailable");
          client.send({ event: "unavailable", data: "{}" });
        });
        connection.resolve();
      },
    ),
  );
  await open("/devices");
  expect(await screen.findByText("Private camera")).toBeVisible();
  await connection.promise;
  await act(async () => revocations.forEach((revoke) => revoke()));
  try {
    await waitFor(() => expect(screen.queryByText("Private camera")).not.toBeInTheDocument());
  } catch (error) {
    throw new Error(
      `${JSON.stringify({ trace, alerts: screen.queryAllByRole("alert").map((node) => node.textContent) })}\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
  expect(screen.getByText(/Live updates interrupted/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("registration from an invitation link preserves the invitation through onboarding", async () => {
  const token = "a".repeat(64);
  server.use(
    http.post("/api/auth/sign-up/email", async ({ request }) => {
      expect(await request.json()).toMatchObject({ name: "Taylor", email: "taylor@example.com" });
      principal = { kind: "unassigned-user", userId: "taylor", name: "Taylor" };
      return HttpResponse.json({ user: { id: "taylor" } });
    }),
    http.post("/api/access/join", async ({ request }) => {
      expect(await request.json()).toEqual({ token });
      principal = { ...owner, userId: "taylor", name: "Taylor", role: "operator" };
      return HttpResponse.json({ joined: true });
    }),
    http.get("/api/access/team", () =>
      HttpResponse.json({
        members: [{ userId: "taylor", name: "Taylor", role: "operator" }],
        devices: [],
      }),
    ),
  );
  const user = await open(`/join?token=${token}`);
  await user.click(await screen.findByRole("button", { name: "Create an account" }));
  await user.type(screen.getByLabelText("Your name"), "Taylor");
  await user.type(screen.getByLabelText("Email"), "taylor@example.com");
  await user.type(screen.getByLabelText("Password"), "password-123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(screen.queryByLabelText("Workspace name")).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Join workspace" }));
  expect(await screen.findByRole("heading", { name: "Devices" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Add device" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Team" }));
  expect(await screen.findByText("Taylor")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Switch to device mode" })).toBeVisible();
});

test("sign-in failures preserve entered fields and allow another attempt", async () => {
  server.use(
    http.post("/api/auth/sign-in/email", () =>
      HttpResponse.json({ message: "Invalid email or password" }, { status: 401 }),
    ),
  );
  const user = await open();
  await user.type(await screen.findByLabelText("Email"), "alex@example.com");
  await user.type(screen.getByLabelText("Password"), "bad-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  expect(screen.getByLabelText("Email")).toHaveValue("alex@example.com");
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("onboarding shows expired invitation errors and creates a workspace", async () => {
  principal = { kind: "unassigned-user", userId: "alex", name: "Alex" };
  server.use(
    http.post("/api/access/join", () =>
      HttpResponse.json(
        { message: "Invitation is invalid, expired, or already used." },
        { status: 400 },
      ),
    ),
    http.post("/api/access/workspace", async ({ request }) => {
      expect(await request.json()).toEqual({ name: "Demo team" });
      principal = owner;
      return HttpResponse.json({ id: "team" }, { status: 201 });
    }),
    http.get("/api/access/team", () =>
      HttpResponse.json({
        members: [{ userId: "owner", name: "Alex", role: "owner" }],
        devices: [],
      }),
    ),
  );
  const user = await open();
  await user.click(await screen.findByRole("button", { name: "Join with an invitation code" }));
  await user.type(await screen.findByLabelText("Invitation code"), "123456");
  await user.click(screen.getByRole("button", { name: "Join workspace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("expired");
  await user.click(screen.getByRole("button", { name: "Create a workspace instead" }));
  await user.type(screen.getByLabelText("Workspace name"), "Demo team");
  await user.click(screen.getByRole("button", { name: "Create workspace" }));
  expect(await screen.findByText("No devices connected")).toBeVisible();
});

test("owners can create invitations, approve devices and revoke them", async () => {
  principal = owner;
  let paired = false;
  let revoked = false;
  server.use(
    http.get("/api/access/team", () =>
      HttpResponse.json({
        members: [],
        devices: paired ? [{ id: "camera", name: "Lobby", revokedAt: revoked ? 1 : null }] : [],
      }),
    ),
    http.post("/api/access/invitations", () =>
      HttpResponse.json({ code: "012345", token: "a".repeat(64), expiresAt: Date.now() + 900000 }),
    ),
    http.post("/api/access/pairing/approve", async ({ request }) => {
      expect(await request.json()).toEqual({ code: "654321", name: "Lobby" });
      paired = true;
      return HttpResponse.json({ paired: true });
    }),
    http.post("/api/access/devices/revoke", async ({ request }) => {
      expect(await request.json()).toEqual({ id: "camera" });
      revoked = true;
      return HttpResponse.json({ revoked: true });
    }),
  );
  const user = await open();
  await user.click(await screen.findByRole("link", { name: "Team" }));
  await user.click(screen.getByRole("button", { name: "Invite member" }));
  await user.click(await screen.findByRole("button", { name: "Create invitation" }));
  expect(await screen.findByText("012345")).toBeVisible();
  expect(screen.getByLabelText("Invitation link")).toHaveValue(
    `http://localhost:3000/join?token=${"a".repeat(64)}`,
  );
  await user.click(screen.getByRole("button", { name: "Copy invitation link" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Invitation link copied.");
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getByRole("link", { name: "Devices" }));
  const connected = screen.getByRole("region", { name: "Paired devices" });
  expect(within(connected).getByLabelText("0 devices")).toBeVisible();
  await user.click(within(connected).getByRole("button", { name: "Connect your first device" }));
  await user.type(screen.getByLabelText("Device name"), "Lobby");
  await user.type(screen.getByLabelText("Pairing code"), "654321");
  await user.click(screen.getByRole("button", { name: "Connect device" }));
  expect(await screen.findByRole("button", { name: "Live view of Lobby" })).toBeVisible();
  expect(within(connected).getByLabelText("1 device")).toHaveTextContent("1");
  expect(within(connected).getByText("Paired", { exact: true })).toBeVisible();
  expect(
    connected.compareDocumentPosition(screen.getByRole("region", { name: "This browser" })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await user.click(await screen.findByRole("button", { name: "Remove access for Lobby" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Remove device access?");
  expect(screen.queryByText("Access removed", { exact: true })).not.toBeInTheDocument();
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Remove access" }),
  );
  expect(await screen.findByText("Access removed", { exact: true })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Live view of Lobby" })).not.toBeInTheDocument();
});

test("monitoring shows a revoked credential visibly and offers a way back", async () => {
  server.use(
    http.get("/api/access/principal", () =>
      HttpResponse.json(
        { message: "Device access revoked. Ask the owner to pair this browser again." },
        { status: 401 },
      ),
    ),
  );
  await open("/monitor");
  expect(await screen.findByRole("alert")).toHaveTextContent("Device access revoked");
  expect(screen.getByRole("button", { name: "Return to sign in" })).toBeVisible();
});

test("a visitor can generate a pairing code without signing in", async () => {
  server.use(
    http.post("/api/access/pairing/start", () =>
      HttpResponse.json({ code: "003456", expiresAt: Date.now() + 300000 }),
    ),
  );
  const user = await open("/monitor");
  await user.click(await screen.findByRole("button", { name: "Get pairing code" }));
  expect(await screen.findByRole("status", { name: "Pairing code" })).toHaveTextContent("003456");
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
});

test("device approval errors preserve fields and a cancelled device switch keeps owner access", async () => {
  principal = owner;
  let activationAttempts = 0;
  server.use(
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
    http.post("/api/access/pairing/approve", () =>
      HttpResponse.json(
        { message: "Pairing code is invalid, expired, or already used." },
        { status: 400 },
      ),
    ),
    http.post("/api/access/devices/activate", async ({ request }) => {
      expect(await request.json()).toEqual({ name: "Reception laptop" });
      activationAttempts += 1;
      if (activationAttempts === 1) {
        return HttpResponse.json(
          { message: "Could not set up this device. Try again." },
          { status: 503 },
        );
      }
      activeDevice = {
        kind: "device",
        deviceId: "laptop",
        workspaceId: "team",
        workspaceName: "Demo team",
        name: "Reception laptop",
      };
      return HttpResponse.json({ status: "paired" });
    }),
    http.get("/api/config/device", () => HttpResponse.json({ sources: [], rules: [] })),
  );
  const user = await open();
  const browser = await screen.findByRole("region", { name: "This browser" });
  expect(browser).toHaveTextContent("Workspace management");
  expect(browser).toHaveTextContent("Your workspace login stays signed in");
  expect(within(browser).getByRole("button", { name: "Use this device instead" })).toBeVisible();
  await user.click(await screen.findByRole("button", { name: "Add device" }));
  await user.type(screen.getByLabelText("Device name"), "Lobby");
  await user.type(screen.getByLabelText("Pairing code"), "123456");
  await user.click(screen.getByRole("button", { name: "Connect device" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("expired");
  expect(screen.getByLabelText("Device name")).toHaveValue("Lobby");
  expect(screen.getByLabelText("Pairing code")).toHaveValue("123456");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Switch to device mode" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("stay signed in");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Add device" })).toBeVisible();
  expect(activationAttempts).toBe(0);
  await user.click(screen.getByRole("button", { name: "Switch to device mode" }));
  await user.type(await screen.findByLabelText("Device name"), "Reception laptop");
  await user.click(screen.getByRole("button", { name: "Set up device" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not set up this device");
  expect(screen.getByLabelText("Device name")).toHaveValue("Reception laptop");
  expect(screen.getByRole("button", { name: "Set up device" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Set up device" }));
  expect(await screen.findByRole("heading", { name: "Capture station" })).toBeVisible();
  expect(principal).toMatchObject({ kind: "member" });
  expect(screen.queryByRole("button", { name: "Add device" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Switch to device mode" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Return to workspace" })).toBeVisible();
});

test("owners can find the device-mode action from Team and cancel without losing workspace access", async () => {
  principal = owner;
  server.use(http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })));
  const user = await open("/team");
  const header = await screen.findByRole("banner");
  await user.click(await within(header).findByRole("button", { name: "Switch to device mode" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("stay signed in");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("heading", { name: "Team" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Workspace" })).toBeVisible();
  expect(principal).toMatchObject({ kind: "member", role: "owner" });
});

test("operators can find the device-mode action from Team and return without losing workspace access", async () => {
  principal = { ...owner, role: "operator" };
  server.use(http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })));
  const user = await open("/team");
  const header = await screen.findByRole("banner");
  await user.click(await within(header).findByRole("button", { name: "Switch to device mode" }));
  expect(await screen.findByRole("heading", { name: "Set up this device" })).toBeVisible();
  expect(screen.getByText(/Once approved/)).toHaveTextContent("stay signed in");
  expect(screen.queryByRole("button", { name: "Set up device" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Back to workspace" }));
  expect(await screen.findByRole("heading", { name: "Devices" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Workspace" })).toBeVisible();
  expect(principal).toMatchObject({ kind: "member", role: "operator" });
});

test("operators recover from a pairing-code failure and enter device mode after owner approval", async () => {
  principal = { ...owner, role: "operator" };
  let attempts = 0;
  server.use(
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
    http.post("/api/access/pairing/start", () => {
      attempts += 1;
      return attempts === 1
        ? HttpResponse.json({ message: "Could not get a code. Try again." }, { status: 503 })
        : HttpResponse.json({ code: "654321", expiresAt: Date.now() + 300000 });
    }),
    http.post("/api/access/pairing/claim", () => {
      activeDevice = {
        kind: "device",
        deviceId: "laptop",
        workspaceId: "team",
        workspaceName: "Demo team",
        name: "Paired laptop",
      };
      return HttpResponse.json({ status: "paired" });
    }),
    http.get("/api/config/device", () => HttpResponse.json({ sources: [], rules: [] })),
  );
  const user = await open();
  await user.click(await screen.findByRole("button", { name: "Switch to device mode" }));
  await user.click(await screen.findByRole("button", { name: "Get pairing code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not get a code");
  expect(screen.getByRole("link", { name: "Back to workspace" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Get pairing code" }));
  expect(await screen.findByRole("status", { name: "Pairing code" })).toHaveTextContent("654321");
  expect(screen.getByText("Waiting for your workspace owner")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await waitFor(
    () => expect(screen.getByRole("heading", { name: "Capture station" })).toBeVisible(),
    {
      timeout: 4000,
    },
  );
  expect(principal).toMatchObject({ kind: "member", role: "operator" });
  expect(screen.getByRole("button", { name: "Return to workspace" })).toBeVisible();
  expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Switch to device mode" })).not.toBeInTheDocument();
});

test("operators can leave a pending pairing and keep using their workspace", async () => {
  principal = { ...owner, role: "operator" };
  server.use(
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
    http.post("/api/access/pairing/start", () =>
      HttpResponse.json({ code: "654321", expiresAt: Date.now() + 300000 }),
    ),
    http.post("/api/access/pairing/claim", () => HttpResponse.json({ status: "pending" })),
  );
  const user = await open();
  await user.click(await screen.findByRole("button", { name: "Switch to device mode" }));
  await user.click(await screen.findByRole("button", { name: "Get pairing code" }));
  expect(await screen.findByRole("status", { name: "Pairing code" })).toHaveTextContent("654321");
  await user.click(screen.getByRole("link", { name: "Back to workspace" }));
  expect(await screen.findByRole("heading", { name: "Devices" })).toBeVisible();
  expect(screen.queryByRole("status", { name: "Pairing code" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Switch to device mode" })).toBeVisible();
});

test("team removal asks for confirmation before removing access", async () => {
  principal = owner;
  let removed = false;
  server.use(
    http.get("/api/access/team", () =>
      HttpResponse.json({
        members: removed ? [] : [{ userId: "taylor", name: "Taylor", role: "operator" }],
        devices: [],
      }),
    ),
    http.post("/api/access/remove-member", async ({ request }) => {
      expect(await request.json()).toEqual({ id: "taylor" });
      removed = true;
      return HttpResponse.json({ removed: true });
    }),
  );
  const user = await open();
  await user.click(await screen.findByRole("link", { name: "Team" }));
  await user.click(await screen.findByRole("button", { name: "Remove Taylor" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Taylor")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Remove Taylor" }));
  await user.click(screen.getByRole("button", { name: "Remove member" }));
  expect(await screen.findByText("Taylor was removed from the team.")).toHaveRole("status");
  expect(screen.queryByRole("button", { name: "Remove Taylor" })).not.toBeInTheDocument();
});

test("a failed workspace load can be retried", async () => {
  principal = owner;
  let failed = true;
  server.use(
    http.get("/api/access/team", () =>
      failed
        ? HttpResponse.json({ message: "Unable to load devices. Try again." }, { status: 503 })
        : HttpResponse.json({ members: [], devices: [] }),
    ),
  );
  const user = await open();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load devices");
  failed = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No devices connected")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("operators can open and close live view, retry unsupported browsers, and cannot view revoked devices", async () => {
  principal = { ...owner, role: "operator" };
  server.use(
    http.get("/api/access/team", () =>
      HttpResponse.json({
        members: [],
        devices: [
          { id: "camera", name: "Lobby", revokedAt: null },
          { id: "removed", name: "Removed camera", revokedAt: 1 },
        ],
      }),
    ),
  );
  const user = await open();
  await user.click(await screen.findByRole("button", { name: "Live view of Lobby" }));
  expect(screen.queryByRole("region", { name: "This browser" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove access for Lobby" })).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Live viewing is unavailable in this browser.",
  );
  expect(screen.getByRole("heading", { name: "Live view · Lobby" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Live view of Removed camera" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry live view" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Live viewing is unavailable in this browser.",
  );
  await user.click(screen.getByRole("button", { name: "Close live view" }));
  expect(screen.queryByLabelText("Live device video")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Live view of Lobby" })).toBeVisible();
});

test("visitor header preserves the Lookout home link and static mark", async () => {
  await open();
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeVisible();
  const home = screen.getByRole("link", { name: "Lookout home" });
  expect(within(home).getByLabelText("Lookout")).toBeVisible();
  expect(home.querySelector("svg")).toBeInTheDocument();
  expect(home.querySelector("canvas")).not.toBeInTheDocument();
});

test("remembered capture resumes directly, returns to workspace, and forgetting requires confirmation", async () => {
  principal = owner;
  activeDevice = {
    kind: "device",
    deviceId: "laptop",
    workspaceId: "team",
    workspaceName: "Demo team",
    name: "Reception laptop",
  };
  let activations = 0;
  let forgotten = false;
  server.use(
    http.get("/api/access/devices/remembered", () => HttpResponse.json({ device: activeDevice })),
    http.get("/api/access/team", () =>
      HttpResponse.json({
        members: [],
        devices: [{ id: "laptop", name: "Reception laptop", revokedAt: null }],
      }),
    ),
    http.get("/api/config/device", () => HttpResponse.json({ sources: [], rules: [] })),
    http.post("/api/access/devices/activate", () => {
      activations++;
      return HttpResponse.json({ status: "paired" });
    }),
    http.post("/api/access/devices/forget", () => {
      forgotten = true;
      activeDevice = null;
      return HttpResponse.json({ left: true });
    }),
  );
  const user = await open("/devices");
  await user.click(await screen.findByRole("button", { name: "Switch to device mode" }));
  expect(await screen.findByRole("heading", { name: "Capture station" })).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(activations).toBe(0);
  await user.click(screen.getByRole("button", { name: "Return to workspace" }));
  expect(await screen.findByRole("heading", { name: "Devices" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Switch to device mode" }));
  await user.click(await screen.findByRole("button", { name: "Forget this device" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(forgotten).toBe(false);
  await user.click(screen.getByRole("button", { name: "Forget this device" }));
  await user.click(screen.getByRole("button", { name: "Forget device" }));
  expect(await screen.findByRole("heading", { name: "Devices" })).toBeVisible();
  expect(forgotten).toBe(true);
  expect(principal).toMatchObject({ kind: "member" });
});

test("reconnecting an existing device preserves the selected identity and supports delayed failure and retry", async () => {
  principal = owner;
  const response = responseGate();
  let attempts = 0;
  server.use(
    http.get("/api/access/team", () =>
      HttpResponse.json({
        members: [],
        devices: [{ id: "existing", name: "Lobby", revokedAt: 1 }],
      }),
    ),
    http.post("/api/access/pairing/approve", async ({ request }) => {
      expect(await request.json()).toEqual({ code: "123456", deviceId: "existing" });
      if (++attempts === 1) {
        await response.promise;
        return HttpResponse.json(
          { message: "Pairing code expired. Get a new code." },
          { status: 400 },
        );
      }
      return HttpResponse.json({ paired: true });
    }),
  );
  const user = await open("/devices");
  await user.click(await screen.findByRole("button", { name: "Reconnect Lobby" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("disconnects its previous browser");
  expect(screen.queryByLabelText("Device name")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Pairing code"), "123456");
  await user.click(screen.getByRole("button", { name: "Reconnect device" }));
  expect(screen.getByRole("button", { name: "Connecting device…" })).toBeDisabled();
  expect(screen.getByLabelText("Pairing code")).toHaveValue("123456");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  response.resolve();
  expect(await screen.findByRole("alert")).toHaveTextContent("expired");
  await user.click(screen.getByRole("button", { name: "Reconnect device" }));
  expect(await screen.findByText(/Device approved/)).toBeVisible();
  expect(attempts).toBe(2);
});

test("device lookup keeps workspace content while pending and can be retried after failure", async () => {
  principal = { ...owner, role: "operator" };
  const response = responseGate();
  let attempts = 0;
  server.use(
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
    http.get("/api/access/devices/remembered", async () => {
      if (++attempts === 1) {
        await response.promise;
        return HttpResponse.json({ message: "Could not check saved device." }, { status: 503 });
      }
      return HttpResponse.json({ device: null });
    }),
  );
  const user = await open("/team");
  await user.click(await screen.findByRole("button", { name: "Switch to device mode" }));
  expect(screen.getByRole("button", { name: "Checking saved device…" })).toBeDisabled();
  expect(screen.getByRole("heading", { name: "Team" })).toBeVisible();
  response.resolve();
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not check saved device");
  await user.click(screen.getByRole("button", { name: "Switch to device mode" }));
  expect(await screen.findByRole("heading", { name: "Set up this device" })).toBeVisible();
});

test("sign-in offers a remembered device without requiring account credentials", async () => {
  server.use(
    http.get("/api/access/devices/remembered", () =>
      HttpResponse.json({
        device: {
          kind: "device",
          deviceId: "laptop",
          workspaceId: "team",
          workspaceName: "Demo team",
          name: "Reception laptop",
        },
      }),
    ),
  );
  await open("/devices");
  expect(await screen.findByRole("link", { name: "Resume Reception laptop" })).toHaveAttribute(
    "href",
    "/device",
  );
  expect(screen.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("leaving a workspace page cancels its pending device lookup without redirecting", async () => {
  principal = owner;
  const response = responseGate();
  const released = responseGate();
  server.use(
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
    http.get("/api/access/devices/remembered", async () => {
      await response.promise;
      released.resolve();
      return HttpResponse.json({
        device: {
          kind: "device",
          deviceId: "laptop",
          workspaceId: "team",
          workspaceName: "Demo team",
          name: "Reception laptop",
        },
      });
    }),
  );
  const user = await open("/devices");
  await user.click(await screen.findByRole("button", { name: "Switch to device mode" }));
  expect(screen.getByRole("button", { name: "Checking saved device…" })).toBeDisabled();
  await user.click(screen.getByRole("link", { name: "Team" }));
  expect(await screen.findByRole("heading", { name: "Team" })).toBeVisible();
  await act(async () => {
    response.resolve();
    await released.promise;
  });
  expect(screen.getByRole("heading", { name: "Team" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Switch to device mode" })).toBeEnabled();
  expect(screen.queryByRole("heading", { name: "Capture station" })).not.toBeInTheDocument();
});
