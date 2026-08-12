import { describe, expect, it } from "vitest";

import {
  P8DiagnosticRecorder,
  P8_DIAGNOSTIC_SCHEMA_VERSION,
  summarizeP8FrameTimes,
} from "./p8-diagnostics";

describe("P8 development diagnostics", () => {
  it("summarizes frame timing and the 95th percentile without changing samples", () => {
    const summary = summarizeP8FrameTimes([16, 17, 18, 40], 0.25, 33.4);

    expect(summary).toEqual({
      sampleCount: 4,
      minFrameMs: 16,
      averageFrameMs: 22.75,
      p95FrameMs: 40,
      maxFrameMs: 40,
      slowFrameCount: 1,
      droppedSimulationSeconds: 0.25,
    });
  });

  it("returns explicit empty values before a frame is measured", () => {
    expect(summarizeP8FrameTimes([])).toEqual({
      sampleCount: 0,
      minFrameMs: null,
      averageFrameMs: null,
      p95FrameMs: null,
      maxFrameMs: null,
      slowFrameCount: 0,
      droppedSimulationSeconds: 0,
    });
  });

  it("bounds samples and events while preserving a serializable report core", () => {
    const recorder = new P8DiagnosticRecorder({
      maxFrameSamples: 2,
      maxEvents: 2,
      slowFrameThresholdMs: 20,
    });
    recorder.recordFrame(0.01);
    recorder.recordFrame(0.02, 0.1);
    recorder.recordFrame(0.03);
    recorder.recordEvent("boot", 0);
    recorder.recordEvent("stage-start", 1.25, "stage-1");
    recorder.recordEvent("result", 2.5);

    expect(recorder.getPerformanceSummary()).toMatchObject({
      sampleCount: 2,
      minFrameMs: 20,
      maxFrameMs: 30,
      slowFrameCount: 2,
      droppedSimulationSeconds: 0.1,
    });
    expect(recorder.getEvents()).toEqual([
      { type: "stage-start", atSeconds: 1.25, detail: "stage-1" },
      { type: "result", atSeconds: 2.5 },
    ]);
    expect(JSON.stringify({
      schemaVersion: P8_DIAGNOSTIC_SCHEMA_VERSION,
      performance: recorder.getPerformanceSummary(),
      events: recorder.getEvents(),
    })).not.toContain("undefined");
  });
});
