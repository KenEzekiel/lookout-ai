import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, test } from "vitest";
import { server } from "../support/server";
import { getRouter } from "../../src/router";

const endpoint = "https://fcm.googleapis.com/fcm/send/test-browser";
const subscription = {
  endpoint,
  expirationTime: null,
  keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) },
};
let permission: NotificationPermission;
let requested: number;
let registered: string[];
let writes: unknown[];
let removals: unknown[];
let subscribed: boolean;
let configured: boolean;
const restore: (() => void)[] = [];
function platform(object: object, key: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  restore.push(() => {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else Reflect.deleteProperty(object, key);
  });
  Object.defineProperty(object, key, { value, configurable: true });
}
beforeEach(() => {
  permission = "default";
  requested = 0;
  registered = [];
  writes = [];
  removals = [];
  subscribed = false;
  configured = true;
  const browserSubscription = {
    endpoint,
    toJSON: () => subscription,
    unsubscribe: async () => {
      subscribed = false;
      return true;
    },
  };
  const registration = {
    pushManager: {
      getSubscription: async () => (subscribed ? browserSubscription : null),
      subscribe: async () => {
        subscribed = true;
        return browserSubscription;
      },
    },
  };
  platform(window, "isSecureContext", true);
  platform(window, "PushManager", class {});
  platform(
    window,
    "Notification",
    class {
      static get permission() {
        return permission;
      }
      static async requestPermission() {
        requested++;
        return permission;
      }
    },
  );
  platform(navigator, "serviceWorker", {
    getRegistration: async () => registration,
    register: async (path: string) => {
      registered.push(path);
      return registration;
    },
    ready: Promise.resolve(registration),
  });
  server.use(
    http.get("/api/access/principal", () =>
      HttpResponse.json({
        kind: "member",
        role: "owner",
        userId: "owner",
        name: "Alex",
        workspaceId: "team",
        workspaceName: "Safety team",
      }),
    ),
    http.get("/api/incidents/alerts", () => HttpResponse.json({ incidents: [] })),
    http.get("/api/incidents/inbox", () => HttpResponse.json({ incidents: [] })),
    http.get("/api/push/settings", () =>
      HttpResponse.json({
        configured,
        publicKey: configured ? "B".repeat(87) : null,
        endpoints: subscribed ? [endpoint] : [],
      }),
    ),
    http.post("/api/push/subscribe", async ({ request }) => {
      writes.push(await request.json());
      return HttpResponse.json({ subscribed: true });
    }),
    http.post("/api/push/unsubscribe", async ({ request }) => {
      removals.push(await request.json());
      return HttpResponse.json({ subscribed: false });
    }),
  );
});
afterEach(() => {
  restore
    .splice(0)
    .reverse()
    .forEach((undo) => undo());
});
async function open() {
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/incidents"] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Background alerts" }));
  return user;
}

test("operators explicitly subscribe and unsubscribe this browser through the complete member screen", async () => {
  permission = "granted";
  const user = await open();
  await user.click(await screen.findByRole("button", { name: "Enable alerts" }));
  expect(
    await screen.findByText("Background alerts are enabled for this browser session."),
  ).toBeVisible();
  expect(requested).toBe(1);
  expect(registered).toEqual(["/push-worker.js"]);
  expect(writes).toEqual([subscription]);
  await user.click(screen.getByRole("button", { name: "Turn off background alerts" }));
  expect(
    await screen.findByText("Background alerts are off for this browser session."),
  ).toBeVisible();
  expect(removals).toEqual([{ endpoint }]);
});

test("permission dismissal and backend rejection stay visible and permit retry", async () => {
  const user = await open();
  await user.click(await screen.findByRole("button", { name: "Enable alerts" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Permission was not granted");
  expect(writes).toEqual([]);
  permission = "granted";
  let failed = true;
  server.use(
    http.post("/api/push/subscribe", () =>
      failed
        ? HttpResponse.json(
            { message: "Subscription could not be saved. Try again." },
            { status: 503 },
          )
        : HttpResponse.json({ subscribed: true }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Enable alerts" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Subscription could not be saved");
  failed = false;
  await user.click(screen.getByRole("button", { name: "Enable alerts" }));
  expect(
    await screen.findByText("Background alerts are enabled for this browser session."),
  ).toBeVisible();
});

test("blocked permissions explain recovery without prompting again", async () => {
  permission = "denied";
  await open();
  expect(await screen.findByText(/Notifications are blocked. Allow notifications/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Enable alerts" })).not.toBeInTheDocument();
  expect(requested).toBe(0);
});

test("unsupported browsers and unconfigured servers keep foreground alert access", async () => {
  platform(window, "isSecureContext", false);
  await open();
  expect(
    await screen.findByText(/Background alerts are unavailable in this browser/),
  ).toBeVisible();
  expect(screen.getByText(/Incoming alerts connected/)).toBeVisible();
});

test("a server without VAPID configuration explains why setup is unavailable", async () => {
  configured = false;
  await open();
  expect(
    await screen.findByText(/Background alerts are not configured on this server/),
  ).toBeVisible();
  expect(requested).toBe(0);
});

test("iOS browsers explain Home Screen setup before requesting notification permission", async () => {
  platform(navigator, "userAgent", "iPhone Safari");
  platform(window, "matchMedia", () => ({ matches: false }));
  await open();
  expect(await screen.findByText(/use Safari to add Lookout to your Home Screen/)).toBeVisible();
  expect(requested).toBe(0);
});
