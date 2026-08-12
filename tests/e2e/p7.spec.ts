import { expect, test, type Page } from "@playwright/test";

type P7State = ReturnType<Window["__OITATE_P7__"]["getState"]>;

async function getP7State(page: Page): Promise<P7State> {
  return page.evaluate(() => window.__OITATE_P7__.getState());
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?p7=1&p7-e2e=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
});

test("opens with a saved-progress stage menu and six content stages", async ({ page }) => {
  await expect(page.getByTestId("p7-status")).toBeVisible();
  await expect(page.locator("#p7-stage-menu-overlay")).toBeVisible();
  await expect(page.locator("#p7-stage-list [data-p7-stage]")).toHaveCount(7);
  const state = await getP7State(page);
  expect(state.menuVisible).toBe(true);
  expect(state.progress.unlockedStageIds).toEqual([0, 1]);
  await expect(page.locator("#p7-stage-list [data-p7-stage='2']")).toBeDisabled();
});

test("starts a selected stage and shows its central concept", async ({ page }) => {
  await page.locator("#p7-stage-list [data-p7-stage='1']").click();
  await expect(page.locator("#p7-stage-menu-overlay")).toBeHidden();
  await expect(page.locator("#p7-stage-center")).toContainText("接近圧力");
  const state = await getP7State(page);
  expect(state.stageId).toBe(1);
  expect(state.status).toBe("active");
});

test("records a completed stage and unlocks the next stage", async ({ page }) => {
  await page.locator("#p7-stage-list [data-p7-stage='1']").click();
  await page.evaluate(() => window.__OITATE_P7__.e2e?.runCompletionReplay());
  await expect(page.locator("#p7-result-overlay")).toBeVisible();
  const state = await getP7State(page);
  expect(state.status).toBe("completed");
  expect(state.result?.stageId).toBe(1);
  expect(state.progress.completedStageIds).toContain(1);
  expect(state.progress.unlockedStageIds).toContain(2);
  await page.locator("[data-action='p7-select-stage']").click();
  await expect(page.locator("#p7-stage-menu-overlay")).toBeVisible();
  await expect(page.locator("#p7-stage-list [data-p7-stage='2']")).toBeEnabled();
});

test("progresses through all six content stages and keeps the fourth animal gated", async ({ page }) => {
  await page.locator("#p7-stage-list [data-p7-stage='1']").click();
  for (let stageId = 1; stageId <= 6; stageId += 1) {
    await page.evaluate(() => window.__OITATE_P7__.e2e?.runCompletionReplay());
    await expect(page.locator("#p7-result-overlay")).toBeVisible();
    const state = await getP7State(page);
    expect(state.status).toBe("completed");
    expect(state.progress.completedStageIds).toContain(stageId);
    if (stageId < 6) {
      await page.locator("[data-action='p7-select-stage']").click();
      await expect(page.locator("#p7-stage-menu-overlay")).toBeVisible();
      await expect(page.locator(`#p7-stage-list [data-p7-stage='${stageId + 1}']`)).toBeEnabled();
      await page.locator(`#p7-stage-list [data-p7-stage='${stageId + 1}']`).click();
    }
  }
  await page.locator("[data-action='p7-select-stage']").click();
  await expect(page.locator("#p7-fourth-gate")).toContainText("検証候補");
});

test("does not expose the P7 E2E hook on a production query", async ({ page }) => {
  await page.goto("/?p7=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => typeof window.__OITATE_P7__.e2e)).toBe("undefined");
});
