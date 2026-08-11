import { describe, expect, it } from "vitest";

import {
  createP3Simulation,
  P3_TUNING,
  stepP3Simulation,
} from "./p3-cowardly-simulation";

function completeOneAnimal(
  state: ReturnType<typeof createP3Simulation>,
  index: number,
): void {
  const animal = state.animals[index];
  if (!animal) throw new Error(`missing animal ${index}`);
  for (const other of state.animals) {
    if (other !== animal) other.phase = "captured";
  }
  animal.x = state.pen.centerX;
  animal.z = state.pen.centerZ;
  animal.previousX = animal.x;
  animal.previousZ = animal.z;
  animal.phase = "enteringPen";
  animal.fullBodyInside = true;
  animal.captureHoldSeconds = 0;
  state.penReservedAnimalId = animal.id;
  stepP3Simulation(state, { x: 0, z: 6 }, 0.2);
  stepP3Simulation(state, { x: 0, z: 6 }, 0.2);
}

describe("P3 cowardly flock simulation", () => {
  it("starts with six animals in one cohesive flock", () => {
    const state = createP3Simulation();

    expect(state.animals).toHaveLength(6);
    expect(state.animals.map((animal) => animal.id)).toEqual([
      "coward-1",
      "coward-2",
      "coward-3",
      "coward-4",
      "coward-5",
      "coward-6",
    ]);
    expect(state.flock.state).toBe("cohesive");
    expect(state.flock.spread).toBeLessThan(P3_TUNING.flockSplitDistance);
  });

  it("shows an anticipation phase before movement", () => {
    const state = createP3Simulation();
    const animal = state.animals[0];
    if (!animal) throw new Error("missing animal");
    const start = { x: animal.x, z: animal.z };

    stepP3Simulation(state, { x: animal.x, z: animal.z + 5 }, 0.05);

    expect(animal.phase).toBe("anticipating");
    expect(animal.tensionState).toBe("calm");
    expect(animal.x).toBe(start.x);
    expect(animal.z).toBe(start.z);
  });

  it("enters alert tension at 45 and confusion at 85", () => {
    const state = createP3Simulation();
    const animal = state.animals[0];
    if (!animal) throw new Error("missing animal");

    for (let step = 0; step < 70; step += 1) {
      stepP3Simulation(state, { x: animal.x, z: animal.z + 1, isRunning: true }, 0.05);
      if (animal.tensionState === "confused") break;
    }

    expect(animal.tension).toBeGreaterThanOrEqual(P3_TUNING.tensionConfusionEnter);
    expect(animal.tensionState).toBe("confused");
    expect(animal.confusionCause).toBe("pressure");
    expect(animal.confusionSeconds).toBe(0);
  });

  it("does not end confusion before the minimum duration", () => {
    const state = createP3Simulation();
    const animal = state.animals[0];
    if (!animal) throw new Error("missing animal");
    animal.tension = 100;
    animal.tensionState = "confused";
    animal.confusionSeconds = 0;
    animal.phase = "idle";

    stepP3Simulation(state, { x: 20, z: 20 }, 0.25);

    expect(animal.tensionState).toBe("confused");
    expect(animal.confusionSeconds).toBeLessThan(P3_TUNING.confusionMinimumSeconds);
    for (let step = 0; step < 30; step += 1) {
      stepP3Simulation(state, { x: 20, z: 20 }, 0.05);
    }
    expect(animal.confusionSeconds).toBeGreaterThanOrEqual(P3_TUNING.confusionMinimumSeconds);
  });

  it("marks a flock split only after the delay and recovers below the lower boundary", () => {
    const state = createP3Simulation();
    const first = state.animals[0];
    const last = state.animals[5];
    if (!first || !last) throw new Error("missing animals");
    first.x = -6;
    last.x = 6;
    first.tension = 90;
    last.tension = 90;
    first.tensionState = "alert";
    last.tensionState = "alert";

    stepP3Simulation(state, { x: 20, z: 20 }, 0.25);
    expect(state.flock.state).not.toBe("split");
    stepP3Simulation(state, { x: 20, z: 20 }, 0.25);
    stepP3Simulation(state, { x: 20, z: 20 }, 0.25);
    stepP3Simulation(state, { x: 20, z: 20 }, 0.25);
    expect(state.flock.state).toBe("split");
    stepP3Simulation(state, { x: 20, z: 20 }, 0.05);
    expect(state.animals.every((animal) => Number.isFinite(animal.tension))).toBe(true);

    first.x = state.flock.centerX;
    last.x = state.flock.centerX;
    stepP3Simulation(state, { x: 20, z: 20 }, 1);
    expect(state.flock.state).toBe("cohesive");
  });

  it("gives only one animal the entrance reservation", () => {
    const state = createP3Simulation();
    const outerFace = state.pen.entranceZ + state.pen.animalRadius;
    for (const [index, animal] of state.animals.entries()) {
      animal.x = 0;
      animal.z = outerFace + 0.02 + index * P3_TUNING.minimumAnimalSeparation;
      animal.previousX = animal.x;
      animal.previousZ = animal.z;
      animal.phase = "fleeing";
      animal.fleeTriggerBand = "guidance";
      animal.pressureBand = "guidance";
    }

    for (let step = 0; step < 10; step += 1) {
      stepP3Simulation(state, { x: 0, z: 0 }, 0.05);
    }

    expect(state.penReservedAnimalId).toBe("coward-1");
    expect(state.animals.filter((animal) => animal.phase === "enteringPen")).toHaveLength(1);
    expect(state.animals.filter((animal) => animal.phase === "waitingForEntrance").length)
      .toBeGreaterThanOrEqual(1);
  });

  it("backs a waiting animal away after two seconds and counts recovery", () => {
    const state = createP3Simulation();
    const owner = state.animals[0];
    const waiter = state.animals[1];
    if (!owner || !waiter) throw new Error("missing animals");
    state.pen.animalRadius = 2.5;
    owner.phase = "enteringPen";
    state.pen.centerZ = -14;
    state.pen.entranceZ = -6;
    state.pen.halfDepth = 8;
    owner.x = state.pen.centerX;
    owner.z = state.pen.entranceZ + state.pen.animalRadius + 0.02;
    owner.fullBodyInside = true;
    state.penReservedAnimalId = owner.id;
    waiter.phase = "waitingForEntrance";
    waiter.x = state.pen.centerX;
    waiter.z = state.pen.entranceZ + state.pen.animalRadius + 0.02;
    waiter.waitingSeconds = 0;

    for (let step = 0; step < 45; step += 1) {
      stepP3Simulation(state, { x: 0, z: 6 }, 0.05);
    }

    expect(waiter.recoveryCount).toBeGreaterThan(0);
    expect(["backingOff", "fleeing", "waitingForEntrance"]).toContain(waiter.phase);
  });

  it("captures all six through repeated valid entrance ownership", () => {
    const state = createP3Simulation();
    for (let index = 0; index < state.animals.length; index += 1) {
      completeOneAnimal(state, index);
      expect(state.animals[index]?.phase).toBe("captured");
    }

    expect(state.capturedCount).toBe(6);
    expect(state.completed).toBe(true);
    expect(state.penReservedAnimalId).toBeNull();
    expect(state.animals.every((animal) => animal.fullBodyInside)).toBe(true);
  });

  it("is a no-op for invalid time and keeps finite positions", () => {
    const state = createP3Simulation();
    const before = structuredClone(state);

    stepP3Simulation(state, { x: Number.NaN, z: Number.POSITIVE_INFINITY }, 0);

    expect(state).toEqual(before);
    for (const animal of state.animals) {
      animal.x = Number.NaN;
      animal.z = Number.POSITIVE_INFINITY;
    }
    stepP3Simulation(state, { x: 0, z: 0 }, 0.05);
    expect(state.animals.every((animal) => Number.isFinite(animal.x) && Number.isFinite(animal.z))).toBe(true);
  });
});
