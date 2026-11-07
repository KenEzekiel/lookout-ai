import { http, HttpResponse } from "msw";
import { server } from "../support/server";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { getRouter } from "../../src/router";

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

test("dashboard navigation keeps the workspace shell and access connection mounted", async () => {
  let principalReads = 0;
  server.use(
    http.get("/api/access/principal", () => {
      principalReads += 1;
      return HttpResponse.json(member);
    }),
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
    http.get("/api/config/operator", () =>
      HttpResponse.json({ sources: [], rules: [], recipients: [] }),
    ),
  );
  const router = await open("/devices");
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Devices" });
  const header = screen.getByRole("banner");
  await user.click(screen.getByRole("link", { name: "Triggers" }));
  expect(await screen.findByRole("heading", { name: "Triggers" })).toBeVisible();
  expect(screen.getByRole("banner")).toBe(header);
  expect(principalReads).toBe(1);
  await user.click(screen.getByRole("link", { name: "Team" }));
  expect(await screen.findByRole("heading", { name: "Team" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/team");
  expect(router.state.location.searchStr).toBe("");
  expect(screen.getByRole("banner")).toBe(header);
  expect(principalReads).toBe(1);
  await act(() => router.history.back());
  expect(await screen.findByRole("heading", { name: "Triggers" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/triggers");
  await act(() => router.history.forward());
  expect(await screen.findByRole("heading", { name: "Team" })).toBeVisible();
  const navigation = screen.getByRole("navigation", { name: "Workspace" });
  expect(within(navigation).getAllByRole("link", { current: "page" })).toHaveLength(1);
  expect(within(navigation).getByRole("link", { name: "Devices" })).toHaveAttribute(
    "href",
    "/devices",
  );
  expect(within(navigation).getByRole("link", { name: "Team" })).toHaveAttribute("href", "/team");
  expect(screen.getByRole("banner")).toBe(header);
  expect(principalReads).toBe(1);
});

test("the landing page introduces Lookout and opens the existing access flow", async () => {
  server.use(http.get("/api/access/principal", () => HttpResponse.json({ kind: "visitor" })));
  const router = await open("/");
  expect(
    screen.getByRole("heading", { name: /Be there for the moments that matter/ }),
  ).toBeVisible();
  expect(screen.getByText("Replayed example")).toBeVisible();
  expect(screen.getByRole("link", { name: "Pitch deck" })).toHaveAttribute(
    "href",
    "/pitch-deck.html",
  );
  expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute(
    "href",
    "#how-it-works",
  );
  await userEvent.setup().click(screen.getByRole("link", { name: "See how it works" }));
  expect(router.state.location.pathname).toBe("/");
  await userEvent.setup().click(screen.getByRole("button", { name: /Define what matters/ }));
  expect(screen.getByRole("button", { name: /Define what matters/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await waitFor(() =>
    expect(screen.getByText("Notice a possible vehicle collision")).toBeVisible(),
  );
  await userEvent.setup().click(screen.getByRole("button", { name: /See the context/ }));
  expect(screen.getByRole("button", { name: /See the context/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(
    within(screen.getByRole("region", { name: "Selected Lookout example" })).getByText(
      "Possible crash",
    ),
  ).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("link", { name: "Get started" }));
  expect(router.state.location.pathname).toBe("/devices");
  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("an unknown route displays the not-found screen", async () => {
  server.use(http.get("/api/access/principal", () => HttpResponse.json({ kind: "visitor" })));
  await open("/does-not-exist");
  expect(await screen.findByText("Not Found")).toBeVisible();
});

test.each([
  { path: "/devices", title: "Devices", destination: "/devices" },
  { path: "/team", title: "Team", destination: "/team" },
  { path: "/join", title: "Devices", destination: "/devices" },
  { path: "/device", title: "Devices", destination: "/devices" },
])("members can open $path directly", async ({ path, title, destination }) => {
  server.use(
    http.get("/api/access/principal", () => HttpResponse.json(member)),
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
  );
  const router = await open(path);
  expect(await screen.findByRole("heading", { name: title })).toBeVisible();
  expect(router.state.location.pathname).toBe(destination);
  expect(screen.getByRole("link", { name: title, current: "page" })).toBeVisible();
});

test("signing out from a workspace path removes member content and alert controls", async () => {
  let signedIn = true;
  server.use(
    http.get("/api/access/principal", () =>
      HttpResponse.json(signedIn ? member : { kind: "visitor" }),
    ),
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
    http.post("/api/auth/sign-out", () => {
      signedIn = false;
      return HttpResponse.json({ success: true });
    }),
  );
  await open("/team");
  await screen.findByRole("heading", { name: "Team" });
  await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
  expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Incoming alerts/)).not.toBeInTheDocument();
});

test.each(["/devices", "/team", "/triggers", "/incidents", "/incidents/hidden"])(
  "visitors cannot open workspace content at %s",
  async (path) => {
    server.use(http.get("/api/access/principal", () => HttpResponse.json({ kind: "visitor" })));
    await open(path);
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Incoming alerts/)).not.toBeInTheDocument();
  },
);
