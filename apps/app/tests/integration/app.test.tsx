import { http, HttpResponse } from "msw";
import { server } from "../support/server";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { getRouter } from "../../src/router";

test("dashboard navigation keeps the workspace shell and access connection mounted", async () => {
  let principalReads = 0;
  server.use(
    http.get("/api/access/principal", () => {
      principalReads += 1;
      return HttpResponse.json({
        kind: "member",
        userId: "owner",
        workspaceId: "workspace",
        workspaceName: "Demo team",
        name: "Alex",
        role: "owner",
      });
    }),
    http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })),
    http.get("/api/config/operator", () =>
      HttpResponse.json({ sources: [], rules: [], recipients: [] }),
    ),
  );
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />);
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
});

test("the home route displays the application", async () => {
  server.use(http.get("/api/access/principal", () => HttpResponse.json({ kind: "visitor" })));
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("an unknown route displays the not-found screen", async () => {
  server.use(http.get("/api/access/principal", () => HttpResponse.json({ kind: "visitor" })));
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/does-not-exist"] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  expect(await screen.findByText("Not Found")).toBeVisible();
});
