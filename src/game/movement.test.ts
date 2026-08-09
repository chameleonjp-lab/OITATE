import { describe, expect, it } from "vitest";

import {
  ACCELERATION_SECONDS,
  DEFAULT_MOVEMENT_TUNING,
  MOVEMENT_DEAD_ZONE,
  MOVEMENT_WALK_THRESHOLD,
  approachSpeed,
  shortestAngleDelta,
  targetSpeedForMagnitude,
  worldDirectionFromJoystick,
} from "./movement";

describe("P1 movement curve", () => {
  it("keeps the configured dead zone stopped", () => {
    expect(targetSpeedForMagnitude(0)).toBe(0);
    expect(targetSpeedForMagnitude(MOVEMENT_DEAD_ZONE)).toBe(0);
  });

  it("moves continuously from walk to run", () => {
    const belowWalk = targetSpeedForMagnitude(0.5);
    const walk = targetSpeedForMagnitude(MOVEMENT_WALK_THRESHOLD);
    const run = targetSpeedForMagnitude(1);
    expect(belowWalk).toBeGreaterThan(0);
    expect(walk).toBeCloseTo(DEFAULT_MOVEMENT_TUNING.walkSpeed, 6);
    expect(run).toBeCloseTo(DEFAULT_MOVEMENT_TUNING.runSpeed, 6);
    expect(belowWalk).toBeLessThan(walk);
    expect(walk).toBeLessThan(run);
  });

  it("uses the roughly 150ms acceleration envelope without overshoot", () => {
    const next = approachSpeed(0, 4, ACCELERATION_SECONDS);
    expect(next).toBeGreaterThan(2.5);
    expect(next).toBeLessThan(4);
    expect(approachSpeed(5, 2, 0.016)).toBeLessThan(5);
    expect(approachSpeed(5, 2, 0.016)).toBeGreaterThan(2);
  });
});

describe("camera-relative movement", () => {
  it("moves forward toward world -Z at yaw zero", () => {
    const direction = worldDirectionFromJoystick(0, -1, 0);
    expect(direction.x).toBeCloseTo(0, 6);
    expect(direction.z).toBeCloseTo(-1, 6);
  });

  it("rotates forward toward world +X at a quarter turn", () => {
    const direction = worldDirectionFromJoystick(0, -1, Math.PI / 2);
    expect(direction.x).toBeCloseTo(1, 6);
    expect(direction.z).toBeCloseTo(0, 6);
  });

  it("chooses the shortest wrapped yaw change", () => {
    const delta = shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1);
    expect(delta).toBeCloseTo(0.2, 6);
  });
});
