import { expect, test, type Page } from "@playwright/test";

type P6State = ReturnType<Window["__OITATE_P6__"]["getState"]>;

async function getP6State(page: Page): Promise<P6State> {
  return page.evaluate(() => window.__OITATE_P6__.getState());
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?p6=1&p6-e2e=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
});

test("shows the P6 first explanation and keeps the game paused until it starts", async ({ page }) => {
  await expect(page.getByTestId("p6-status")).toBeVisible();
  await expect(page.locator("#p6-intro-overlay")).toBeVisible();
  const before = await getP6State(page);
  expect(before.introVisible).toBe(true);
  expect(before.status).toBe("active");
  await page.locator("[data-action='p6-start']").click();
  await expect(page.locator("#p6-intro-overlay")).toBeHidden();
  await expect(page.locator("#p6-settings-button")).toBeVisible();
  expect((await getP6State(page)).introVisible).toBe(false);
});

test("opens settings and keeps assisted records separate", async ({ page }) => {
  await page.locator("[data-action='p6-start']").click();
  await page.locator("#p6-settings-button").click();
  await expect(page.locator("#p6-settings-overlay")).toBeVisible();
  await page.locator("#p6-assist-toggle").check();
  await page.locator("[data-action='p6-settings-close']").click();
  expect((await getP6State(page)).settings.assistedMode).toBe(true);
  await expect(page.locator("#p6-time-text")).toContainText("補助あり");
});

test("shows the scored result and retries through the production P5 path", async ({ page }) => {
  await page.locator("[data-action='p6-start']").click();
  await page.evaluate(() => window.__OITATE_P6__.e2e?.runCompletionReplay());
  await expect(page.locator("#p6-result-overlay")).toBeVisible();
  const state = await getP6State(page);
  expect(state.status).toBe("completed");
  expect(state.result?.totalScore).toBeGreaterThan(0);
  await expect(page.locator("#p6-result-score")).toContainText("点");
  await expect(page.locator("#p6-result-advice")).toContainText("次回の助言");
  await page.locator("[data-action='p6-retry']").click();
  await expect(page.locator("#p6-result-overlay")).toBeHidden();
  expect((await getP6State(page)).status).toBe("active");
});

test("does not expose the P6 E2E hook on a production query", async ({ page }) => {
  await page.goto("/?p6=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => typeof window.__OITATE_P6__.e2e)).toBe("undefined");
});
