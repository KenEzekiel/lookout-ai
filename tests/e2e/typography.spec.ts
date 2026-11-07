import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`shared typography stays consistent through workspace and capture at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill("Typography owner");
    await page.getByLabel("Email", { exact: true }).fill(`${crypto.randomUUID()}@example.com`);
    await page.getByLabel("Password", { exact: true }).fill("demo-password-123");
    await expect(page.getByLabel("Email", { exact: true })).toHaveCSS(
      "font-size",
      width < 640 ? "16px" : "15px",
    );
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByLabel("Workspace name").fill("Typography workspace");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();

    for (const name of ["Devices", "Team", "Incidents", "Triggers"]) {
      await page.getByRole("link", { name, exact: true }).click();
      const heading = page.getByRole("heading", {
        name: name === "Incidents" ? "Incident inbox" : name,
        exact: true,
      });
      await expect(heading).toHaveCSS("font-size", "30px");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(heading).toHaveCSS("font-weight", "600");
      await expect(heading).toHaveCSS("line-height", "36px");
      await expect(heading.locator("+ p")).toHaveCSS("font-size", "15px");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }

    await page.getByRole("button", { name: "New trigger", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "New trigger" })).toHaveCSS(
      "font-size",
      "20px",
    );
    await expect(page.getByRole("dialog").getByRole("heading", { name: "New trigger" })).toHaveCSS(
      "line-height",
      "26px",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New trigger", exact: true })).toBeFocused();

    await page.getByRole("link", { name: "Devices", exact: true }).click();
    await page.getByRole("button", { name: "Use this device instead" }).click();
    await page.getByLabel("Device name").fill("Typography camera");
    await page.getByRole("button", { name: "Sign out and set up device" }).click();
    await page.getByRole("link", { name: "Open capture station" }).click();
    const captureTitle = page.getByRole("heading", { name: "Capture station" });
    await expect(captureTitle).toHaveCSS("font-size", "30px");
    await expect(captureTitle).toHaveCSS("line-height", "36px");
    await expect(page.getByRole("heading", { name: "Capture controls" })).toHaveCSS(
      "font-size",
      "20px",
    );
    await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveCSS(
      "font-size",
      "15px",
    );
    await expect(page.getByText("Samples retained", { exact: true })).toHaveCSS(
      "font-size",
      "13px",
    );
    await expect(captureTitle).toHaveCSS("font-family", /Geist Variable/);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}
