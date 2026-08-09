import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_CATCH_UP_STEPS,
  DEFAULT_MAX_FRAME_SECONDS,
  FIXED_STEP_SECONDS,
  FixedStepSimulation,
} from "./fixed-step";

function simulateOneSecond(renderFramesPerSecond: number): {
  simulation: FixedStepSimulation;
  steps: number;
} {
  const simulation = new FixedStepSimulation();
  let steps = 0;
  const frameSeconds = 1 / renderFramesPerSecond;

  for (let frame = 0; frame < renderFramesPerSecond; frame += 1) {
    const result = simulation.advance(frameSeconds, () => {
      steps += 1;
    });
    expect(result.droppedSeconds).toBe(0);
  }

  return { simulation, steps };
}

describe("fixed-step simulation clock", () => {
  it.each([60, 30, 10])(
    "simulates one equivalent second at %i FPS",
    (renderFramesPerSecond) => {
      const { simulation, steps } = simulateOneSecond(renderFramesPerSecond);

      expect(steps).toBe(60);
      expect(simulation.simulatedTimeSeconds).toBeCloseTo(1, 10);
      expect(simulation.diagnostics.totalSteps).toBe(60);
      expect(simulation.diagnostics.droppedTimeSeconds).toBe(0);
    },
  );

  it("uses one 60 Hz slice for a normal render delta", () => {
    const simulation = new FixedStepSimulation();
    const result = simulation.advance(FIXED_STEP_SECONDS);

    expect(result.steps).toBe(1);
    expect(result.simulatedSeconds).toBeCloseTo(FIXED_STEP_SECONDS, 12);
    expect(result.accumulatorSeconds).toBe(0);
    expect(result.interpolationAlpha).toBe(0);
  });

  it("clamps a long frame and records dropped wall time", () => {
    const simulation = new FixedStepSimulation();
    const result = simulation.advance(1);

    expect(result.acceptedFrameSeconds).toBe(DEFAULT_MAX_FRAME_SECONDS);
    expect(simulation.diagnostics.lastFrameSeconds).toBe(1);
    expect(simulation.diagnostics.lastAcceptedFrameSeconds).toBe(
      DEFAULT_MAX_FRAME_SECONDS,
    );
    expect(simulation.diagnostics.droppedTimeSeconds).toBeGreaterThan(0.7);
    expect(
      simulation.simulatedTimeSeconds
        + simulation.diagnostics.droppedTimeSeconds
        + simulation.accumulatorSeconds,
    ).toBeCloseTo(1, 10);
  });

  it("bounds catch-up and resumes without carrying an old debt", () => {
    const simulation = new FixedStepSimulation({ maxCatchUpSteps: 4 });
    const callbacks: number[] = [];

    const longFrame = simulation.advance(10, (stepSeconds) => {
      callbacks.push(stepSeconds);
    });

    expect(longFrame.steps).toBe(4);
    expect(callbacks).toHaveLength(4);
    expect(simulation.diagnostics.lastStepCount).toBe(4);
    expect(simulation.diagnostics.droppedSteps).toBeGreaterThan(0);
    expect(simulation.diagnostics.droppedTimeSeconds).toBeGreaterThan(9);
    expect(simulation.accumulatorSeconds).toBe(0);

    const nextFrame = simulation.advance(FIXED_STEP_SECONDS);
    expect(nextFrame.steps).toBe(1);
    expect(simulation.diagnostics.totalSteps).toBe(5);
  });

  it("exposes interpolation and can clear debt without losing diagnostics", () => {
    const simulation = new FixedStepSimulation();
    const partial = simulation.advance(FIXED_STEP_SECONDS / 2);

    expect(partial.steps).toBe(0);
    expect(partial.interpolationAlpha).toBeCloseTo(0.5, 12);

    simulation.clearAccumulator();

    expect(simulation.accumulatorSeconds).toBe(0);
    expect(simulation.diagnostics.frameCount).toBe(1);
  });

  it("resets time, accumulator, and dropped-time diagnostics", () => {
    const simulation = new FixedStepSimulation();
    simulation.advance(1);
    expect(simulation.diagnostics.frameCount).toBe(1);

    simulation.reset();

    expect(simulation.diagnostics).toEqual({
      stepSeconds: FIXED_STEP_SECONDS,
      maxCatchUpSteps: DEFAULT_MAX_CATCH_UP_STEPS,
      maxFrameSeconds: DEFAULT_MAX_FRAME_SECONDS,
      frameCount: 0,
      totalSteps: 0,
      simulatedTimeSeconds: 0,
      accumulatorSeconds: 0,
      lastFrameSeconds: 0,
      lastAcceptedFrameSeconds: 0,
      lastStepCount: 0,
      lastDroppedTimeSeconds: 0,
      droppedTimeSeconds: 0,
      droppedSteps: 0,
    });
  });
});
