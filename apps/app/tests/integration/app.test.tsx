import { http, HttpResponse } from "msw";
import { server } from "../support/server";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { getRouter } from "../../src/router";

test("the home route displays the application", async () => {
  server.use(http.get("/api/access/principal", () => HttpResponse.json({ kind: "visitor" })));
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole("heading", { name: "Lookout AI" })).toBeVisible();
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
