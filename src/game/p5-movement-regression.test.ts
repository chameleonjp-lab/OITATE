import { describe, expect, it } from "vitest";

import {
  createP5Simulation,
  P5_TUNING,
  stepP5Simulation,
  type P5AnimalState,
} from "./p5-vertical-slice-simulation";

function animalById(state: ReturnType<typeof createP5Simulation>, id: string): P5AnimalState {
  const animal = state.animals.find((candidate) => candidate.id === id);
  if (!animal) throw new Error(`missing animal: ${id}`);
  return animal;
}

describe("P5 movement regressions", () => {
  it("lets a coward recover when its preferred side-step is blocked by the world edge", () => {
    const state = createP5Simulation();
    const moving = animalById(state, "coward-1");
    const blocker = animalById(state, "coward-2");

    // coward-1 is exactly against the left world edge. The player pushes it
    // toward -Z while an active coward blocks the direct path. The negative-X
    // fallback cannot move at all, so the open positive-X side must be tried.
    moving.x = P5_TUNING.worldMin + moving.radius;
    moving.z = 5;
    moving.previousX = moving.x;
    moving.previousZ = moving.z;

    blocker.x = moving.x;
    blocker.z = moving.z - P5_TUNING.minimumAnimalSeparation;
    blocker.previousX = blocker.x;
    blocker.previousZ = blocker.z;
    blocker.lifeState = "active";
    blocker.phase = "idle";

    const startX = moving.x;
    const startZ = moving.z;

    stepP5Simulation(state, {
      x: moving.x,
      z: moving.z + 2.5,
      speed: 2.2,
      isRunning: false,
    }, P5_TUNING.decisionStepSeconds);

    expect(Math.hypot(moving.x - startX, moving.z - startZ)).toBeGreaterThan(0.02);
    expect(moving.x).toBeGreaterThan(startX + 0.02);
  });

  it("keeps an actually captured sheep position stable across later simulation steps", () => {
    const state = createP5Simulation();
    const captured = animalById(state, "coward-1");
    captured.x = -8;
    captured.z = -10;
    captured.previousX = captured.x;
    captured.previousZ = captured.z;
    captured.lifeState = "captured";
    captured.phase = "captured";
    captured.insidePen = true;
    captured.lastMoveX = 0;
    captured.lastMoveZ = 0;

    const before = {
      x: captured.x,
      z: captured.z,
      previousX: captured.previousX,
      previousZ: captured.previousZ,
      lastMoveX: captured.lastMoveX,
      lastMoveZ: captured.lastMoveZ,
    };

    for (let step = 0; step < 20; step += 1) {
      stepP5Simulation(state, {
        x: 0,
        z: 0,
        speed: 0,
        isRunning: false,
      }, P5_TUNING.decisionStepSeconds);
    }

    expect({
      x: captured.x,
      z: captured.z,
      previousX: captured.previousX,
      previousZ: captured.previousZ,
      lastMoveX: captured.lastMoveX,
      lastMoveZ: captured.lastMoveZ,
    }).toEqual(before);
  });
});
