import { describe, expect, it } from "vitest";

import {
  createP5Simulation,
  P5_TUNING,
  stepP5Simulation,
  type P5AnimalState,
  type P5SimulationState,
} from "./p5-vertical-slice-simulation";

const tick = (
  state: P5SimulationState,
  input: Partial<Parameters<typeof stepP5Simulation>[1]> = {},
  seconds = P5_TUNING.decisionStepSeconds,
) => stepP5Simulation(state, {
  x: 0,
  z: 8,
  speed: 0,
  isRunning: false,
  ...input,
}, seconds);

function getAnimal(state: P5SimulationState, id: string): P5AnimalState {
  const animal = state.animals.find((candidate) => candidate.id === id);
  if (!animal) throw new Error(`P5 test animal missing: ${id}`);
  return animal;
}

function primeAim(state: P5SimulationState): P5AnimalState {
  const victim = getAnimal(state, "coward-1");
  const predator = getAnimal(state, "predator-1");
  predator.x = victim.x;
  predator.z = victim.z - 1.1;
  predator.previousX = predator.x;
  predator.previousZ = predator.z;
  tick(state, { x: 10, z: 10 });
  expect(predator.phase).toBe("aim");
  return predator;
}

describe("P5 vertical-slice simulation", () => {
  it("creates exactly six cowardly, four follower, and one predator animal", () => {
    const state = createP5Simulation();
    expect(state.animals).toHaveLength(11);
    expect(state.animals.filter((animal) => animal.type === "coward")).toHaveLength(6);
    expect(state.animals.filter((animal) => animal.type === "follower")).toHaveLength(4);
    expect(state.animals.filter((animal) => animal.type === "predator")).toHaveLength(1);
    expect(state.animals.map((animal) => animal.id)).toEqual([
      "coward-1", "coward-2", "coward-3", "coward-4", "coward-5", "coward-6",
      "follower-1", "follower-2", "follower-3", "follower-4", "predator-1",
    ]);
  });

  it("keeps a coward out of the water while a follower can use the bridge", () => {
    const state = createP5Simulation();
    const coward = getAnimal(state, "coward-2");
    coward.x = 0;
    coward.z = 0;
    coward.previousX = coward.x;
    coward.previousZ = coward.z;
    const follower = getAnimal(state, "follower-1");
    follower.x = 0;
    follower.z = 0;
    follower.previousX = follower.x;
    follower.previousZ = follower.z;

    for (let step = 0; step < 140; step += 1) {
      tick(state, { x: 0, z: 0, guidanceSignal: step === 0 });
    }

    expect(
      coward.x >= state.terrain.water.minX
      && coward.x <= state.terrain.water.maxX
      && coward.z >= state.terrain.water.minZ
      && coward.z <= state.terrain.water.maxZ,
    ).toBe(false);
    expect(follower.route).toBe("fast");
    expect(state.discoveredRoutes.fast).toBe(true);
  });

  it("records safe and fast route discoveries separately", () => {
    const state = createP5Simulation();
    tick(state, { x: -5.2, z: 0 });
    expect(state.discoveredRoutes.safe).toBe(true);
    expect(state.discoveredRoutes.fast).toBe(false);

    tick(state, { x: 0, z: 0 });
    expect(state.discoveredRoutes.fast).toBe(true);
    expect(state.events.filter((event) => event.type === "routeDiscovered")).toHaveLength(2);
  });

  it("keeps the predator in aim until the full warning duration", () => {
    const state = createP5Simulation();
    const predator = primeAim(state);
    for (let step = 0; step < 23; step += 1) tick(state, { x: 10, z: 10 });
    expect(predator.phase).toBe("aim");
    tick(state, { x: 10, z: 10 });
    expect(predator.phase).toBe("lunge");
  });

  it("interrupts aim with a threat signal but cannot cancel a lunge", () => {
    const state = createP5Simulation();
    const predator = primeAim(state);
    const result = tick(state, {
      x: predator.x + 3,
      z: predator.z,
      threatSignal: true,
    });
    expect(result.threatAccepted).toBe(true);
    expect(predator.phase).not.toBe("lunge");

    const second = createP5Simulation();
    const secondPredator = primeAim(second);
    const secondVictim = getAnimal(second, "coward-1");
    for (let step = 0; step < 23; step += 1) tick(second, { x: 10, z: 10 });
    secondVictim.x = secondPredator.x;
    secondVictim.z = secondPredator.z + 1.1;
    tick(second, { x: 10, z: 10 });
    expect(secondPredator.phase).toBe("lunge");
    const rejected = tick(second, {
      x: secondPredator.x,
      z: secondPredator.z,
      threatSignal: true,
    });
    expect(rejected.threatAccepted).toBe(false);
    expect(secondPredator.phase).toBe("lunge");
  });

  it("supports rescue success and locks rescue timeout as failure", () => {
    const state = createP5Simulation();
    const victim = getAnimal(state, "coward-1");
    const predator = getAnimal(state, "predator-1");
    victim.lifeState = "rescuePending";
    victim.phase = "rescuePending";
    victim.rescueSeconds = 1;
    predator.phase = "recovery";
    predator.waitingSeconds = 0;
    predator.x = 0;
    predator.z = 0;
    const rescued = tick(state, { x: 0, z: 0, threatSignal: true });
    expect(rescued.rescued).toBe(true);
    expect(victim.lifeState).toBe("active");
    expect(victim.rescueCount).toBe(1);

    const failed = createP5Simulation();
    const failedVictim = getAnimal(failed, "coward-1");
    const failedPredator = getAnimal(failed, "predator-1");
    failedVictim.lifeState = "rescuePending";
    failedVictim.phase = "rescuePending";
    failedVictim.rescueSeconds = P5_TUNING.rescueDeadlineSeconds - 0.05;
    failedPredator.phase = "recovery";
    failedPredator.waitingSeconds = 0;
    const failure = tick(failed, { x: 10, z: 10 });
    expect(failure.status).toBe("failed");
    expect(failure.failureReason).toBe("rescueTimeout");
  });

  it("captures a predator only after the player leaves its pen", () => {
    const state = createP5Simulation();
    for (const animal of state.animals.filter((candidate) => candidate.type !== "predator")) {
      animal.lifeState = "captured";
      animal.phase = "captured";
      animal.insidePen = true;
    }
    const predator = getAnimal(state, "predator-1");
    predator.x = state.pens.predator.centerX;
    predator.z = state.pens.predator.centerZ;
    predator.insidePen = true;
    predator.phase = "recovery";
    tick(state, { x: 0, z: 0 });
    expect(state.status).toBe("active");
    tick(state, { x: 10, z: 10 });
    for (let step = 0; step < 12 && state.status === "active"; step += 1) {
      tick(state, { x: 10, z: 10 });
    }
    expect(predator.lifeState).toBe("disabled");
    expect(state.status).toBe("completed");
  });

  it("does not mutate on invalid time or non-finite input", () => {
    const state = createP5Simulation();
    const before = structuredClone(state);
    stepP5Simulation(state, { x: Number.NaN, z: 0, speed: 0, isRunning: false }, 0.05);
    expect(state).toEqual(before);
    stepP5Simulation(state, { x: 0, z: 0, speed: 0, isRunning: false }, 0);
    expect(state).toEqual(before);
  });

  it("freezes a completed run until a new simulation is created", () => {
    const state = createP5Simulation();
    state.status = "completed";
    const before = structuredClone(state);
    stepP5Simulation(state, { x: 0, z: 0, speed: 10, isRunning: true }, 1);
    expect(state).toEqual(before);
  });
});
