export const P8_DIAGNOSTIC_SCHEMA_VERSION = 1 as const;

export interface P8DiagnosticEvent {
  type: string;
  atSeconds: number;
  detail?: string;
}

export interface P8PerformanceSummary {
  sampleCount: number;
  minFrameMs: number | null;
  averageFrameMs: number | null;
  p95FrameMs: number | null;
  maxFrameMs: number | null;
  slowFrameCount: number;
  droppedSimulationSeconds: number;
}

export interface P8DiagnosticRecorderOptions {
  maxFrameSamples?: number;
  maxEvents?: number;
  slowFrameThresholdMs?: number;
}

const DEFAULT_MAX_FRAME_SAMPLES = 12_000;
const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_SLOW_FRAME_THRESHOLD_MS = 33.4;

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 1
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function positiveFiniteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function summarizeP8FrameTimes(
  frameTimesMs: readonly number[],
  droppedSimulationSeconds = 0,
  slowFrameThresholdMs = DEFAULT_SLOW_FRAME_THRESHOLD_MS,
): P8PerformanceSummary {
  const samples = frameTimesMs.filter((value) => Number.isFinite(value) && value > 0);
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      minFrameMs: null,
      averageFrameMs: null,
      p95FrameMs: null,
      maxFrameMs: null,
      slowFrameCount: 0,
      droppedSimulationSeconds: finiteNonNegative(droppedSimulationSeconds),
    };
  }

  const sorted = [...samples].sort((first, second) => first - second);
  const total = samples.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));

  return {
    sampleCount: samples.length,
    minFrameMs: sorted[0] ?? null,
    averageFrameMs: total / samples.length,
    p95FrameMs: sorted[p95Index] ?? null,
    maxFrameMs: sorted[sorted.length - 1] ?? null,
    slowFrameCount: samples.filter((value) => value >= slowFrameThresholdMs).length,
    droppedSimulationSeconds: finiteNonNegative(droppedSimulationSeconds),
  };
}

/**
 * Keeps only development-side performance samples and state-transition notes.
 * It never sends data anywhere; the caller decides whether to export a report.
 */
export class P8DiagnosticRecorder {
  private readonly maxFrameSamples: number;
  private readonly maxEvents: number;
  private readonly slowFrameThresholdMs: number;
  private frameTimesMs: number[] = [];
  private events: P8DiagnosticEvent[] = [];
  private droppedSimulationSeconds = 0;

  public constructor(options: P8DiagnosticRecorderOptions = {}) {
    this.maxFrameSamples = positiveIntegerOr(options.maxFrameSamples, DEFAULT_MAX_FRAME_SAMPLES);
    this.maxEvents = positiveIntegerOr(options.maxEvents, DEFAULT_MAX_EVENTS);
    this.slowFrameThresholdMs = positiveFiniteOr(
      options.slowFrameThresholdMs,
      DEFAULT_SLOW_FRAME_THRESHOLD_MS,
    );
  }

  public recordFrame(frameSeconds: number, droppedSimulationSeconds = 0): void {
    if (Number.isFinite(frameSeconds) && frameSeconds > 0) {
      this.frameTimesMs.push(frameSeconds * 1000);
      if (this.frameTimesMs.length > this.maxFrameSamples) this.frameTimesMs.shift();
    }
    this.droppedSimulationSeconds += finiteNonNegative(droppedSimulationSeconds);
  }

  public recordEvent(type: string, atSeconds: number, detail?: string): void {
    const event: P8DiagnosticEvent = {
      type,
      atSeconds: finiteNonNegative(atSeconds),
      ...(detail ? { detail } : {}),
    };
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();
  }

  public reset(): void {
    this.frameTimesMs = [];
    this.events = [];
    this.droppedSimulationSeconds = 0;
  }

  public getPerformanceSummary(): P8PerformanceSummary {
    return summarizeP8FrameTimes(
      this.frameTimesMs,
      this.droppedSimulationSeconds,
      this.slowFrameThresholdMs,
    );
  }

  public getEvents(): P8DiagnosticEvent[] {
    return this.events.map((event) => ({ ...event }));
  }
}
