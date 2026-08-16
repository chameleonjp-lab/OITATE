import { expect, test } from "@playwright/test";

test("root renders visible game UI or explicit bootstrap state", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const app = page.locator("#app");
  await expect(app).toBeVisible();
  await expect(app).not.toBeEmpty();

  const shell = page.locator(".p1-shell");
  const bootStatus = page.locator("[data-boot-status], .boot-status[role='alert']");
  await expect(shell.or(bootStatus)).toBeVisible();

  expect(pageErrors, `unexpected page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});
