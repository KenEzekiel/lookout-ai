import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, test } from "vitest";
import { server } from "../support/server";
import { getRouter } from "../../src/router";
import { type Principal } from "../../src/lib/access";
import {
  type OperatorConfiguration,
  type Rule,
  ruleInputSchema,
  ruleUpdateSchema,
} from "../../src/lib/rules";

const owner = {
  kind: "member",
  userId: "owner",
  workspaceId: "workspace",
  workspaceName: "Demo team",
  name: "Alex",
  role: "owner",
} satisfies Principal;
const fall: Rule = {
  id: "fall",
  version: 1,
  sourceId: "camera",
  enabled: true,
  definition: {
    name: "Possible fall",
    condition: { kind: "template", template: "fall" },
    durationSeconds: null,
    severity: "critical",
    recipientIds: ["owner"],
    escalationDelaySeconds: 60,
  },
};
let principal: Principal;
let configuration: OperatorConfiguration;
beforeEach(() => {
  principal = owner;
  configuration = {
    sources: [
      { id: "camera", name: "Living room", kind: "camera" },
      { id: "replay", name: "Crash demo", kind: "replay" },
    ],
    rules: [],
    recipients: [
      { userId: "owner", name: "Alex", role: "owner" },
      { userId: "operator", name: "Taylor", role: "operator" },
    ],
  };
  server.use(
    http.get("/api/access/principal", () => HttpResponse.json(principal)),
    http.get("/api/config/operator", () => HttpResponse.json(configuration)),
    http.post("/api/config/rules/create", async ({ request }) => {
      const input = ruleInputSchema.parse(await request.json());
      const rule = { ...input, id: String(configuration.rules.length), version: 1 };
      configuration.rules.push(rule);
      return HttpResponse.json(rule, { status: 201 });
    }),
    http.post("/api/config/rules/update", async ({ request }) => {
      const input = ruleUpdateSchema.parse(await request.json());
      const rule = { ...input, version: input.version + 1 };
      configuration.rules = configuration.rules.map((item) => (item.id === rule.id ? rule : item));
      return HttpResponse.json(rule);
    }),
  );
});
async function open(path = "/triggers") {
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: [path] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

test("operators create fall, crash and custom triggers, edit and disable them, then reload", async () => {
  principal = { ...owner, role: "operator" };
  server.use(
    http.post("/api/config/rules/disable", async ({ request }) => {
      const input = await request.json();
      expect(input).toEqual({ id: "0", version: 2 });
      const current = configuration.rules.find((rule) => rule.id === "0");
      expect(current).toBeDefined();
      const rule = {
        ...fall,
        id: "0",
        enabled: false,
        version: 3,
        definition: { ...fall.definition, escalationDelaySeconds: 120 },
      };
      configuration.rules = configuration.rules.map((item) => (item.id === "0" ? rule : item));
      return HttpResponse.json(rule);
    }),
  );
  const user = await open();
  expect(await screen.findByText(/No triggers yet/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "New trigger" }));
  expect(screen.getByLabelText("Alex (owner)")).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Save trigger" }));
  expect(await screen.findByRole("article", { name: "Possible fall" })).toHaveTextContent(
    "Enabled · Version 1",
  );
  await user.click(screen.getByRole("button", { name: "New trigger" }));
  await user.selectOptions(screen.getByLabelText("Start from"), "crash");
  await user.selectOptions(screen.getByLabelText("Source", { exact: true }), "replay");
  await user.click(screen.getByRole("button", { name: "Save trigger" }));
  expect(await screen.findByRole("article", { name: "Possible crash" })).toHaveTextContent(
    "Replayed footage",
  );
  await user.click(screen.getByRole("button", { name: "New trigger" }));
  await user.selectOptions(screen.getByLabelText("Start from"), "custom");
  await user.type(screen.getByLabelText("Trigger name"), "Blocked exit");
  await user.type(
    screen.getByLabelText("Observable event"),
    "A vehicle blocks the marked emergency exit.",
  );
  await user.type(screen.getByLabelText("Duration condition (seconds, optional)"), "15");
  await user.selectOptions(screen.getByLabelText("Severity", { exact: true }), "warning");
  await user.click(screen.getByLabelText("Taylor (operator)"));
  await user.click(screen.getByRole("button", { name: "Save trigger" }));
  const custom = await screen.findByRole("article", { name: "Blocked exit" });
  expect(custom).toHaveTextContent("15 seconds");
  expect(custom).toHaveTextContent("Alex, Taylor");
  await user.click(screen.getByRole("button", { name: "Edit Possible fall" }));
  await user.clear(screen.getByLabelText("Escalation delay (seconds)"));
  await user.type(screen.getByLabelText("Escalation delay (seconds)"), "120");
  await user.click(screen.getByRole("button", { name: "Save trigger" }));
  expect(await screen.findByText("Possible fall saved. Enabled at version 2.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Disable Possible fall" }));
  expect(await screen.findByRole("article", { name: "Possible fall" })).toHaveTextContent(
    "Disabled · Version 3",
  );
  await user.click(screen.getByRole("button", { name: "Reload triggers" }));
  expect(await screen.findByRole("article", { name: "Possible fall" })).toHaveTextContent(
    "Disabled · Version 3",
  );
  expect(screen.getByRole("article", { name: "Possible crash" })).toBeVisible();
});

test("recipient validation and stale-save errors preserve the draft and allow recovery", async () => {
  const user = await open();
  await user.click(await screen.findByRole("button", { name: "New trigger" }));
  await user.click(screen.getByLabelText("Alex (owner)"));
  await user.click(screen.getByRole("button", { name: "Save trigger" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Choose at least one alert recipient.",
  );
  expect(configuration.rules).toEqual([]);
  await user.click(screen.getByLabelText("Taylor (operator)"));
  server.use(
    http.post("/api/config/rules/create", () =>
      HttpResponse.json(
        { message: "Rule changed. Reload triggers and try again." },
        { status: 409 },
      ),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Save trigger" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Rule changed");
  expect(screen.getByLabelText("Trigger name")).toHaveValue("Possible fall");
  expect(screen.getByLabelText("Taylor (operator)")).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Cancel editing" }));
  await user.click(screen.getByRole("button", { name: "Reload triggers" }));
  expect(await screen.findByText(/No triggers yet/)).toBeVisible();
});

test("empty sources guide setup, reject duplicate-source errors and enable trigger creation", async () => {
  configuration.sources = [];
  server.use(
    http.post("/api/config/sources", async ({ request }) => {
      expect(await request.json()).toEqual({ name: "Living room", kind: "camera" });
      return HttpResponse.json(
        { message: "A source with this name already exists." },
        { status: 409 },
      );
    }),
  );
  const user = await open();
  expect(await screen.findByRole("button", { name: "New trigger" })).toBeDisabled();
  await user.type(await screen.findByLabelText("Source name"), "Living room");
  await user.click(screen.getByRole("button", { name: "Add source" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  expect(screen.getByLabelText("Source name")).toHaveValue("Living room");
  server.use(
    http.post("/api/config/sources", () =>
      HttpResponse.json({ id: "new-camera", name: "Living room", kind: "camera" }, { status: 201 }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Add source" }));
  expect(await screen.findByRole("button", { name: "New trigger" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "New trigger" }));
  expect(screen.getByLabelText("Source", { exact: true })).toHaveValue("new-camera");
});

test("configuration failures show an error and reload recovers", async () => {
  server.use(
    http.get("/api/config/operator", () =>
      HttpResponse.json({ message: "Configuration unavailable. Try again." }, { status: 503 }),
    ),
  );
  const user = await open();
  expect(await screen.findByRole("alert")).toHaveTextContent("Configuration unavailable");
  expect(screen.getByRole("button", { name: "New trigger" })).toBeDisabled();
  server.use(http.get("/api/config/operator", () => HttpResponse.json(configuration)));
  await user.click(screen.getByRole("button", { name: "Reload triggers" }));
  expect(await screen.findByText(/No triggers yet/)).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a paired device displays received versions, refreshes disabled rules and hides configuration on denial", async () => {
  principal = {
    kind: "device",
    deviceId: "device",
    workspaceId: "workspace",
    workspaceName: "Demo team",
    name: "Monitoring browser",
  };
  configuration.rules = [fall];
  server.use(
    http.get("/api/config/device", () =>
      HttpResponse.json({ sources: configuration.sources, rules: configuration.rules }),
    ),
  );
  const user = await open("/monitor");
  const received = await screen.findByRole("region", { name: "Device configuration" });
  expect(await within(received).findByText("Possible fall · Enabled · Version 1")).toBeVisible();
  expect(screen.queryByRole("button", { name: "New trigger" })).not.toBeInTheDocument();
  configuration.rules = [{ ...fall, enabled: false, version: 2 }];
  await user.click(screen.getByRole("button", { name: "Refresh configuration" }));
  expect(await screen.findByText("Possible fall · Disabled · Version 2")).toBeVisible();
  server.use(
    http.get("/api/config/device", () =>
      HttpResponse.json({ message: "Device access revoked." }, { status: 401 }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Refresh configuration" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Device access revoked");
  expect(screen.queryByRole("region", { name: "Device configuration" })).not.toBeInTheDocument();
});

test("members navigate between workspace access and triggers with one active destination", async () => {
  server.use(http.get("/api/access/team", () => HttpResponse.json({ members: [], devices: [] })));
  const user = await open("/");
  expect(await screen.findByRole("heading", { name: "Devices" })).toBeVisible();
  await user.click(screen.getByRole("link", { name: "Triggers" }));
  expect(await screen.findByRole("heading", { name: "Triggers" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Triggers" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Devices" })).not.toHaveAttribute("aria-current");
  await user.click(screen.getByRole("link", { name: "Team" }));
  expect(await screen.findByRole("heading", { name: "Team" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Triggers" })).not.toHaveAttribute("aria-current");
});
