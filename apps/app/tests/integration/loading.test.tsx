import { responseGate } from "../support/response-gate";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, test } from "vitest";
import { getRouter } from "../../src/router";
import { server } from "../support/server";

const member = {
  kind: "member",
  userId: "owner",
  workspaceId: "workspace",
  workspaceName: "Demo team",
  name: "Alex",
  role: "owner",
};

async function open(path: string) {
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: [path] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />, { container: document });
  return router;
}

test("access loading does not expose protected content and ends at sign in", async () => {
  const response = responseGate();
  server.use(
    http.get("/api/access/principal", async () => {
      await response.promise;
      return HttpResponse.json({ kind: "visitor" });
    }),
  );
  await open("/devices");
  expect(await screen.findByRole("status", { name: "Opening your workspace…" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Devices" })).not.toBeInTheDocument();
  response.resolve();
  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
  expect(screen.queryByRole("status", { name: "Opening your workspace…" })).not.toBeInTheDocument();
});

test.each([
  {
    path: "/devices",
    endpoint: "/api/access/team",
    label: "Loading devices…",
    result: { members: [], devices: [] },
    ready: "No devices connected",
  },
  {
    path: "/team",
    endpoint: "/api/access/team",
    label: "Loading team…",
    result: { members: [{ userId: "owner", name: "Alex", role: "owner" }], devices: [] },
    ready: "Owner",
  },
  {
    path: "/triggers",
    endpoint: "/api/config/operator",
    label: "Loading triggers…",
    result: { sources: [], rules: [], recipients: [] },
    ready: /No triggers yet/,
  },
  {
    path: "/incidents",
    endpoint: "/api/incidents/inbox",
    label: "Loading incidents…",
    result: { incidents: [] },
    ready: "No incidents yet",
  },
])(
  "$path distinguishes an initial load from an empty or loaded result",
  async ({ path, endpoint, label, result, ready }) => {
    const response = responseGate();
    server.use(
      http.get("/api/access/principal", () => HttpResponse.json(member)),
      http.get(endpoint, async () => {
        await response.promise;
        return HttpResponse.json(result);
      }),
    );
    await open(path);
    expect(await screen.findByRole("status", { name: label })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeVisible();
    expect(screen.queryByText(ready)).not.toBeInTheDocument();
    response.resolve();
    expect(await screen.findByText(ready)).toBeVisible();
    expect(screen.queryByRole("status", { name: label })).not.toBeInTheDocument();
  },
);

test("incident loading ends with an actionable error and a busy retry", async () => {
  const response = responseGate();
  let reads = 0;
  server.use(
    http.get("/api/access/principal", () => HttpResponse.json(member)),
    http.get("/api/incidents/detail/missing", async () => {
      reads++;
      await response.promise;
      return HttpResponse.json({ message: "Incident unavailable" }, { status: 503 });
    }),
  );
  await open("/incidents/missing");
  expect(await screen.findByRole("status", { name: "Loading incident…" })).toBeVisible();
  response.resolve();
  expect(await screen.findByRole("alert")).toHaveTextContent("Incident unavailable");
  expect(screen.queryByRole("status", { name: "Loading incident…" })).not.toBeInTheDocument();
  const retry = responseGate();
  server.use(
    http.get("/api/incidents/detail/missing", async () => {
      reads++;
      await retry.promise;
      return HttpResponse.json({ message: "Incident still unavailable" }, { status: 503 });
    }),
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Reload incident" }));
  expect(screen.getByRole("button", { name: "Reloading incident…" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Back to inbox" })).toBeVisible();
  retry.resolve();
  expect(await screen.findByText("Incident still unavailable")).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reload incident" })).toBeEnabled(),
  );
  expect(reads).toBe(2);
});

test("manual refresh keeps loaded content visible and prevents duplicate requests", async () => {
  const response = responseGate();
  let reads = 0;
  server.use(
    http.get("/api/access/principal", () => HttpResponse.json(member)),
    http.get("/api/incidents/inbox", async () => {
      if (++reads > 1) await response.promise;
      return HttpResponse.json({ incidents: [] });
    }),
  );
  await open("/incidents");
  await screen.findByText("No incidents yet");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Reload inbox" }));
  const button = screen.getByRole("button", { name: "Reloading inbox…" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("No incidents yet")).toBeVisible();
  expect(screen.queryByRole("status", { name: "Loading incidents…" })).not.toBeInTheDocument();
  await user.click(button);
  expect(reads).toBe(2);
  response.resolve();
  await waitFor(() => expect(screen.getByRole("button", { name: "Reload inbox" })).toBeEnabled());
});

test("sign-in feedback preserves values after failure and allows retry", async () => {
  const response = responseGate();
  let submissions = 0;
  server.use(
    http.get("/api/access/principal", () => HttpResponse.json({ kind: "visitor" })),
    http.post("/api/auth/sign-in/email", async () => {
      submissions++;
      await response.promise;
      return HttpResponse.json({ message: "Please check your password" }, { status: 401 });
    }),
  );
  await open("/devices");
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "alex@example.com");
  await user.type(screen.getByLabelText("Password"), "wrong-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  const button = screen.getByRole("button", { name: "Signing in…" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  await user.click(button);
  expect(submissions).toBe(1);
  response.resolve();
  expect(await screen.findByRole("alert")).toHaveTextContent("Please check your password");
  expect(screen.getByLabelText("Email")).toHaveValue("alex@example.com");
  expect(screen.getByLabelText("Password")).toHaveValue("wrong-password");
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("device configuration has a distinct loading state before its empty result", async () => {
  const response = responseGate();
  server.use(
    http.get("/api/access/principal", () =>
      HttpResponse.json({
        kind: "device",
        deviceId: "device",
        workspaceId: "workspace",
        workspaceName: "Demo team",
        name: "Camera",
      }),
    ),
    http.get("/api/config/device", async () => {
      await response.promise;
      return HttpResponse.json({ sources: [], rules: [] });
    }),
  );
  await open("/monitor");
  expect(await screen.findByRole("status", { name: "Loading configuration…" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Open capture station" })).toBeVisible();
  expect(screen.queryByText("No sources configured yet.")).not.toBeInTheDocument();
  response.resolve();
  expect(await screen.findByText("No sources configured yet.")).toBeVisible();
});

test("navigation remains available while a list is loading", async () => {
  const response = responseGate();
  server.use(
    http.get("/api/access/principal", () => HttpResponse.json(member)),
    http.get("/api/access/team", async () => {
      await response.promise;
      return HttpResponse.json({ members: [], devices: [] });
    }),
    http.get("/api/incidents/inbox", () => HttpResponse.json({ incidents: [] })),
  );
  await open("/devices");
  await screen.findByRole("status", { name: "Loading devices…" });
  await userEvent.setup().click(screen.getByRole("link", { name: "Incidents" }));
  expect(await screen.findByText("No incidents yet")).toBeVisible();
  response.resolve();
  expect(screen.queryByRole("status", { name: "Loading devices…" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Incident inbox" })).toBeVisible();
});
