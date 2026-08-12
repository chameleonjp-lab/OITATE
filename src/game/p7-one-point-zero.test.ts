import { describe, expect, it } from "vitest";

import {
  calculateP7Result,
  createP7Progress,
  getP7Stage,
  isP7Complete,
  isP7StageUnlocked,
  readP7Progress,
  updateP7Progress,
  writeP7Progress,
  type P7Storage,
  type P7StageId,
} from "./p7-one-point-zero";
import { createP6RunMetrics } from "./p6-vertical-slice-completion";
import {
  createP5Simulation,
  stepP5Simulation,
} from "./p5-vertical-slice-simulation";

class MemoryStorage implements P7Storage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function makeCompletedResult(stageId: P7StageId, assistedMode = false) {
  const state = createP5Simulation(getP7Stage(stageId).simulation);
  state.status = "completed";
  state.elapsedSeconds = 240;
  for (const animal of state.animals) {
    animal.lifeState = "captured";
    animal.phase = "captured";
  }
  state.discoveredRoutes.safe = true;
  state.discoveredRoutes.fast = true;
  state.events = getP7Stage(stageId).simulation.requiredEvents.map((type, index) => ({
    id: index + 1,
    type,
    atSeconds: 10 + index,
    subjectId: "fixture",
    reason: "p7-test",
  }));
  return calculateP7Result(stageId, createP6RunMetrics(assistedMode), state);
}

describe("P7 1.0 content progression", () => {
  it("defines six playable stages plus an optional practice stage", () => {
    expect(getP7Stage(0).isPractice).toBe(true);
    expect(getP7Stage(6).center).toBe("3種類を同時に管理する");
    expect(getP7Stage(2).simulation.requiredRoutes).toEqual(["fast"]);
    expect(getP7Stage(4).simulation.requiredEvents).toEqual([
      "animalStartedFollowing",
      "predatorThreatAccepted",
    ]);
  });

  it("does not complete a stage until its required concept was used", () => {
    const stage = getP7Stage(3);
    const state = createP5Simulation(stage.simulation);
    for (const animal of state.animals) {
      animal.lifeState = "captured";
      animal.phase = "captured";
    }

    stepP5Simulation(state, { x: 0, z: 0, speed: 0, isRunning: false }, 0.05);
    expect(state.status).toBe("active");

    state.events.push({
      id: 1,
      type: "predatorThreatAccepted",
      atSeconds: 1,
      subjectId: "predator-1",
      reason: "p7-test",
    });
    stepP5Simulation(state, { x: 0, z: 0, speed: 0, isRunning: false }, 0.05);
    expect(state.status).toBe("completed");
  });

  it("enforces ordered signals and role-specific route use", () => {
    const stage4 = getP7Stage(4);
    const stage4State = createP5Simulation(stage4.simulation);
    for (const animal of stage4State.animals) {
      animal.lifeState = "captured";
      animal.phase = "captured";
    }
    stage4State.events = [
      {
        id: 1,
        type: "predatorThreatAccepted",
        atSeconds: 1,
        subjectId: "predator-1",
        reason: "test",
      },
      {
        id: 2,
        type: "animalStartedFollowing",
        atSeconds: 2,
        subjectId: "follower-1",
        reason: "test",
      },
    ];
    stepP5Simulation(stage4State, { x: 0, z: 0, speed: 0, isRunning: false }, 0.05);
    expect(stage4State.status).toBe("active");

    stage4State.events = [
      {
        id: 1,
        type: "animalStartedFollowing",
        atSeconds: 1,
        subjectId: "follower-1",
        reason: "test",
      },
      {
        id: 2,
        type: "predatorThreatAccepted",
        atSeconds: 2,
        subjectId: "predator-1",
        reason: "test",
      },
    ];
    stepP5Simulation(stage4State, { x: 0, z: 0, speed: 0, isRunning: false }, 0.05);
    expect(stage4State.status).toBe("completed");

    const stage5 = getP7Stage(5);
    const stage5State = createP5Simulation(stage5.simulation);
    for (const animal of stage5State.animals) {
      animal.lifeState = "captured";
      animal.phase = "captured";
    }
    stage5State.discoveredRoutes.safe = true;
    stage5State.discoveredRoutes.fast = true;
    stage5State.events = [
      {
        id: 1,
        type: "routeDiscovered",
        atSeconds: 1,
        subjectId: "follower-1",
        reason: "safe",
      },
      {
        id: 2,
        type: "routeDiscovered",
        atSeconds: 2,
        subjectId: "coward-1",
        reason: "fast",
      },
    ];
    stepP5Simulation(stage5State, { x: 0, z: 0, speed: 0, isRunning: false }, 0.05);
    expect(stage5State.status).toBe("active");

    stage5State.events = [
      {
        id: 1,
        type: "routeDiscovered",
        atSeconds: 1,
        subjectId: "coward-1",
        reason: "safe",
      },
      {
        id: 2,
        type: "routeDiscovered",
        atSeconds: 2,
        subjectId: "follower-1",
        reason: "fast",
      },
    ];
    stepP5Simulation(stage5State, { x: 0, z: 0, speed: 0, isRunning: false }, 0.05);
    expect(stage5State.status).toBe("completed");
  });

  it("requires all seven stage 4 animals and states the same objective", () => {
    const stage = getP7Stage(4);
    expect(stage.objective).toBe(
      "誘導音の後に威嚇音を使い、保護対象6体を収容し、危険種1体を隔離する",
    );
    const state = createP5Simulation(stage.simulation);
    for (const animal of state.animals.filter((candidate) => candidate.type !== "predator")) {
      animal.lifeState = "captured";
      animal.phase = "captured";
    }
    state.events = [
      {
        id: 1,
        type: "animalStartedFollowing",
        atSeconds: 1,
        subjectId: "follower-1",
        reason: "test",
      },
      {
        id: 2,
        type: "predatorThreatAccepted",
        atSeconds: 2,
        subjectId: "predator-1",
        reason: "test",
      },
    ];
    stepP5Simulation(state, { x: 0, z: 0, speed: 0, isRunning: false }, 0.05);
    expect(state.status).toBe("active");

    const predator = state.animals.find((animal) => animal.type === "predator");
    if (!predator) throw new Error("stage 4 test predator is missing");
    predator.lifeState = "captured";
    predator.phase = "captured";
    stepP5Simulation(state, { x: 0, z: 0, speed: 0, isRunning: false }, 0.05);
    expect(state.status).toBe("completed");
  });

  it("unlocks the next stage, keeps best records, and gates the fourth animal", () => {
    let progress = createP7Progress();
    expect(isP7StageUnlocked(progress, 1)).toBe(true);
    for (const stageId of [1, 2, 3, 4, 5, 6] as const) {
      progress = updateP7Progress(progress, makeCompletedResult(stageId));
    }
    expect(isP7Complete(progress)).toBe(true);
    expect(progress.fourthAnimalGate).toBe("eligible");
    expect(progress.unlockedStageIds).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(progress.records[6]?.standard?.bestScore).toBeGreaterThan(0);
  });

  it("survives malformed storage and persists progress without accounts", () => {
    const storage = new MemoryStorage();
    storage.setItem("oitate:p7:progress:v1", "not-json");
    expect(readP7Progress(storage)).toEqual(createP7Progress());

    const progress = updateP7Progress(createP7Progress(), makeCompletedResult(1));
    writeP7Progress(progress, storage);
    const restored = readP7Progress(storage);
    expect(restored.completedStageIds).toEqual([1]);
    expect(restored.unlockedStageIds).toEqual([0, 1, 2]);
    expect(restored.records[1]?.standard?.mode).toBe("standard");
  });

  it("keeps practice, standard, and assisted records separate", () => {
    let progress = createP7Progress();
    progress = updateP7Progress(progress, makeCompletedResult(0));
    progress = updateP7Progress(progress, makeCompletedResult(1));
    progress = updateP7Progress(progress, makeCompletedResult(1, true));

    expect(progress.records[0]?.practice?.mode).toBe("practice");
    expect(progress.records[1]?.standard?.mode).toBe("standard");
    expect(progress.records[1]?.assisted?.mode).toBe("assisted");
  });
});
