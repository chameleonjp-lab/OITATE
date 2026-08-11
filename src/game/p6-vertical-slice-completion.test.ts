import { describe, expect, it } from "vitest";

import {
  calculateP6Result,
  createP6RunMetrics,
  observeP6Run,
  readP6RecordBook,
  updateP6RecordBook,
  writeP6RecordBook,
  type P6Storage,
} from "./p6-vertical-slice-completion";
import { createP5Simulation } from "./p5-vertical-slice-simulation";

class MemoryStorage implements P6Storage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function completeState() {
  const state = createP5Simulation();
  state.status = "completed";
  state.elapsedSeconds = 240;
  for (const animal of state.animals) {
    animal.lifeState = "captured";
    animal.phase = "captured";
  }
  state.discoveredRoutes.safe = true;
  state.discoveredRoutes.fast = true;
  state.events = [
    {
      id: 1,
      type: "routeDiscovered",
      atSeconds: 20,
      subjectId: "safe",
      reason: "coward-1-entered-route-marker",
    },
    {
      id: 2,
      type: "routeDiscovered",
      atSeconds: 30,
      subjectId: "fast",
      reason: "follower-1-entered-route-marker",
    },
    {
      id: 3,
      type: "animalCaptured",
      atSeconds: 220,
      subjectId: "coward-1",
      reason: "full-body-inside-pen",
    },
  ];
  return state;
}

describe("P6 vertical-slice completion scoring", () => {
  it("keeps the formal 40/25/20/15 score weights and awards a clear grade", () => {
    const state = completeState();
    const metrics = createP6RunMetrics();
    observeP6Run(metrics, state, 0.05);

    const result = calculateP6Result(metrics, state);

    expect(result.completed).toBe(true);
    expect(result.breakdown).toEqual({
      safety: 40000,
      coordination: 25000,
      judgement: 20000,
      time: 15000,
    });
    expect(result.totalScore).toBe(100000);
    expect(result.grade).toBe("S");
    expect(result.titles).toEqual(["全員無傷", "混乱なし", "先読み", "快速"]);
  });

  it("subtracts rescue, danger exposure, aim, and high-tension costs once", () => {
    const state = completeState();
    const victim = state.animals.find((animal) => animal.id === "coward-1");
    const predator = state.animals.find((animal) => animal.type === "predator");
    if (!victim || !predator) throw new Error("P6 score fixture is incomplete");
    victim.tension = 80;
    predator.phase = "aim";
    predator.targetId = victim.id;
    state.events = [
      {
        id: 1,
        type: "victimRescuePending",
        atSeconds: 10,
        subjectId: victim.id,
        reason: "first-valid-lunge",
      },
      {
        id: 2,
        type: "rescueSucceeded",
        atSeconds: 12,
        subjectId: victim.id,
        reason: "threat-signal",
      },
      {
        id: 3,
        type: "predatorAimStarted",
        atSeconds: 15,
        subjectId: predator.id,
        reason: victim.id,
      },
    ];

    const metrics = createP6RunMetrics();
    observeP6Run(metrics, state, 2);

    expect(metrics.rescueCount).toBe(1);
    expect(metrics.predatorAimCount).toBe(1);
    expect(metrics.highTensionAnimalSeconds).toBe(2);
    expect(metrics.dangerExposureSeconds).toBe(2);

    const result = calculateP6Result(metrics, state);
    expect(result.breakdown.safety).toBe(29900);
    expect(result.breakdown.judgement).toBe(17800);
    expect(result.totalScore).toBe(87700);
    expect(result.grade).toBe("A");
    expect(result.titles).toEqual(["先読み", "快速"]);
  });

  it("does not save an uncleared attempt and separates assisted records", () => {
    const storage = new MemoryStorage();
    const book = readP6RecordBook(storage);
    const failed = createP5Simulation();
    failed.status = "failed";
    failed.failureReason = "rescueTimeout";
    const failedResult = calculateP6Result(createP6RunMetrics(), failed);
    const unchanged = updateP6RecordBook(book, failedResult);
    expect(unchanged.standard).toBeNull();

    const standardState = completeState();
    const standard = calculateP6Result(createP6RunMetrics(false), standardState);
    const assisted = calculateP6Result(createP6RunMetrics(true), standardState);
    const withStandard = updateP6RecordBook(unchanged, standard);
    const withBoth = updateP6RecordBook(withStandard, assisted);
    writeP6RecordBook(withBoth, storage);

    const restored = readP6RecordBook(storage);
    expect(restored.standard?.mode).toBe("standard");
    expect(restored.assisted?.mode).toBe("assisted");
    expect(restored.standard?.bestScore).toBe(standard.totalScore);
    expect(restored.assisted?.bestScore).toBe(assisted.totalScore);
  });

  it("uses the slow-time floor after the 10-minute threshold", () => {
    const state = completeState();
    state.elapsedSeconds = 600;
    const result = calculateP6Result(createP6RunMetrics(), state);
    expect(result.breakdown.time).toBe(3000);
  });
});
