import { expect, test, type Page } from "@playwright/test";

interface Point {
  x: number;
  y: number;
}

async function pointer(
  page: Page,
  selector: string,
  type: "pointerdown" | "pointermove" | "pointerup",
  pointerId: number,
  point: Point,
): Promise<void> {
  await page.locator(selector).dispatchEvent(type, {
    pointerId,
    pointerType: "touch",
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    cancelable: true,
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?p1-probe=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
});

test("held movement follows a newly rotated camera without requiring stick release", async ({ page }) => {
  const moveBox = await page.getByTestId("joystick-zone").boundingBox();
  const cameraBox = await page.getByTestId("camera-zone").boundingBox();
  if (!moveBox || !cameraBox) throw new Error("P1 controls are not measurable");

  const moveOrigin = {
    x: moveBox.x + 130,
    y: moveBox.y + moveBox.height * 0.72,
  };
  const moveForward = { x: moveOrigin.x, y: moveOrigin.y - 86 };
  const cameraOrigin = {
    x: cameraBox.x + cameraBox.width * 0.35,
    y: cameraBox.y + 90,
  };

  await pointer(page, ".joystick-zone", "pointerdown", 201, moveOrigin);
  await pointer(page, ".joystick-zone", "pointermove", 201, moveForward);
  await page.waitForTimeout(220);

  await pointer(page, ".camera-zone", "pointerdown", 202, cameraOrigin);
  await pointer(page, ".camera-zone", "pointermove", 202, {
    x: cameraOrigin.x + 330,
    y: cameraOrigin.y,
  });

  // The regression is specifically about movement *after* the camera turn.
  // Capture the position after the camera event so pre-turn movement does not
  // contaminate the direction measurement. The movement pointer stays held.
  const afterCameraInput = await page.evaluate(() => window.__OITATE_P1__.getState());
  expect(Math.abs(afterCameraInput.cameraYaw)).toBeGreaterThan(1.2);

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.__OITATE_P1__.getState());
    return Math.hypot(
      state.player.x - afterCameraInput.player.x,
      state.player.z - afterCameraInput.player.z,
    );
  }, { timeout: 2_000 }).toBeGreaterThan(0.12);

  const afterTurn = await page.evaluate(() => window.__OITATE_P1__.getState());
  const dx = afterTurn.player.x - afterCameraInput.player.x;
  const dz = afterTurn.player.z - afterCameraInput.player.z;
  const displacement = Math.hypot(dx, dz);
  const expectedX = Math.sin(afterCameraInput.cameraYaw);
  const expectedZ = -Math.cos(afterCameraInput.cameraYaw);
  const alignment = displacement > 0
    ? (dx / displacement) * expectedX + (dz / displacement) * expectedZ
    : 0;

  expect(displacement).toBeGreaterThan(0.12);
  expect(alignment).toBeGreaterThan(0.95);

  await pointer(page, ".camera-zone", "pointerup", 202, {
    x: cameraOrigin.x + 330,
    y: cameraOrigin.y,
  });
  await pointer(page, ".joystick-zone", "pointerup", 201, moveForward);
});
