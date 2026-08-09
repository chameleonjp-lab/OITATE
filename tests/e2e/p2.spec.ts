import { expect, test, type Page } from "@playwright/test";

type P2State = ReturnType<Window["__OITATE_P1__"]["getState"]>["p2"];

async function getP1State(page: Page) {
  return page.evaluate(() => window.__OITATE_P1__.getState());
}

async function getP2State(page: Page): Promise<P2State> {
  return (await getP1State(page)).p2;
}

function observableP2State(state: P2State) {
  return {
    capturedCount: state.capturedCount,
    penReservedAnimalId: state.penReservedAnimalId,
    animals: state.animals.map((animal) => ({
      id: animal.id,
      phase: animal.phase,
      x: animal.x,
      z: animal.z,
    })),
  };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
});

test("keeps the normal screen focused on P2 and makes P1 signals inert", async ({ page }) => {
  await expect(page.locator(".p1-eyebrow")).toBeHidden();
  await expect(page.locator(".p2-eyebrow")).toBeVisible();
  await expect(page.getByTestId("p2-status")).toContainText("動物の反応を観察する");
  await expect(page.locator(".signal-controls")).toBeHidden();
  await expect(page.getByTestId("diagnostics")).toBeHidden();
  await expect(page.locator("#app")).toHaveAttribute(
    "data-p2-world-entities",
    "player,coward-1,coward-2,coward-3,pen",
  );
  expect(await page.evaluate(() => typeof window.__OITATE_P2__?.e2e)).toBe("undefined");

  const before = await getP1State(page);
  await page.keyboard.press("KeyQ");
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(120);
  const after = await getP1State(page);

  expect(after.signalFireCount).toBe(before.signalFireCount);
  expect(observableP2State(after.p2)).toEqual(observableP2State(before.p2));
  await expect(page.locator("#signal-feedback")).toHaveText("");
});

test("keeps the P1 input probe behind an explicit development query", async ({ page }) => {
  await page.goto("/?p1-probe=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".p1-eyebrow")).toBeVisible();
  await expect(page.locator(".p2-eyebrow")).toBeVisible();
  await expect(page.locator(".signal-controls")).toBeVisible();
  await expect(page.locator(".signal-controls")).toContainText("P1入力回帰");

  const before = await getP1State(page);
  await page.keyboard.press("KeyQ");
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(120);
  const after = await getP1State(page);
  expect(after.signalFireCount).toBe(before.signalFireCount + 2);
  expect(observableP2State(after.p2)).toEqual(observableP2State(before.p2));
  await expect(page.locator("#signal-feedback")).toContainText("P2では動物に効果なし");
});

test("shows a readable anticipating phase before a coward flees", async ({ page }) => {
  const before = await getP2State(page);
  const middleBefore = before.animals.find((animal) => animal.id === "coward-2");
  expect(middleBefore).toBeTruthy();

  await page.keyboard.down("KeyW");
  try {
    await expect.poll(async () => {
      const state = await getP2State(page);
      return state.animals.find((animal) => animal.id === "coward-2")?.phase;
    }, { timeout: 1_800, intervals: [20, 40, 80] }).toBe("anticipating");
    await expect(page.locator("#p2-status-text")).toHaveText("動物がこちらを見ています");

    await expect.poll(async () => {
      const state = await getP2State(page);
      const middle = state.animals.find((animal) => animal.id === "coward-2");
      return Boolean(
        middle
        && ["fleeing", "enteringPen", "captured"].includes(middle.phase)
        && middle.z < (middleBefore?.z ?? Number.POSITIVE_INFINITY) - 0.01,
      );
    }, { timeout: 1_800, intervals: [20, 40, 80] }).toBe(true);
  } finally {
    await page.keyboard.up("KeyW");
  }
  const after = await getP2State(page);
  expect(after.decisionUpdates).toBeGreaterThan(0);
  const middleAfter = after.animals.find((animal) => animal.id === "coward-2");
  expect(middleAfter).toBeTruthy();
  expect(["fleeing", "enteringPen", "captured"]).toContain(middleAfter?.phase);
  expect(middleAfter?.z).toBeLessThan(middleBefore?.z ?? Number.POSITIVE_INFINITY);
});

test("replays completion through the P2-only hook and retries to a clean state", async ({ page }) => {
  await page.goto("/?p2-e2e=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => typeof window.__OITATE_P2__?.e2e)).toBe("object");
  const initial = await getP1State(page);
  const initialAnimalPositions = initial.p2.animals.map((animal) => ({
    id: animal.id,
    x: animal.x,
    z: animal.z,
  }));

  await page.evaluate(() => window.__OITATE_P2__?.e2e?.runCompletionReplay());
  await expect(page.locator("#p2-complete-overlay")).toBeVisible();
  const completed = await getP1State(page);
  expect(completed.p2.capturedCount).toBe(3);
  expect(completed.p2.completed).toBe(true);
  expect(completed.p2.penReservedAnimalId).toBeNull();
  expect(completed.p2.decisionUpdates).toBeGreaterThan(0);
  expect(completed.p2.animals.every((animal) => animal.phase === "captured")).toBe(true);
  expect(completed.p2.animals.every((animal) => animal.fullBodyInside)).toBe(true);

  await page.getByRole("button", { name: "もう一度試す" }).click();
  await expect(page.locator("#p2-complete-overlay")).toBeHidden();
  await expect(page.locator("#p2-count-text")).toHaveText("収容 0 / 3");
  const reset = await getP1State(page);
  expect(reset.player).toEqual({ x: 0, z: 4.5, speed: 0 });
  expect(reset.p2.animals.map((animal) => ({ id: animal.id, x: animal.x, z: animal.z })))
    .toEqual(initialAnimalPositions);
  expect(reset.p2.capturedCount).toBe(0);
  expect(reset.p2.completed).toBe(false);
  expect(reset.p2.penReservedAnimalId).toBeNull();
  expect(reset.p2.decisionUpdates).toBe(0);
  expect(reset.p2.animals.every((animal) => animal.phase === "idle")).toBe(true);
  expect(reset.p2.animals.every((animal) => !animal.fullBodyInside)).toBe(true);
});

test("keeps a single entrance reservation when three candidates arrive together", async ({ page }) => {
  await page.goto("/?p2-e2e=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");

  const probe = await page.evaluate(() => {
    const hook = window.__OITATE_P2__?.e2e;
    if (!hook) throw new Error("P2 E2E hook is not available");
    return hook.probeEntranceReservation();
  });
  expect(probe.decisionStepSeconds).toBe(0.05);
  expect(probe.initialCandidates).toHaveLength(3);
  expect(probe.initialCandidates.every((candidate) =>
    Math.abs(candidate.x) < probe.entranceClearance
      && candidate.z > probe.outerFaceZ
      && candidate.z - probe.outerFaceZ < 0.05,
  )).toBe(true);
  expect(probe.initialCandidates.map((candidate) => candidate.id))
    .toEqual(["coward-1", "coward-2", "coward-3"]);
  expect(probe.firstStepReservedAnimalId).toBeTruthy();
  const firstStepOwner = probe.firstStepAnimals.find(
    (animal) => animal.id === probe.firstStepReservedAnimalId,
  );
  expect(firstStepOwner).toBeTruthy();
  expect(firstStepOwner?.z).toBeLessThan(probe.outerFaceZ);
  const firstStepFollowers = probe.firstStepAnimals.filter(
    (animal) => animal.id !== probe.firstStepReservedAnimalId,
  );
  expect(firstStepFollowers).toHaveLength(2);
  expect(firstStepFollowers.every((animal) =>
    animal.phase !== "enteringPen" && animal.z >= probe.outerFaceZ,
  )).toBe(true);
  expect(probe.reservedAnimalId).toBeTruthy();
  expect(probe.reservedAnimalId).toBe(probe.firstStepReservedAnimalId);
  expect(probe.enteringAnimalIds).toEqual([probe.reservedAnimalId]);
  expect(probe.capturedCount).toBe(0);

  const state = await getP2State(page);
  expect(state.penReservedAnimalId).toBe(probe.reservedAnimalId);
  expect(state.animals.filter((animal) => animal.phase === "enteringPen")).toHaveLength(1);
  const followers = state.animals.filter((animal) => animal.id !== probe.reservedAnimalId);
  expect(followers).toHaveLength(2);
  expect(followers.every((animal) =>
    animal.phase !== "captured" && animal.z > probe.outerFaceZ,
  )).toBe(true);
});
