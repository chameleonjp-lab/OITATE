import { expect, test, type Page } from "@playwright/test";

interface Point {
  x: number;
  y: number;
}

interface HeldInputPoints {
  movementOrigin: Point;
  movementActive: Point;
  cameraOrigin: Point;
  cameraActive: Point;
  signalCenter: Point;
}

async function pointer(
  page: Page,
  selector: string,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "lostpointercapture",
  pointerId: number,
  point: Point,
): Promise<void> {
  await page.locator(selector).dispatchEvent(type, {
    pointerId,
    pointerType: "touch",
    button: 0,
    buttons: type === "pointerup" || type === "pointercancel" || type === "lostpointercapture" ? 0 : 1,
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    cancelable: true,
  });
}

async function armHeldInputs(
  page: Page,
  ids: { movement: number; camera: number; signal: number },
): Promise<HeldInputPoints> {
  const moveBox = await page.getByTestId("joystick-zone").boundingBox();
  const cameraBox = await page.getByTestId("camera-zone").boundingBox();
  const signalBox = await page.locator("button[data-signal='guidance']").boundingBox();
  if (!moveBox || !cameraBox || !signalBox) {
    throw new Error("P1 controls are not measurable");
  }

  const points: HeldInputPoints = {
    movementOrigin: {
      x: moveBox.x + 130,
      y: moveBox.y + moveBox.height * 0.72,
    },
    movementActive: {
      x: moveBox.x + 130,
      y: moveBox.y + moveBox.height * 0.72 - 86,
    },
    cameraOrigin: {
      x: cameraBox.x + cameraBox.width * 0.45,
      y: cameraBox.y + 100,
    },
    cameraActive: {
      x: cameraBox.x + cameraBox.width * 0.45 + 130,
      y: cameraBox.y + 100,
    },
    signalCenter: {
      x: signalBox.x + signalBox.width / 2,
      y: signalBox.y + signalBox.height / 2,
    },
  };

  await pointer(page, ".joystick-zone", "pointerdown", ids.movement, points.movementOrigin);
  await pointer(page, ".joystick-zone", "pointermove", ids.movement, points.movementActive);
  await pointer(page, ".camera-zone", "pointerdown", ids.camera, points.cameraOrigin);
  await pointer(page, ".camera-zone", "pointermove", ids.camera, points.cameraActive);
  await pointer(
    page,
    "button[data-signal='guidance']",
    "pointerdown",
    ids.signal,
    points.signalCenter,
  );
  return points;
}

async function getState(page: Page): Promise<ReturnType<Window["__OITATE_P1__"]["getState"]>> {
  return page.evaluate(() => window.__OITATE_P1__.getState());
}

async function setVisibility(page: Page, state: "hidden" | "visible"): Promise<void> {
  await page.evaluate((nextState) => {
    Object.defineProperties(document, {
      visibilityState: { configurable: true, value: nextState },
      hidden: { configurable: true, value: nextState === "hidden" },
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?p1-probe=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
});

test("renders the flat P1 world without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await expect(page.locator("canvas.game-canvas")).toBeVisible();
  await expect(page.getByText("P1 操作試作")).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("data-world-entities", "player,animal");
  await expect(page.getByTestId("diagnostics")).toContainText("診断");
  const viewport = await page.locator("meta[name='viewport']").getAttribute("content");
  expect(viewport).not.toContain("user-scalable=no");
  expect(errors).toEqual([]);
});

test("keyboard movement changes the player position", async ({ page }) => {
  const before = await page.evaluate(() => window.__OITATE_P1__.getState().player.z);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(450);
  await page.keyboard.up("KeyW");
  const after = await page.evaluate(() => window.__OITATE_P1__.getState().player.z);
  expect(after).toBeLessThan(before - 0.2);
});

test("dynamic joystick drives touch movement", async ({ page }) => {
  const zone = await page.getByTestId("joystick-zone").boundingBox();
  if (!zone) throw new Error("Joystick zone is not measurable");
  const origin = { x: zone.x + 130, y: zone.y + zone.height * 0.72 };
  const before = await page.evaluate(() => window.__OITATE_P1__.getState().player.z);
  await pointer(page, ".joystick-zone", "pointerdown", 61, origin);
  await pointer(page, ".joystick-zone", "pointermove", 61, {
    x: origin.x,
    y: origin.y - 86,
  });
  await page.waitForTimeout(500);
  await pointer(page, ".joystick-zone", "pointerup", 61, {
    x: origin.x,
    y: origin.y - 86,
  });
  const after = await page.evaluate(() => window.__OITATE_P1__.getState().player.z);
  expect(after).toBeLessThan(before - 0.2);
});

test("manual camera heading becomes the next movement basis", async ({ page }) => {
  const zone = await page.getByTestId("camera-zone").boundingBox();
  if (!zone) throw new Error("Camera zone is not measurable");
  const origin = { x: zone.x + zone.width * 0.45, y: zone.y + 100 };
  await pointer(page, ".camera-zone", "pointerdown", 71, origin);
  await pointer(page, ".camera-zone", "pointermove", 71, {
    x: origin.x + 150,
    y: origin.y,
  });
  await pointer(page, ".camera-zone", "pointerup", 71, {
    x: origin.x + 150,
    y: origin.y,
  });
  const before = await page.evaluate(() => window.__OITATE_P1__.getState().player.x);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(500);
  await page.keyboard.up("KeyW");
  const state = await page.evaluate(() => window.__OITATE_P1__.getState());
  expect(Math.abs(state.cameraYaw)).toBeGreaterThan(0.5);
  expect(Math.abs(state.player.x - before)).toBeGreaterThan(0.2);
});

test("keeps movement, camera, and signal on separate pointer owners", async ({ page }) => {
  const moveBox = await page.getByTestId("joystick-zone").boundingBox();
  const cameraBox = await page.getByTestId("camera-zone").boundingBox();
  const signalBox = await page.locator("button[data-signal='guidance']").boundingBox();
  if (!moveBox || !cameraBox || !signalBox) throw new Error("P1 controls are not measurable");

  await pointer(page, ".joystick-zone", "pointerdown", 11, {
    x: moveBox.x + 120,
    y: moveBox.y + moveBox.height * 0.65,
  });
  await pointer(page, ".camera-zone", "pointerdown", 12, {
    x: cameraBox.x + cameraBox.width * 0.55,
    y: cameraBox.y + 90,
  });
  await pointer(page, "button[data-signal='guidance']", "pointerdown", 13, {
    x: signalBox.x + signalBox.width / 2,
    y: signalBox.y + signalBox.height / 2,
  });

  const owners = await page.evaluate(() => window.__OITATE_P1__.getState().owners);
  expect(owners).toEqual({ movement: 11, camera: 12, guidance: 13, threat: null });

  await pointer(page, ".camera-zone", "pointermove", 12, {
    x: signalBox.x + signalBox.width / 2,
    y: signalBox.y + signalBox.height / 2,
  });
  expect(await page.locator("button[data-signal='guidance']").getAttribute("data-fire-count")).toBe("0");

  await pointer(page, "button[data-signal='guidance']", "pointerup", 13, {
    x: signalBox.x + signalBox.width / 2,
    y: signalBox.y + signalBox.height / 2,
  });
  await pointer(page, ".joystick-zone", "pointerup", 11, {
    x: moveBox.x + 120,
    y: moveBox.y + 90,
  });
  await pointer(page, ".joystick-zone", "lostpointercapture", 11, {
    x: moveBox.x + 120,
    y: moveBox.y + 90,
  });
  const cameraStillOwned = await page.evaluate(() => window.__OITATE_P1__.getState().owners);
  expect(cameraStillOwned.camera).toBe(12);

  await pointer(page, "button[data-signal='guidance']", "pointerup", 12, {
    x: signalBox.x + signalBox.width / 2,
    y: signalBox.y + signalBox.height / 2,
  });
  expect(await page.locator("button[data-signal='guidance']").getAttribute("data-fire-count")).toBe("1");
  const cleared = await page.evaluate(() => window.__OITATE_P1__.getState().owners);
  expect(cleared).toEqual({ movement: null, camera: null, guidance: null, threat: null });
});

test("simultaneously progresses movement, camera, and signal input", async ({ page }) => {
  const ids = { movement: 101, camera: 102, signal: 103 };
  const before = await getState(page);
  const points = await armHeldInputs(page, ids);

  await page.waitForTimeout(450);
  await pointer(
    page,
    "button[data-signal='guidance']",
    "pointerup",
    ids.signal,
    points.signalCenter,
  );
  const afterSignal = await getState(page);

  expect(Math.hypot(
    afterSignal.player.x - before.player.x,
    afterSignal.player.z - before.player.z,
  )).toBeGreaterThan(0.2);
  expect(Math.abs(afterSignal.cameraYaw - before.cameraYaw)).toBeGreaterThan(0.2);
  expect(afterSignal.cameraInteractionSeconds).toBeGreaterThan(0.1);
  expect(afterSignal.signalFireCount).toBe(1);
  expect(afterSignal.owners).toEqual({
    movement: ids.movement,
    camera: ids.camera,
    guidance: null,
    threat: null,
  });

  await pointer(page, ".joystick-zone", "pointerup", ids.movement, points.movementActive);
  await pointer(page, ".camera-zone", "pointerup", ids.camera, points.cameraActive);
});

test("active lostpointercapture clears every pointer owner and stops movement", async ({ page }) => {
  const ids = { movement: 111, camera: 112, signal: 113 };
  const points = await armHeldInputs(page, ids);
  await page.waitForTimeout(280);
  const beforeClear = await getState(page);
  expect(beforeClear.owners).toEqual({
    movement: ids.movement,
    camera: ids.camera,
    guidance: ids.signal,
    threat: null,
  });

  await pointer(page, ".joystick-zone", "lostpointercapture", ids.movement, points.movementActive);
  const cleared = await getState(page);
  expect(cleared.owners).toEqual({ movement: null, camera: null, guidance: null, threat: null });
  expect(cleared.cancellationReason).toBe("lostpointercapture");
  expect(cleared.signalFireCount).toBe(0);
  await expect(page.locator("button[data-signal='guidance']")).toHaveAttribute(
    "data-signal-state",
    "idle",
  );

  await pointer(page, "button[data-signal='guidance']", "pointerup", ids.signal, points.signalCenter);
  await page.waitForTimeout(350);
  const afterClear = await getState(page);
  expect(Math.hypot(
    afterClear.player.x - cleared.player.x,
    afterClear.player.z - cleared.player.z,
  )).toBeLessThan(0.04);
  expect(afterClear.signalFireCount).toBe(0);
});

test("active pointercancel clears every pointer owner and stops movement", async ({ page }) => {
  const ids = { movement: 121, camera: 122, signal: 123 };
  const points = await armHeldInputs(page, ids);
  await page.waitForTimeout(280);
  const beforeClear = await getState(page);
  expect(beforeClear.owners.movement).toBe(ids.movement);
  expect(beforeClear.owners.camera).toBe(ids.camera);
  expect(beforeClear.owners.guidance).toBe(ids.signal);

  await pointer(page, ".camera-zone", "pointercancel", ids.camera, points.cameraActive);
  const cleared = await getState(page);
  expect(cleared.owners).toEqual({ movement: null, camera: null, guidance: null, threat: null });
  expect(cleared.cancellationReason).toBe("pointercancel");
  expect(cleared.signalFireCount).toBe(0);

  await pointer(page, "button[data-signal='guidance']", "pointerup", ids.signal, points.signalCenter);
  await page.waitForTimeout(350);
  const afterClear = await getState(page);
  expect(Math.hypot(
    afterClear.player.x - cleared.player.x,
    afterClear.player.z - cleared.player.z,
  )).toBeLessThan(0.04);
  expect(afterClear.signalFireCount).toBe(0);
});

test("fires a signal on release and cancels it after sliding out", async ({ page }) => {
  const signal = page.locator("button[data-signal='threat']");
  const box = await signal.boundingBox();
  if (!box) throw new Error("Threat button is not measurable");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await pointer(page, "button[data-signal='threat']", "pointerdown", 41, center);
  await pointer(page, "button[data-signal='threat']", "pointerup", 41, center);
  await expect(signal).toHaveAttribute("data-fire-count", "1");
  await expect(page.locator("#signal-feedback")).toContainText("威嚇入力");

  await pointer(page, "button[data-signal='threat']", "pointerdown", 42, center);
  await pointer(page, "button[data-signal='threat']", "pointermove", 42, {
    x: box.x - 120,
    y: box.y - 120,
  });
  await pointer(page, "button[data-signal='threat']", "pointerup", 42, {
    x: box.x - 120,
    y: box.y - 120,
  });
  await expect(signal).toHaveAttribute("data-fire-count", "1");
});

test("pauses in portrait, clears held pointers, and requires an explicit resume", async ({ page }) => {
  const ids = { movement: 131, camera: 132, signal: 133 };
  await armHeldInputs(page, ids);
  await page.waitForTimeout(280);
  const beforeRotation = await getState(page);
  expect(beforeRotation.owners).toEqual({
    movement: ids.movement,
    camera: ids.camera,
    guidance: ids.signal,
    threat: null,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#orientation-overlay")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "端末を横向きにしてください" }),
  ).toBeFocused();
  expect(
    await page.locator("#interaction-layer").evaluate(
      (element) => element instanceof HTMLElement && element.inert,
    ),
  ).toBe(true);
  const portraitState = await getState(page);
  expect(portraitState.paused).toBe(true);
  expect(portraitState.owners).toEqual({ movement: null, camera: null, guidance: null, threat: null });
  expect(portraitState.cancellationReason).toBe("orientation");
  expect(portraitState.signalFireCount).toBe(0);
  await expect(page.locator("button[data-signal='guidance']")).toHaveAttribute(
    "data-signal-state",
    "idle",
  );
  await page.waitForTimeout(300);
  const stillPortrait = await getState(page);
  expect(Math.hypot(
    stillPortrait.player.x - portraitState.player.x,
    stillPortrait.player.z - portraitState.player.z,
  )).toBeLessThan(0.04);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("#resume-overlay")).toBeVisible();
  const resumeButton = page.getByRole("button", { name: "再開する" });
  await expect(resumeButton).toBeFocused();
  await resumeButton.click();
  await expect(page.locator("#resume-overlay")).toBeHidden();
  expect(
    await page.locator("#interaction-layer").evaluate(
      (element) => element instanceof HTMLElement && element.inert,
    ),
  ).toBe(false);
  const state = await getState(page);
  expect(state.paused).toBe(false);
  expect(state.owners).toEqual({ movement: null, camera: null, guidance: null, threat: null });
});

test("synthetic visibility changes clear held input and require an explicit resume", async ({ page }) => {
  const ids = { movement: 141, camera: 142, signal: 143 };
  const points = await armHeldInputs(page, ids);
  await page.waitForTimeout(220);

  await setVisibility(page, "hidden");
  const hidden = await getState(page);
  expect(hidden.paused).toBe(true);
  expect(hidden.owners).toEqual({ movement: null, camera: null, guidance: null, threat: null });
  expect(hidden.cancellationReason).toBe("visibility");
  expect(hidden.signalFireCount).toBe(0);

  await page.waitForTimeout(300);
  const stillHidden = await getState(page);
  expect(Math.hypot(
    stillHidden.player.x - hidden.player.x,
    stillHidden.player.z - hidden.player.z,
  )).toBeLessThan(0.04);

  await setVisibility(page, "visible");
  await expect(page.locator("#resume-overlay")).toBeVisible();
  const visible = await getState(page);
  expect(visible.paused).toBe(true);
  expect(visible.owners).toEqual({ movement: null, camera: null, guidance: null, threat: null });
  await page.getByRole("button", { name: "再開する" }).click();
  await expect(page.locator("#resume-overlay")).toBeHidden();
  expect((await getState(page)).paused).toBe(false);

  // The synthetic event must not leave stale pointer state behind even though
  // the original pointerup events were intentionally never delivered.
  await pointer(page, ".joystick-zone", "pointerup", ids.movement, points.movementActive);
  await pointer(page, ".camera-zone", "pointerup", ids.camera, points.cameraActive);
  await pointer(page, "button[data-signal='guidance']", "pointerup", ids.signal, points.signalCenter);
  expect((await getState(page)).signalFireCount).toBe(0);
});

test("blur and focus are idempotent and require an explicit resume", async ({ page }) => {
  const ids = { movement: 151, camera: 152, signal: 153 };
  const points = await armHeldInputs(page, ids);
  await page.waitForTimeout(220);

  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("blur"));
  });
  const blurred = await getState(page);
  expect(blurred.paused).toBe(true);
  expect(blurred.owners).toEqual({ movement: null, camera: null, guidance: null, threat: null });
  expect(blurred.cancellationReason).toBe("blur");
  expect(blurred.signalFireCount).toBe(0);
  await page.waitForTimeout(300);
  const stillBlurred = await getState(page);
  expect(Math.hypot(
    stillBlurred.player.x - blurred.player.x,
    stillBlurred.player.z - blurred.player.z,
  )).toBeLessThan(0.04);

  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.locator("#resume-overlay")).toBeVisible();
  const focused = await getState(page);
  expect(focused.paused).toBe(true);
  expect(focused.owners).toEqual({ movement: null, camera: null, guidance: null, threat: null });
  await page.getByRole("button", { name: "再開する" }).click();
  await expect(page.locator("#resume-overlay")).toBeHidden();
  expect((await getState(page)).paused).toBe(false);

  await pointer(page, ".joystick-zone", "pointerup", ids.movement, points.movementActive);
  await pointer(page, ".camera-zone", "pointerup", ids.camera, points.cameraActive);
  await pointer(page, "button[data-signal='guidance']", "pointerup", ids.signal, points.signalCenter);
  expect((await getState(page)).signalFireCount).toBe(0);
});

test("pagehide and pageshow are idempotent and require an explicit resume", async ({ page }) => {
  const ids = { movement: 161, camera: 162, signal: 163 };
  const points = await armHeldInputs(page, ids);
  await page.waitForTimeout(220);

  await page.evaluate(() => {
    // A pageshow before the first pagehide is a no-op; repeated pagehide must
    // still leave the game in one paused, input-cleared state.
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
  });
  const hidden = await getState(page);
  expect(hidden.paused).toBe(true);
  expect(hidden.owners).toEqual({ movement: null, camera: null, guidance: null, threat: null });
  expect(hidden.cancellationReason).toBe("pagehide");
  expect(hidden.signalFireCount).toBe(0);
  await page.waitForTimeout(300);
  const stillHidden = await getState(page);
  expect(Math.hypot(
    stillHidden.player.x - hidden.player.x,
    stillHidden.player.z - hidden.player.z,
  )).toBeLessThan(0.04);

  await page.evaluate(() => {
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await expect(page.locator("#resume-overlay")).toBeVisible();
  const returned = await getState(page);
  expect(returned.paused).toBe(true);
  expect(returned.owners).toEqual({ movement: null, camera: null, guidance: null, threat: null });
  await page.getByRole("button", { name: "再開する" }).click();
  await expect(page.locator("#resume-overlay")).toBeHidden();
  expect((await getState(page)).paused).toBe(false);

  await pointer(page, ".joystick-zone", "pointerup", ids.movement, points.movementActive);
  await pointer(page, ".camera-zone", "pointerup", ids.camera, points.cameraActive);
  await pointer(page, "button[data-signal='guidance']", "pointerup", ids.signal, points.signalCenter);
  expect((await getState(page)).signalFireCount).toBe(0);
});
