import { expect, test, type Page } from "@playwright/test";

async function register(page: Page, name: string) {
  const email = `${crypto.randomUUID()}@example.com`;
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("demo-password-123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create a workspace" })).toBeVisible();
  return email;
}

test("owner, operator and monitoring browser complete the access journey", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const operatorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const deviceContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const operator = await operatorContext.newPage();
  const device = await deviceContext.newPage();
  const errors: string[] = [];
  for (const page of [owner, operator, device])
    page.on("pageerror", (error) => errors.push(error.message));
  try {
    await owner.goto("/");
    const email = await register(owner, "Demo owner");
    await owner.getByLabel("Workspace name").fill("Hackathon workspace");
    await owner.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(owner.getByText("No devices paired yet.")).toBeVisible();
    await owner.reload();
    await owner.getByRole("button", { name: "Create invitation" }).click();
    const invitation = await owner.getByLabel("Invitation link").inputValue();
    await operator.goto(invitation);
    await register(operator, "Demo operator");
    await operator.getByRole("button", { name: "Accept invitation" }).click();
    await expect(
      operator.getByText("Signed in as Demo operator. Your role is operator."),
    ).toBeVisible();
    await expect(operator.getByRole("button", { name: "Create invitation" })).toHaveCount(0);
    await operator.screenshot({ path: "test-results/operator-mobile.png", fullPage: true });
    expect(
      await operator.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await device.goto("/monitor");
    await device.getByRole("button", { name: "Generate pairing code" }).click();
    const code = await device.getByRole("status").locator("p").first().innerText();
    await owner.getByLabel("Device name", { exact: true }).fill("Lobby camera");
    await owner.getByLabel("Device pairing code").fill(code);
    await owner.getByRole("button", { name: "Approve device" }).click();
    await expect(device.getByRole("heading", { name: "Monitoring device paired" })).toBeVisible();
    await device.reload();
    await expect(device.getByRole("heading", { name: "Monitoring device paired" })).toBeVisible();
    await owner.getByRole("button", { name: "Sign out", exact: true }).click();
    await device.reload();
    await expect(device.getByRole("heading", { name: "Monitoring device paired" })).toBeVisible();
    await owner.getByLabel("Email", { exact: true }).fill(email);
    await owner.getByLabel("Password", { exact: true }).fill("demo-password-123");
    await owner.getByRole("button", { name: "Sign in", exact: true }).click();
    await owner.getByRole("button", { name: "Revoke Lobby camera" }).click();
    await expect(device.getByRole("alert")).toContainText("Device access revoked", {
      timeout: 10000,
    });
    await device.screenshot({ path: "test-results/device-revoked.png", fullPage: true });
    await device.getByRole("button", { name: "Return to sign in" }).click();
    await expect(device.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
    await owner.getByRole("button", { name: "Remove Demo operator" }).click();
    await operator.reload();
    await expect(operator.getByRole("heading", { name: "Join your team" })).toBeVisible();
    await owner.screenshot({ path: "test-results/owner-workspace.png", fullPage: true });
    const secondTab = await ownerContext.newPage();
    await secondTab.goto("/");
    await expect(secondTab.getByRole("button", { name: "Create invitation" })).toBeVisible();
    await owner.getByLabel("This device’s name").fill("Owner laptop");
    await owner.getByRole("button", { name: "Switch to monitoring mode" }).click();
    await expect(owner.getByRole("heading", { name: "Monitoring device paired" })).toBeVisible();
    await secondTab.reload();
    await expect(
      secondTab.getByRole("heading", { name: "Monitoring device paired" }),
    ).toBeVisible();
    await owner.getByRole("button", { name: "Return to sign in" }).click();
    await expect(owner.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await ownerContext.close();
    await operatorContext.close();
    await deviceContext.close();
  }
});
