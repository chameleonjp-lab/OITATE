import { expect, test, type Page } from "@playwright/test";

type P4State = ReturnType<Window["__OITATE_P4__"]["getState"]>;

async function getP4State(page: Page): Promise<P4State> {
  return page.evaluate(() => window.__OITATE_P4__.getState());
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?p4=1&p4-e2e=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
});

test("shows the P4 danger slice and hides the P3 controls", async ({ page }) => {
  await expect(page.getByTestId("p4-status")).toBeVisible();
  await expect(page.getByTestId("p4-status")).toContainText("危険種を専用囲いへ");
  await expect(page.getByTestId("p2-status")).toBeHidden();
  await expect(page.locator(".p4-controls")).toBeVisible();
  await expect(page.locator(".signal-controls")).toBeHidden();
  await expect(page.locator("#app")).toHaveAttribute(
    "data-world-entities",
    "player,predator,victim,predator-pen",
  );
  expect(await page.evaluate(() => typeof window.__OITATE_P4__.e2e)).toBe("object");
});

test("keeps the P4 E2E hook out of the production query", async ({ page }) => {
  await page.goto("/?p4=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => typeof window.__OITATE_P4__.e2e)).toBe("undefined");
});

test("shows the attack warning before a lunge", async ({ page }) => {
  await page.evaluate(() => window.__OITATE_P4__.e2e?.primeAim());
  await expect.poll(async () => (await getP4State(page)).predator.attackPhase)
    .toBe("aim");
  await expect(page.locator("#p4-status-text")).toContainText("狙いを始めました");
  await expect(page.locator("#p4-phase-text")).toContainText("威嚇音");
});

test("fires the real threat button and makes the predator chase the player", async ({ page }) => {
  await page.locator("#p4-threat-button").click();
  await expect.poll(async () => (await getP4State(page)).lastEvent?.type)
    .toBe("threatAccepted");
  const state = await getP4State(page);
  expect(state.predator.intent).toBe("chasePlayer");
  expect(state.predator.threatSeconds).toBeGreaterThan(0);
});

test("replays a rescue success through the production P4 path", async ({ page }) => {
  await page.evaluate(() => window.__OITATE_P4__.e2e?.runRescueSuccess());
  const state = await getP4State(page);
  expect(state.status).toBe("active");
  expect(state.victim.lifeState).toBe("active");
  expect(state.victim.rescueCount).toBe(1);
  expect(state.lastEvent?.type).toBe("rescueSucceeded");
  await expect(page.locator("#p4-status-text")).toContainText("危険種が主人公を追っています");
});

test("replays rescue failure and retry through the real result button", async ({ page }) => {
  await page.evaluate(() => window.__OITATE_P4__.e2e?.runRescueFailure());
  await expect(page.locator("#p4-result-overlay")).toBeVisible();
  const failed = await getP4State(page);
  expect(failed.status).toBe("failed");
  expect(failed.failureReason).toBe("rescueTimeout");

  const resetAtClick = await page.locator("#p4-result-overlay button").evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error("P4 retry button missing");
    element.click();
    return window.__OITATE_P4__.getState();
  });
  expect(resetAtClick.status).toBe("active");
  expect(resetAtClick.victim.lifeState).toBe("active");
  expect(resetAtClick.predator.attackPhase).toBe("search");
  await expect(page.locator("#p4-result-overlay")).toBeHidden();
});

test("captures the predator only after the player leaves the pen", async ({ page }) => {
  await page.evaluate(() => window.__OITATE_P4__.e2e?.runCaptureReplay());
  await expect(page.locator("#p4-result-overlay")).toBeVisible();
  const state = await getP4State(page);
  expect(state.status).toBe("completed");
  expect(state.predator.insidePen).toBe(true);
  expect(state.predator.attackPhase).toBe("disabled");
  expect(state.lastEvent?.type).toBe("predatorCaptured");
});
