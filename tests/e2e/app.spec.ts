import { expect, test } from "@playwright/test";

test("home page renders without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Lookout");
  await expect(page.getByRole("heading", { name: /Be there for the moments/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Be there for the moments/ })).toBeVisible();
  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("unknown URLs return HTTP 404", async ({ request }) => {
  const response = await request.get("/does-not-exist");
  expect(response.status()).toBe(404);
});
