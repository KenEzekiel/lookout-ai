import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, test } from "vitest";
import { server } from "../support/server";
import { getRouter } from "../../src/router";
import type { Principal } from "../../src/lib/access";

const owner = {
  kind: "member",
  userId: "owner",
  workspaceId: "team",
  workspaceName: "Demo team",
  name: "Alex",
  role: "owner",
} satisfies Principal;
let principal: Principal;
beforeEach(() => {
  principal = { kind: "visitor" };
  server.use(http.get("/api/access/principal", () => HttpResponse.json(principal)));
});
async function open(path = "/") {
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: [path] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

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
  await user.click(await screen.findByRole("button", { name: "New here? Create an account" }));
  await user.type(screen.getByLabelText("Your name"), "Taylor");
  await user.type(screen.getByLabelText("Email"), "taylor@example.com");
  await user.type(screen.getByLabelText("Password"), "password-123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await user.click(await screen.findByRole("button", { name: "Accept invitation" }));
  expect(await screen.findByText("Signed in as Taylor. Your role is operator.")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Invite an operator" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Switch to monitoring mode" }),
  ).not.toBeInTheDocument();
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
  await user.type(await screen.findByLabelText("Invitation code"), "123456");
  await user.click(screen.getByRole("button", { name: "Join workspace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("expired");
  await user.type(screen.getByLabelText("Workspace name"), "Demo team");
  await user.click(screen.getByRole("button", { name: "Create workspace" }));
  expect(await screen.findByText("No devices paired yet.")).toBeVisible();
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
  await user.click(await screen.findByRole("button", { name: "Create invitation" }));
  expect(await screen.findByText("012345")).toBeVisible();
  expect(screen.getByLabelText("Invitation link")).toHaveValue(
    `http://localhost:3000/join?token=${"a".repeat(64)}`,
  );
  await user.type(screen.getByLabelText("Device name"), "Lobby");
  await user.type(screen.getByLabelText("Device pairing code"), "654321");
  await user.click(screen.getByRole("button", { name: "Approve device" }));
  await user.click(await screen.findByRole("button", { name: "Revoke Lobby" }));
  expect(await screen.findByText("Revoked")).toBeVisible();
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
  await user.click(await screen.findByRole("button", { name: "Generate pairing code" }));
  expect(within(await screen.findByRole("status")).getByText("003456")).toBeVisible();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
});
