/**
 * The simulation clock used by the P1 prototype.
 *
 * Rendering may run at any cadence, but simulation state is advanced in
 * discrete 60 Hz slices.  A frame is allowed to consume a bounded number of
 * slices.  When a tab is suspended or a frame takes too long, the excess is
 * deliberately discarded and reported in diagnostics instead of creating an
 * unbounded catch-up loop.
 */

export const FIXED_STEP_SECONDS = 1 / 60;
export const DEFAULT_MAX_CATCH_UP_STEPS = 8;
export const DEFAULT_MAX_FRAME_SECONDS = 0.25;

/** Short aliases are useful at call sites that already use fixed-step terms. */
export const FIXED_STEP = FIXED_STEP_SECONDS;
export const MAX_CATCH_UP_STEPS = DEFAULT_MAX_CATCH_UP_STEPS;
export const MAX_FRAME_SECONDS = DEFAULT_MAX_FRAME_SECONDS;

export interface FixedStepOptions {
  /** Length of one simulation slice. Defaults to 1/60 second. */
  stepSeconds?: number;
  /** Maximum simulation slices consumed by one render frame. */
  maxCatchUpSteps?: number;
  /** Maximum wall-clock delta accepted from one render frame. */
  maxFrameSeconds?: number;
  /** Optional callback invoked once for every consumed simulation slice. */
  onStep?: FixedStepCallback;
}

export interface FixedStepDiagnostics {
  stepSeconds: number;
  maxCatchUpSteps: number;
  maxFrameSeconds: number;
  frameCount: number;
  totalSteps: number;
  simulatedTimeSeconds: number;
  accumulatorSeconds: number;
  lastFrameSeconds: number;
  lastAcceptedFrameSeconds: number;
  lastStepCount: number;
  lastDroppedTimeSeconds: number;
  droppedTimeSeconds: number;
  droppedSteps: number;
}

export interface FixedStepUpdate {
  /** Number of fixed slices consumed during this call. */
  steps: number;
  /** Simulated time consumed during this call. */
  simulatedSeconds: number;
  /** Raw frame delta after the long-frame clamp. */
  acceptedFrameSeconds: number;
  /** Time intentionally not simulated during this call. */
  droppedSeconds: number;
  /** Fractional time carried into the next call. */
  accumulatorSeconds: number;
  /** Blend factor for rendering between the previous and current snapshots. */
  interpolationAlpha: number;
}

export type FixedStepCallback = (
  stepSeconds: number,
  simulatedTimeSeconds: number,
) => void;

function positiveFiniteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 1
    ? Math.max(1, Math.floor(value))
    : fallback;
}

/**
 * Accumulates render deltas and exposes a deterministic fixed-step clock.
 *
 * The callback is intentionally supplied with the fixed step rather than the
 * render delta.  This keeps movement, timers, and state transitions
 * independent of the display refresh rate.
 */
export class FixedStepSimulation {
  public readonly stepSeconds: number;
  public readonly maxCatchUpSteps: number;
  public readonly maxFrameSeconds: number;

  private readonly onStep?: FixedStepCallback;
  private accumulator = 0;
  private simulatedTime = 0;
  private frameCountValue = 0;
  private totalStepsValue = 0;
  private lastFrame = 0;
  private lastAcceptedFrame = 0;
  private lastStepCountValue = 0;
  private lastDroppedTime = 0;
  private droppedTime = 0;
  private droppedStepsValue = 0;

  public constructor(options: FixedStepOptions = {}) {
    this.stepSeconds = positiveFiniteOr(
      options.stepSeconds,
      FIXED_STEP_SECONDS,
    );
    this.maxCatchUpSteps = positiveIntegerOr(
      options.maxCatchUpSteps,
      DEFAULT_MAX_CATCH_UP_STEPS,
    );
    this.maxFrameSeconds = positiveFiniteOr(
      options.maxFrameSeconds,
      DEFAULT_MAX_FRAME_SECONDS,
    );
    this.onStep = options.onStep;
  }

  /**
   * Adds one render-frame delta and consumes zero or more fixed slices.
   * Negative, NaN, and infinite deltas are treated as zero.  A long frame is
   * clamped before it reaches the accumulator.
   */
  public advance(
    frameSeconds: number,
    onStep: FixedStepCallback | undefined = this.onStep,
  ): FixedStepUpdate {
    const safeFrameSeconds = Number.isFinite(frameSeconds) && frameSeconds > 0
      ? frameSeconds
      : 0;
    const acceptedFrameSeconds = Math.min(
      safeFrameSeconds,
      this.maxFrameSeconds,
    );
    let droppedThisFrame = safeFrameSeconds - acceptedFrameSeconds;

    this.frameCountValue += 1;
    this.lastFrame = safeFrameSeconds;
    this.lastAcceptedFrame = acceptedFrameSeconds;
    this.accumulator += acceptedFrameSeconds;

    // The small epsilon prevents 6 * (1 / 60) or 3 * (1 / 30) from losing a
    // step solely because of binary floating-point rounding.
    const availableSteps = Math.floor(
      (this.accumulator + this.stepSeconds * 1e-9) / this.stepSeconds,
    );
    const steps = Math.min(availableSteps, this.maxCatchUpSteps);

    for (let index = 0; index < steps; index += 1) {
      this.accumulator -= this.stepSeconds;
      this.simulatedTime += this.stepSeconds;
      this.totalStepsValue += 1;
      onStep?.(this.stepSeconds, this.simulatedTime);
    }

    if (availableSteps > steps) {
      // Catch-up is intentionally bounded.  Discard both whole slices over
      // the per-frame budget and the fractional remainder so an old tab does
      // not keep paying a simulation debt on every subsequent frame.
      const droppedCatchUpSteps = availableSteps - steps;
      this.droppedStepsValue += droppedCatchUpSteps;
      droppedThisFrame += Math.max(0, this.accumulator);
      this.accumulator = 0;
    }

    // Avoid exposing a tiny negative residue after repeated subtraction.
    if (this.accumulator < this.stepSeconds * 1e-8) {
      this.accumulator = 0;
    }

    this.lastStepCountValue = steps;
    this.lastDroppedTime = droppedThisFrame;
    this.droppedTime += droppedThisFrame;

    return {
      steps,
      simulatedSeconds: steps * this.stepSeconds,
      acceptedFrameSeconds,
      droppedSeconds: droppedThisFrame,
      accumulatorSeconds: this.accumulator,
      interpolationAlpha: Math.min(1, this.accumulator / this.stepSeconds),
    };
  }

  /** Clears only fractional debt, preserving session diagnostics. */
  public clearAccumulator(): void {
    this.accumulator = 0;
    this.lastStepCountValue = 0;
    this.lastDroppedTime = 0;
  }

  /** Clears simulation time, accumulator debt, and all diagnostics. */
  public reset(): void {
    this.accumulator = 0;
    this.simulatedTime = 0;
    this.frameCountValue = 0;
    this.totalStepsValue = 0;
    this.lastFrame = 0;
    this.lastAcceptedFrame = 0;
    this.lastStepCountValue = 0;
    this.lastDroppedTime = 0;
    this.droppedTime = 0;
    this.droppedStepsValue = 0;
  }

  public get simulatedTimeSeconds(): number {
    return this.simulatedTime;
  }

  public get accumulatorSeconds(): number {
    return this.accumulator;
  }

  public get diagnostics(): FixedStepDiagnostics {
    return {
      stepSeconds: this.stepSeconds,
      maxCatchUpSteps: this.maxCatchUpSteps,
      maxFrameSeconds: this.maxFrameSeconds,
      frameCount: this.frameCountValue,
      totalSteps: this.totalStepsValue,
      simulatedTimeSeconds: this.simulatedTime,
      accumulatorSeconds: this.accumulator,
      lastFrameSeconds: this.lastFrame,
      lastAcceptedFrameSeconds: this.lastAcceptedFrame,
      lastStepCount: this.lastStepCountValue,
      lastDroppedTimeSeconds: this.lastDroppedTime,
      droppedTimeSeconds: this.droppedTime,
      droppedSteps: this.droppedStepsValue,
    };
  }
}

/** Factory form for callers that prefer composition over `new`. */
export function createFixedStepSimulation(
  options: FixedStepOptions = {},
): FixedStepSimulation {
  return new FixedStepSimulation(options);
}

/** Semantic alias for systems that refer to the clock as an accumulator. */
export { FixedStepSimulation as FixedStepAccumulator };
