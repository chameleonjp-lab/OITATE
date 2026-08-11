import { expect, test, type Page } from "@playwright/test";

type P5State = ReturnType<Window["__OITATE_P5__"]["getState"]>;

async function getP5State(page: Page): Promise<P5State> {
  return page.evaluate(() => window.__OITATE_P5__.getState());
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?p5=1&p5-e2e=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
});

test("shows the P5 integrated slice and its three routeable spaces", async ({ page }) => {
  await expect(page.getByTestId("p5-status")).toBeVisible();
  await expect(page.getByTestId("p5-status")).toContainText("3種類11体");
  await expect(page.getByTestId("p2-status")).toBeHidden();
  await expect(page.getByTestId("p4-status")).toBeHidden();
  await expect(page.locator(".p5-controls")).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute(
    "data-world-entities",
    "player,coward-1..6,follower-1..4,predator,coward-pen,follower-pen,predator-pen,water,bridge",
  );
  const state = await getP5State(page);
  expect(state.animals).toHaveLength(11);
  expect(await page.evaluate(() => typeof window.__OITATE_P5__.e2e)).toBe("object");
});

test("keeps the P5 E2E hook out of the production query", async ({ page }) => {
  await page.goto("/?p5=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => typeof window.__OITATE_P5__.e2e)).toBe("undefined");
});

test("shows the danger warning before the P5 lunge", async ({ page }) => {
  await page.evaluate(() => window.__OITATE_P5__.e2e?.primeAim());
  await expect.poll(async () => (await getP5State(page)).animals.find((animal) => animal.id === "predator-1")?.phase)
    .toBe("aim");
  await expect(page.locator("#p5-status-text")).toContainText("狙っています");
});

test("fires the real guidance button through the P5 production path", async ({ page }) => {
  await page.locator("#p5-guidance-button").click();
  await expect.poll(async () => (await getP5State(page)).lastEvent?.type)
    .toBe("animalStartedFollowing");
  const state = await getP5State(page);
  expect(state.animals.filter((animal) => animal.type === "follower" && animal.phase === "following")).toHaveLength(4);
});

test("records both route discoveries through the production P5 path", async ({ page }) => {
  await page.evaluate(() => window.__OITATE_P5__.e2e?.runRouteDiscovery());
  const state = await getP5State(page);
  expect(state.discoveredRoutes).toEqual({ safe: true, fast: true });
  await expect(page.locator("#p5-route-text")).toContainText("安全な経路 ●");
  await expect(page.locator("#p5-route-text")).toContainText("速い経路 ●");
});

test("replays rescue success through the integrated danger path", async ({ page }) => {
  await page.evaluate(() => window.__OITATE_P5__.e2e?.runRescueSuccess());
  const state = await getP5State(page);
  const victim = state.animals.find((animal) => animal.id === "coward-1");
  expect(state.status).toBe("active");
  expect(victim?.lifeState).toBe("active");
  expect(state.lastEvent?.type).toBe("rescueSucceeded");
});

test("shows a failed result and retries the same integrated slice", async ({ page }) => {
  await page.evaluate(() => window.__OITATE_P5__.e2e?.runRescueFailure());
  await expect(page.locator("#p5-result-overlay")).toBeVisible();
  const failed = await getP5State(page);
  expect(failed.status).toBe("failed");
  expect(failed.failureReason).toBe("rescueTimeout");

  const resetAtClick = await page.locator("#p5-result-overlay button").evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error("P5 retry button missing");
    element.click();
    return window.__OITATE_P5__.getState();
  });
  expect(resetAtClick.status).toBe("active");
  expect(resetAtClick.animals).toHaveLength(11);
  await expect(page.locator("#p5-result-overlay")).toBeHidden();
});

test("shows the provisional result after all three types are captured", async ({ page }) => {
  await page.evaluate(() => window.__OITATE_P5__.e2e?.runCompletionReplay());
  await expect(page.locator("#p5-result-overlay")).toBeVisible();
  const state = await getP5State(page);
  expect(state.status).toBe("completed");
  expect(state.capturedCount).toEqual({ coward: 6, follower: 4, predator: 1 });
  await expect(page.locator("#p5-result-detail")).toContainText("結果は仮表示です");
});
