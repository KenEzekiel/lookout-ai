import { expect, test, type Locator } from "@playwright/test";
import type { Member } from "../../apps/app/src/lib/access";
import type { OperatorConfiguration } from "../../apps/app/src/lib/rules";

const actor = {
  kind: "member",
  userId: "button-owner",
  workspaceId: "button-team",
  workspaceName: "Button regression workspace",
  name: "Button operator",
  role: "owner",
} satisfies Member;
const configuration = {
  sources: [],
  rules: [],
  recipients: [{ userId: actor.userId, name: actor.name, role: actor.role }],
} satisfies OperatorConfiguration;

async function expectAction(button: Locator, height: number) {
  await expect(button).toBeVisible();
  await expect(button).toHaveCSS("height", `${height}px`);
  const icon = button.locator("svg");
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute("aria-hidden", "true");
  await expect(icon).toHaveCSS("width", "16px");
  await expect(icon).toHaveCSS("height", "16px");
}

for (const width of [1280, 320]) {
  test(`action sizes and icons stay consistent at ${width}px through reload recovery`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/access/principal", (route) => route.fulfill({ json: actor }));
    await page.route("**/api/access/team", (route) =>
      route.fulfill({
        json: {
          members: [{ userId: actor.userId, name: actor.name, role: actor.role }],
          devices: [{ id: "lobby", name: "Lobby camera", revokedAt: null }],
        },
      }),
    );
    await page.route("**/api/incidents/alerts", (route) =>
      route.fulfill({ json: { incidents: [] } }),
    );
    await page.route("**/api/incidents/inbox", (route) =>
      route.fulfill({ json: { incidents: [] } }),
    );
    await page.route("**/api/push/settings", (route) =>
      route.fulfill({ json: { configured: false, publicKey: null, endpoints: [] } }),
    );
    let reads = 0;
    let completeReload = () => {};
    const reloadCompleted = new Promise<void>((resolve) => {
      completeReload = resolve;
    });
    await page.route("**/api/config/operator", async (route) => {
      reads += 1;
      if (reads === 2) {
        await reloadCompleted;
        await route.fulfill({ status: 503, json: { message: "Configuration unavailable." } });
      } else await route.fulfill({ json: configuration });
    });

    await page.goto("/triggers");
    const create = page.getByRole("button", { name: "New trigger", exact: true });
    const reload = page.getByRole("button", { name: "Reload triggers", exact: true });
    await expect(create).toBeEnabled();
    await expectAction(reload, 40);
    await expectAction(create, 40);
    await expectAction(page.getByRole("button", { name: "Sign out", exact: true }), 36);
    await expectAction(page.getByRole("button", { name: "Enable sound" }), 36);
    await expectAction(page.getByRole("button", { name: "Add source", exact: true }), 40);

    await reload.click();
    const pending = page.getByRole("button", { name: "Reloading triggers…", exact: true });
    try {
      await expect(pending).toBeDisabled();
      await expectAction(pending, 40);
    } finally {
      completeReload();
    }
    await expect(page.getByRole("alert")).toHaveText("Configuration unavailable.");
    await expectAction(reload, 40);
    await reload.click();
    await expect(reload).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expectAction(reload, 40);
    await expectAction(create, 40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );

    await page.getByRole("link", { name: "Devices", exact: true }).click();
    await expectAction(page.getByRole("button", { name: "Live view of Lobby camera" }), 36);
    await expectAction(page.getByRole("button", { name: "Remove access for Lobby camera" }), 36);
    await page.getByRole("button", { name: "Add device", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expectAction(dialog.getByRole("button", { name: "Connect device", exact: true }), 40);
    await expectAction(dialog.getByRole("button", { name: "Cancel", exact: true }), 40);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.getByRole("link", { name: "Incidents", exact: true }).click();
    await expectAction(page.getByRole("button", { name: "Reload inbox", exact: true }), 40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    expect(errors).toEqual([]);
  });
}
