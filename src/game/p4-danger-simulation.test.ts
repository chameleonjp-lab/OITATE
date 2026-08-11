import { describe, expect, it } from "vitest";

import {
  createP4Simulation,
  P4_TUNING,
  stepP4Simulation,
} from "./p4-danger-simulation";

function stepUntilRescuePending(
  state: ReturnType<typeof createP4Simulation>,
): void {
  state.predator.x = 0;
  state.predator.z = -1.3;
  state.predator.previousX = state.predator.x;
  state.predator.previousZ = state.predator.z;
  for (let step = 0; step < 60 && state.victim.lifeState === "active"; step += 1) {
    stepP4Simulation(state, { x: 10, z: 10, speed: 0 }, 0.05);
  }
}

describe("P4 danger simulation", () => {
  it("starts with one predator and one protected victim", () => {
    const state = createP4Simulation();

    expect(state.status).toBe("active");
    expect(state.predator.id).toBe("predator-1");
    expect(state.victim.id).toBe("victim-1");
    expect(state.predator.attackPhase).toBe("search");
    expect(state.victim.lifeState).toBe("active");
  });

  it("shows aim before lunge and keeps the full 1.2 second warning", () => {
    const state = createP4Simulation();
    state.predator.x = 0;
    state.predator.z = -1.3;
    state.predator.previousX = state.predator.x;
    state.predator.previousZ = state.predator.z;

    stepP4Simulation(state, { x: 10, z: 10, speed: 0 }, 0.05);
    expect(state.predator.attackPhase).toBe("aim");

    for (let step = 0; step < 23; step += 1) {
      stepP4Simulation(state, { x: 10, z: 10, speed: 0 }, 0.05);
    }
    expect(state.predator.aimSeconds).toBeLessThan(P4_TUNING.aimSeconds);
    expect(state.predator.attackPhase).toBe("aim");

    stepP4Simulation(state, { x: 10, z: 10, speed: 0 }, 0.05);
    expect(state.predator.attackPhase).toBe("lunge");
  });

  it("interrupts aim with a valid threat signal", () => {
    const state = createP4Simulation();
    state.predator.x = 0;
    state.predator.z = -1.3;
    stepP4Simulation(state, { x: 10, z: 10, speed: 0 }, 0.05);
    expect(state.predator.attackPhase).toBe("aim");

    const result = stepP4Simulation(
      state,
      { x: 0, z: -2.8, speed: 0, threatSignal: true },
      0.05,
    );

    expect(result.threatAccepted).toBe(true);
    expect(state.predator.attackPhase).toBe("chase");
    expect(state.predator.intent).toBe("chasePlayer");
    expect(state.events.some((event) => event.type === "predatorLungeStarted")).toBe(false);
  });

  it("does not cancel a lunge after it has started", () => {
    const state = createP4Simulation();
    state.predator.attackPhase = "lunge";
    state.predator.x = 0;
    state.predator.z = -1.3;
    state.predator.lungeTargetX = state.victim.x;
    state.predator.lungeTargetZ = state.victim.z;

    const result = stepP4Simulation(
      state,
      { x: 0, z: -2.8, speed: 0, threatSignal: true },
      0.05,
    );

    expect(result.threatAccepted).toBe(false);
    expect(state.predator.attackPhase).toBe("lunge");
  });

  it("does not target a victim through a closed section of the pen rail", () => {
    const state = createP4Simulation();
    state.predator.x = 3;
    state.predator.z = -7;
    state.predator.previousX = state.predator.x;
    state.predator.previousZ = state.predator.z;
    state.victim.x = 3;
    state.victim.z = state.pen.centerZ;
    state.victim.previousX = state.victim.x;
    state.victim.previousZ = state.victim.z;

    for (let step = 0; step < 20; step += 1) {
      stepP4Simulation(state, { x: 10, z: 10, speed: 0 }, 0.05);
    }

    expect(state.predator.attackPhase).toBe("search");
    expect(state.events.some((event) => event.type === "predatorAimStarted")).toBe(false);
  });

  it("revalidates the target before committing to a lunge", () => {
    const state = createP4Simulation();
    state.predator.x = 0;
    state.predator.z = -1.3;
    stepP4Simulation(state, { x: 10, z: 10, speed: 0 }, 0.05);
    expect(state.predator.attackPhase).toBe("aim");

    state.victim.x = 4;
    state.victim.previousX = state.victim.x;
    state.victim.previousZ = state.victim.z;
    stepP4Simulation(state, { x: 10, z: 10, speed: 0 }, 0.05);

    expect(state.predator.attackPhase).toBe("search");
    expect(state.events.some((event) => event.type === "predatorLungeStarted")).toBe(false);
  });

  it("moves the first valid attack into rescue pending", () => {
    const state = createP4Simulation();
    stepUntilRescuePending(state);

    expect(state.victim.lifeState).toBe("rescuePending");
    expect(state.victim.rescueSeconds).toBeLessThan(P4_TUNING.rescueDeadlineSeconds);
    expect(state.events.some((event) => event.type === "victimRescuePending")).toBe(true);
  });

  it("rescues a pending victim by proximity and grants protection", () => {
    const state = createP4Simulation();
    stepUntilRescuePending(state);
    const rescuePosition = { x: state.predator.x, z: state.predator.z };

    const result = stepP4Simulation(
      state,
      { ...rescuePosition, speed: 0 },
      0.05,
    );

    expect(result.rescued).toBe(true);
    expect(state.victim.lifeState).toBe("active");
    expect(state.victim.rescueCount).toBe(1);
    expect(state.victim.protectionSeconds).toBeGreaterThan(0);
    expect(state.events.filter((event) => event.type === "rescueSucceeded")).toHaveLength(1);
  });

  it("fails when rescue time expires", () => {
    const state = createP4Simulation();
    state.victim.lifeState = "rescuePending";
    state.victim.rescueSeconds = P4_TUNING.rescueDeadlineSeconds - 0.05;
    state.predator.attackPhase = "recovery";
    state.predator.recoverySeconds = 0;

    const result = stepP4Simulation(state, { x: 10, z: 10, speed: 0 }, 0.05);

    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("rescueTimeout");
    expect(state.victim.lifeState).toBe("failureLocked");
    expect(state.predator.attackPhase).toBe("disabled");
  });

  it("locks a second valid attack as a repeated-attack failure", () => {
    const state = createP4Simulation();
    state.victim.rescueCount = 1;
    state.predator.attackPhase = "lunge";
    state.predator.x = 0;
    state.predator.z = -1.3;
    state.predator.lungeTargetX = state.victim.x;
    state.predator.lungeTargetZ = state.victim.z;

    let result = stepP4Simulation(state, { x: 10, z: 10, speed: 0 }, 0.05);
    for (let step = 0; step < 10 && result.status === "active"; step += 1) {
      result = stepP4Simulation(state, { x: 10, z: 10, speed: 0 }, 0.05);
    }

    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("repeatedAttack");
    expect(state.victim.lifeState).toBe("failureLocked");
    expect(state.predator.attackPhase).toBe("disabled");
  });

  it("does not attack a victim during the post-rescue protection window", () => {
    const state = createP4Simulation();
    state.victim.rescueCount = 1;
    state.victim.protectionSeconds = P4_TUNING.rescueProtectionSeconds;
    state.predator.x = 0;
    state.predator.z = -1.3;

    for (let step = 0; step < 10; step += 1) {
      stepP4Simulation(state, { x: 10, z: 10, speed: 0 }, 0.05);
    }

    expect(state.status).toBe("active");
    expect(state.victim.lifeState).toBe("active");
    expect(state.events.some((event) => event.type === "victimRescuePending")).toBe(false);
  });

  it("captures the predator only after it is inside and the player is outside", () => {
    const state = createP4Simulation();
    state.predator.x = state.pen.centerX;
    state.predator.z = state.pen.centerZ;
    state.predator.previousX = state.predator.x;
    state.predator.previousZ = state.predator.z;
    state.predator.insidePen = true;
    state.predator.attackPhase = "search";

    for (let step = 0; step < 13 && state.status === "active"; step += 1) {
      stepP4Simulation(state, { x: 0, z: 0, speed: 0 }, 0.05);
    }

    expect(state.status).toBe("completed");
    expect(state.predator.attackPhase).toBe("disabled");
    expect(state.events.filter((event) => event.type === "predatorCaptured")).toHaveLength(1);
  });

  it("keeps the state unchanged for invalid time or player input", () => {
    const state = createP4Simulation();
    const before = structuredClone(state);

    stepP4Simulation(state, { x: Number.NaN, z: 0, speed: 0 }, 0.05);
    expect(state).toEqual(before);

    stepP4Simulation(state, { x: 0, z: 0, speed: 0 }, 0);
    expect(state).toEqual(before);
  });

  it("keeps captured and failed runs frozen until a new simulation is created", () => {
    const completed = createP4Simulation();
    completed.status = "completed";
    completed.predator.attackPhase = "disabled";
    const completedBefore = structuredClone(completed);
    stepP4Simulation(completed, { x: 0, z: 0, speed: 0 }, 1);
    expect(completed).toEqual(completedBefore);

    const failed = createP4Simulation();
    failed.status = "failed";
    failed.failureReason = "rescueTimeout";
    failed.victim.lifeState = "failureLocked";
    const failedBefore = structuredClone(failed);
    stepP4Simulation(failed, { x: 0, z: 0, speed: 0 }, 1);
    expect(failed).toEqual(failedBefore);
  });
});
