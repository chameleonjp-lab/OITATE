import type {
  P5AnimalType,
  P5Event,
  P5SimulationState,
} from "./p5-vertical-slice-simulation";

export type P6RecordMode = "standard" | "assisted";
export type P6Grade = "S" | "A" | "B" | "C" | "未クリア";

export interface P6Settings {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  assistedMode: boolean;
  largeControls: boolean;
}

export interface P6Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface P6RunMetrics {
  assistedMode: boolean;
  highTensionAnimalSeconds: number;
  dangerExposureSeconds: number;
  rescueCount: number;
  rescueFailureCount: number;
  predatorAimCount: number;
  processedEventCount: number;
  routeDiscoveries: Record<"safe" | "fast", boolean>;
  capturedCounts: Record<P5AnimalType, number>;
}

export interface P6ScoreBreakdown {
  safety: number;
  coordination: number;
  judgement: number;
  time: number;
}

export interface P6Result {
  completed: boolean;
  failureReason: P5SimulationState["failureReason"];
  assistedMode: boolean;
  elapsedSeconds: number;
  totalScore: number;
  grade: P6Grade;
  breakdown: P6ScoreBreakdown;
  titles: string[];
  primaryTitle: string;
  advice: string;
}

export interface P6Record {
  mode: P6RecordMode;
  bestScore: number;
  bestGrade: Exclude<P6Grade, "未クリア">;
  bestTimeSeconds: number;
  bestSafetyScore: number;
  titles: string[];
}

export interface P6RecordBook {
  introSeen: boolean;
  standard: P6Record | null;
  assisted: P6Record | null;
}

const RECORD_BOOK_KEY = "oitate:p6:record-book:v1";
const SETTINGS_KEY = "oitate:p6:settings:v1";

export const P6_SCORE_LIMITS = {
  safety: 40_000,
  coordination: 25_000,
  judgement: 20_000,
  time: 15_000,
  parTimeSeconds: 300,
  slowTimeSeconds: 600,
} as const;

export const DEFAULT_P6_SETTINGS: P6Settings = {
  soundEnabled: true,
  vibrationEnabled: true,
  assistedMode: false,
  largeControls: false,
};

function resolveStorage(storage?: P6Storage): P6Storage | null {
  if (storage) return storage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function emptyRecordBook(): P6RecordBook {
  return {
    introSeen: false,
    standard: null,
    assisted: null,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function isGrade(value: unknown): value is Exclude<P6Grade, "未クリア"> {
  return value === "S" || value === "A" || value === "B" || value === "C";
}

function parseRecord(value: unknown, mode: P6RecordMode): P6Record | null {
  const object = asObject(value);
  if (!object || typeof object.bestScore !== "number"
    || typeof object.bestGrade !== "string"
    || !isGrade(object.bestGrade)
    || typeof object.bestTimeSeconds !== "number"
    || typeof object.bestSafetyScore !== "number"
    || !Array.isArray(object.titles)) {
    return null;
  }
  return {
    mode,
    bestScore: Math.max(0, Math.round(object.bestScore)),
    bestGrade: object.bestGrade,
    bestTimeSeconds: Math.max(0, object.bestTimeSeconds),
    bestSafetyScore: Math.max(0, Math.round(object.bestSafetyScore)),
    titles: object.titles.filter((title): title is string => typeof title === "string").slice(0, 20),
  };
}

export function readP6RecordBook(storage?: P6Storage): P6RecordBook {
  const source = resolveStorage(storage);
  const raw = source?.getItem(RECORD_BOOK_KEY);
  if (!raw) return emptyRecordBook();
  try {
    const parsed = asObject(JSON.parse(raw));
    if (!parsed) return emptyRecordBook();
    return {
      introSeen: parsed.introSeen === true,
      standard: parseRecord(parsed.standard, "standard"),
      assisted: parseRecord(parsed.assisted, "assisted"),
    };
  } catch {
    return emptyRecordBook();
  }
}

export function writeP6RecordBook(book: P6RecordBook, storage?: P6Storage): void {
  const source = resolveStorage(storage);
  try {
    source?.setItem(RECORD_BOOK_KEY, JSON.stringify(book));
  } catch {
    // Private browsing or a full storage area must not stop a play session.
  }
}

export function readP6Settings(storage?: P6Storage): P6Settings {
  const source = resolveStorage(storage);
  const raw = source?.getItem(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_P6_SETTINGS };
  try {
    const parsed = asObject(JSON.parse(raw));
    if (!parsed) return { ...DEFAULT_P6_SETTINGS };
    return {
      soundEnabled: parsed.soundEnabled !== false,
      vibrationEnabled: parsed.vibrationEnabled !== false,
      assistedMode: parsed.assistedMode === true,
      largeControls: parsed.largeControls === true,
    };
  } catch {
    return { ...DEFAULT_P6_SETTINGS };
  }
}

export function writeP6Settings(settings: P6Settings, storage?: P6Storage): void {
  const source = resolveStorage(storage);
  try {
    source?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings are optional and must never block the game.
  }
}

export function markP6IntroSeen(book: P6RecordBook): P6RecordBook {
  return { ...book, introSeen: true };
}

export function createP6RunMetrics(assistedMode = false): P6RunMetrics {
  return {
    assistedMode,
    highTensionAnimalSeconds: 0,
    dangerExposureSeconds: 0,
    rescueCount: 0,
    rescueFailureCount: 0,
    predatorAimCount: 0,
    processedEventCount: 0,
    routeDiscoveries: { safe: false, fast: false },
    capturedCounts: { coward: 0, follower: 0, predator: 0 },
  };
}

function countNewEvents(metrics: P6RunMetrics, events: P5Event[]): void {
  for (const event of events.slice(metrics.processedEventCount)) {
    if (event.type === "victimRescuePending") metrics.rescueCount += 1;
    if (event.type === "rescueFailed") metrics.rescueFailureCount += 1;
    if (event.type === "predatorAimStarted") metrics.predatorAimCount += 1;
  }
  metrics.processedEventCount = events.length;
}

function updateCapturedCounts(
  metrics: P6RunMetrics,
  state: P5SimulationState,
): void {
  metrics.capturedCounts = {
    coward: state.animals.filter((animal) => animal.type === "coward"
      && animal.lifeState === "captured").length,
    follower: state.animals.filter((animal) => animal.type === "follower"
      && animal.lifeState === "captured").length,
    predator: state.animals.filter((animal) => animal.type === "predator"
      && animal.lifeState === "captured").length,
  };
}

export function observeP6Run(
  metrics: P6RunMetrics,
  state: P5SimulationState,
  deltaSeconds: number,
): void {
  const seconds = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
  const highTensionCount = state.animals.filter((animal) => animal.type !== "predator"
    && animal.lifeState !== "disabled"
    && animal.tension >= 60).length;
  metrics.highTensionAnimalSeconds += highTensionCount * seconds;
  const predator = state.animals.find((animal) => animal.type === "predator");
  if (predator && predator.targetId
    && (predator.phase === "chase" || predator.phase === "aim" || predator.phase === "lunge")) {
    metrics.dangerExposureSeconds += seconds;
  }
  countNewEvents(metrics, state.events);
  metrics.routeDiscoveries = { ...state.discoveredRoutes };
  updateCapturedCounts(metrics, state);
}

function clampScore(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, Math.round(value)));
}

function timeScore(elapsedSeconds: number): number {
  if (elapsedSeconds <= P6_SCORE_LIMITS.parTimeSeconds) return P6_SCORE_LIMITS.time;
  if (elapsedSeconds >= P6_SCORE_LIMITS.slowTimeSeconds) return 3_000;
  const ratio = (elapsedSeconds - P6_SCORE_LIMITS.parTimeSeconds)
    / (P6_SCORE_LIMITS.slowTimeSeconds - P6_SCORE_LIMITS.parTimeSeconds);
  return Math.round(P6_SCORE_LIMITS.time - 12_000 * ratio);
}

function getTitles(
  metrics: P6RunMetrics,
  state: P5SimulationState,
): string[] {
  if (state.status !== "completed") return ["再挑戦の準備"];
  const titles: string[] = [];
  if (metrics.rescueCount === 0) titles.push("全員無傷");
  if (metrics.highTensionAnimalSeconds < 0.1) titles.push("混乱なし");
  if (metrics.dangerExposureSeconds <= 6) titles.push("先読み");
  if (state.elapsedSeconds <= P6_SCORE_LIMITS.parTimeSeconds) titles.push("快速");
  if (titles.length === 0) titles.push("立て直しの達人");
  return titles;
}

function getAdvice(
  metrics: P6RunMetrics,
  state: P5SimulationState,
): string {
  if (state.status !== "completed" && state.failureReason === "rescueTimeout") {
    return "救助待ちになる前に、危険種へ威嚇音を使って主人公へ引きつけます。";
  }
  if (state.status !== "completed" && state.failureReason === "repeatedAttack") {
    return "救助した後は、危険種を先に専用の囲いへ隔離します。";
  }
  if (metrics.highTensionAnimalSeconds >= 8) {
    return "臆病種へ近づき続けず、少し距離を取って後ろから歩いて押します。";
  }
  if (metrics.dangerExposureSeconds >= 8 || metrics.predatorAimCount >= 2) {
    return "危険種が狙う前に、威嚇音で主人公へ引きつける準備をします。";
  }
  if (!metrics.routeDiscoveries.fast) {
    return "追従種へ誘導音を使い、中央の橋を通る速い経路も試します。";
  }
  if (state.elapsedSeconds > P6_SCORE_LIMITS.parTimeSeconds) {
    return "安全な経路を見つけたら、走行で移動時間を短くできます。";
  }
  return "種類ごとの反応を見て、次に動かす群れの後ろへ先回りします。";
}

function getGrade(
  totalScore: number,
  metrics: P6RunMetrics,
  state: P5SimulationState,
): P6Grade {
  if (state.status !== "completed") return "未クリア";
  if (totalScore >= 90_000 && metrics.rescueCount === 0) return "S";
  if (totalScore >= 75_000) return "A";
  if (totalScore >= 60_000) return "B";
  return "C";
}

export function calculateP6Result(
  metrics: P6RunMetrics,
  state: P5SimulationState,
): P6Result {
  const safety = clampScore(
    P6_SCORE_LIMITS.safety
      - metrics.rescueCount * 10_000
      - Math.min(8_000, metrics.highTensionAnimalSeconds * 50),
    P6_SCORE_LIMITS.safety,
  );
  const coordination = clampScore(
    10_000
      + Object.values(metrics.capturedCounts).filter((count) => count > 0).length * 5_000,
    P6_SCORE_LIMITS.coordination,
  );
  const judgement = clampScore(
    P6_SCORE_LIMITS.judgement
      - metrics.dangerExposureSeconds * 100
      - metrics.predatorAimCount * 2_000,
    P6_SCORE_LIMITS.judgement,
  );
  const time = state.status === "completed" ? timeScore(state.elapsedSeconds) : 0;
  const totalScore = state.status === "completed"
    ? safety + coordination + judgement + time
    : 0;
  const titles = getTitles(metrics, state);
  return {
    completed: state.status === "completed",
    failureReason: state.failureReason,
    assistedMode: metrics.assistedMode,
    elapsedSeconds: state.elapsedSeconds,
    totalScore,
    grade: getGrade(totalScore, metrics, state),
    breakdown: { safety, coordination, judgement, time },
    titles,
    primaryTitle: titles[0] ?? "堅実な誘導士",
    advice: getAdvice(metrics, state),
  };
}

function recordFromResult(result: P6Result): P6Record | null {
  if (!result.completed || result.grade === "未クリア") return null;
  return {
    mode: result.assistedMode ? "assisted" : "standard",
    bestScore: result.totalScore,
    bestGrade: result.grade,
    bestTimeSeconds: result.elapsedSeconds,
    bestSafetyScore: result.breakdown.safety,
    titles: result.titles,
  };
}

export function updateP6RecordBook(
  book: P6RecordBook,
  result: P6Result,
): P6RecordBook {
  const candidate = recordFromResult(result);
  const mode: P6RecordMode = result.assistedMode ? "assisted" : "standard";
  const previous = book[mode];
  const best = !candidate || (previous
    && (previous.bestScore > candidate.bestScore
      || (previous.bestScore === candidate.bestScore
        && previous.bestTimeSeconds <= candidate.bestTimeSeconds)))
    ? previous
    : candidate;
  const titles = Array.from(new Set([
    ...(previous?.titles ?? []),
    ...(candidate?.titles ?? []),
  ])).slice(0, 20);
  const merged = best
    ? { ...best, titles }
    : null;
  return {
    ...book,
    introSeen: true,
    [mode]: merged,
  };
}

export function formatP6Time(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return minutes + ":" + String(remainder).padStart(2, "0");
}
