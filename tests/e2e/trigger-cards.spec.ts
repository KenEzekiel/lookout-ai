import { expect, test } from "@playwright/test";
import type { OperatorConfiguration } from "../../apps/app/src/lib/rules";

test("trigger cards align with unequal descriptions and stack on mobile", async ({ page }) => {
  const configuration = {
    sources: [{ id: "camera", name: "Test", kind: "camera" }],
    recipients: [{ userId: "owner", name: "Arsa", role: "owner" }],
    rules: ["Glass Show Up", "Friend Detected"].map((name, index) => ({
      id: String(index),
      sourceId: "camera",
      version: 1,
      enabled: true,
      definition: {
        name,
        condition: {
          kind: "custom" as const,
          text: index === 0 ? "A glass showing up" : "A person using glasses with brown shirt",
          exclusions: index === 0 ? undefined : "If the person thumbs up",
        },
        severity: "critical" as const,
        durationSeconds: null,
        escalationLevels: [{ recipientIds: ["owner"], acknowledgmentTimeoutSeconds: null }],
      },
    })),
  } satisfies OperatorConfiguration;
  await page.route("**/api/access/principal", (route) =>
    route.fulfill({
      json: {
        kind: "member",
        userId: "owner",
        name: "Arsa",
        workspaceId: "workspace",
        workspaceName: "Card layout",
        role: "owner",
      },
    }),
  );
  await page.route("**/api/incidents/alerts", (route) =>
    route.fulfill({ json: { incidents: [] } }),
  );
  await page.route("**/api/push/settings", (route) =>
    route.fulfill({ json: { configured: false, publicKey: null, endpoints: [] } }),
  );
  await page.route("**/api/config/operator", (route) => route.fulfill({ json: configuration }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/triggers");
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  const bounds = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const card = element.getBoundingClientRect();
      const action = element.querySelector("button")!.getBoundingClientRect();
      return { top: card.top, bottom: card.bottom, actionTop: action.top };
    }),
  );
  expect(bounds[0]).toEqual(bounds[1]);
  await page.getByRole("button", { name: "Edit Glass Show Up", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Edit Glass Show Up", exact: true })).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    }),
  );
  expect(mobile[1]!.top).toBeGreaterThan(mobile[0]!.bottom);
  expect(mobile[1]!.height).toBeGreaterThan(mobile[0]!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
