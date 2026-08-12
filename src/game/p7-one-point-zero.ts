import {
  calculateP6Result,
  type P6Grade,
  type P6RecordMode,
  type P6Result,
  type P6RunMetrics,
  type P6Storage,
} from "./p6-vertical-slice-completion";
import {
  type P5AnimalType,
  type P5EventType,
  type P5Route,
  type P5SimulationScenario,
  type P5SimulationState,
} from "./p5-vertical-slice-simulation";

export type P7StageId = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type P7RecordMode = P6RecordMode | "practice";
export type P7Grade = P6Grade;
export type P7FourthAnimalGate = "locked" | "eligible";

export interface P7StageDefinition {
  id: P7StageId;
  title: string;
  center: string;
  description: string;
  objective: string;
  simulation: P5SimulationScenario;
  isPractice: boolean;
}

export interface P7StageRecord {
  stageId: P7StageId;
  mode: P7RecordMode;
  bestScore: number;
  bestGrade: Exclude<P7Grade, "未クリア">;
  bestTimeSeconds: number;
  attempts: number;
}

export interface P7Progress {
  version: 1;
  completedStageIds: P7StageId[];
  unlockedStageIds: P7StageId[];
  records: Partial<Record<P7StageId, Partial<Record<P7RecordMode, P7StageRecord>>>>;
  fourthAnimalGate: P7FourthAnimalGate;
}

export interface P7Result extends P6Result {
  stageId: P7StageId;
}

export interface P7Storage extends P6Storage {}

export const P7_STAGE_IDS: readonly P7StageId[] = [0, 1, 2, 3, 4, 5, 6];

function scenario(
  cowardCount: number,
  followerCount: number,
  predatorCount: number,
  requiredRoutes: P5Route[] = [],
  requiredEvents: P5EventType[] = [],
  requiredRouteAnimalTypes: Partial<Record<P5Route, P5AnimalType>> = {},
  requiredEventSequence: P5EventType[] = [],
): P5SimulationScenario {
  return {
    cowardCount,
    followerCount,
    predatorCount,
    requiredRoutes,
    requiredEvents,
    requiredRouteAnimalTypes,
    requiredEventSequence,
  };
}

export const P7_STAGES: readonly P7StageDefinition[] = [
  {
    id: 0,
    title: "練習",
    center: "安全に操作を試す",
    description: "主人公を動かし、臆病種を囲いへ導く短い練習です。得点は参考表示です。",
    objective: "臆病種2体を囲いへ収容する",
    simulation: scenario(2, 0, 0),
    isPractice: true,
  },
  {
    id: 1,
    title: "1　接近圧力",
    center: "位置取りで動かす",
    description: "近づく距離と歩く速さを変え、臆病種の群れを整えます。",
    objective: "臆病種6体を広い囲いへ収容する",
    simulation: scenario(6, 0, 0),
    isPractice: false,
  },
  {
    id: 2,
    title: "2　誘導音と経路",
    center: "合図と地形を使う",
    description: "誘導音で追従種を動かし、浅い水を避けるか橋を使って進めます。",
    objective: "誘導音を使い、速い経路を発見して追従種4体を収容する",
    simulation: scenario(
      0,
      4,
      0,
      ["fast"],
      ["animalStartedFollowing"],
      { fast: "follower" },
    ),
    isPractice: false,
  },
  {
    id: 3,
    title: "3　危険管理",
    center: "危険種を先に隔離する",
    description: "狙いの予備動作を見て、威嚇音で危険種を主人公へ引きつけます。",
    objective: "威嚇音を使い、危険種と保護対象を専用囲いへ収容する",
    simulation: scenario(1, 0, 1, [], ["predatorThreatAccepted"]),
    isPractice: false,
  },
  {
    id: 4,
    title: "4　合図の副作用",
    center: "合図の順番を選ぶ",
    description: "誘導音で追従種を動かした後、威嚇音で危険種を引きつけます。順番を変えると状況も変わります。",
    objective: "誘導音の後に威嚇音を使い、6体を収容する",
    simulation: scenario(
      3,
      3,
      1,
      [],
      ["animalStartedFollowing", "predatorThreatAccepted"],
      {},
      ["animalStartedFollowing", "predatorThreatAccepted"],
    ),
    isPractice: false,
  },
  {
    id: 5,
    title: "5　群れの分裂",
    center: "狭い経路を順番に使う",
    description: "臆病種は安全経路、追従種は速い経路を使います。群れを一度に押し込まず、順番を選びます。",
    objective: "安全経路を臆病種、速い経路を追従種が通り、10体を収容する",
    simulation: scenario(
      6,
      4,
      0,
      ["safe", "fast"],
      [],
      { safe: "coward", fast: "follower" },
    ),
    isPractice: false,
  },
  {
    id: 6,
    title: "6　総合",
    center: "3種類を同時に管理する",
    description: "これまでの3種類、地形、2つの経路、2種類の合図を組み合わせます。",
    objective: "安全経路を臆病種、速い経路を追従種が通り、2種類の合図を使って11体を収容する",
    simulation: scenario(
      6,
      4,
      1,
      ["safe", "fast"],
      ["animalStartedFollowing", "predatorThreatAccepted"],
      { safe: "coward", fast: "follower" },
    ),
    isPractice: false,
  },
];

const PROGRESS_KEY = "oitate:p7:progress:v1";

function resolveStorage(storage?: P7Storage): P7Storage | null {
  if (storage) return storage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function isStageId(value: unknown): value is P7StageId {
  return value === 0 || value === 1 || value === 2 || value === 3
    || value === 4 || value === 5 || value === 6;
}

function uniqueStageIds(value: unknown, fallback: P7StageId[]): P7StageId[] {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.filter(isStageId))].sort((first, second) => first - second);
}

function isGrade(value: unknown): value is Exclude<P7Grade, "未クリア"> {
  return value === "S" || value === "A" || value === "B" || value === "C";
}

function isRecordMode(value: unknown): value is P7RecordMode {
  return value === "standard" || value === "assisted" || value === "practice";
}

function parseRecord(value: unknown, expectedMode?: P7RecordMode): P7StageRecord | null {
  const object = asObject(value);
  const mode = expectedMode ?? object?.mode;
  if (!object || !isStageId(object.stageId)
    || !isRecordMode(mode)
    || typeof object.bestScore !== "number"
    || !isGrade(object.bestGrade)
    || typeof object.bestTimeSeconds !== "number"
    || typeof object.attempts !== "number") {
    return null;
  }
  return {
    stageId: object.stageId,
    mode,
    bestScore: Math.max(0, Math.min(100_000, Math.round(object.bestScore))),
    bestGrade: object.bestGrade,
    bestTimeSeconds: Math.max(0, object.bestTimeSeconds),
    attempts: Math.max(0, Math.floor(object.attempts)),
  };
}

export function createP7Progress(): P7Progress {
  return {
    version: 1,
    completedStageIds: [],
    unlockedStageIds: [0, 1],
    records: {},
    fourthAnimalGate: "locked",
  };
}

export function readP7Progress(storage?: P7Storage): P7Progress {
  const source = resolveStorage(storage);
  const raw = source?.getItem(PROGRESS_KEY);
  if (!raw) return createP7Progress();
  try {
    const parsed = asObject(JSON.parse(raw));
    if (!parsed || parsed.version !== 1) return createP7Progress();
    const progress = createP7Progress();
    progress.completedStageIds = uniqueStageIds(parsed.completedStageIds, []);
    progress.unlockedStageIds = uniqueStageIds(parsed.unlockedStageIds, [0, 1]);
    if (!progress.unlockedStageIds.includes(0)) progress.unlockedStageIds.unshift(0);
    if (!progress.unlockedStageIds.includes(1)) progress.unlockedStageIds.push(1);
    const records = asObject(parsed.records);
    if (records) {
      for (const [key, value] of Object.entries(records)) {
        const stageId = Number(key);
        if (!isStageId(stageId)) continue;
        const directRecord = parseRecord(value);
        if (directRecord) {
          progress.records[stageId] = { [directRecord.mode]: directRecord };
          continue;
        }
        const recordSet = asObject(value);
        if (!recordSet) continue;
        const parsedSet: Partial<Record<P7RecordMode, P7StageRecord>> = {};
        for (const mode of ["standard", "assisted", "practice"] as const) {
          const record = parseRecord(recordSet[mode], mode);
          if (record) parsedSet[mode] = record;
        }
        if (Object.keys(parsedSet).length > 0) progress.records[stageId] = parsedSet;
      }
    }
    progress.fourthAnimalGate = parsed.fourthAnimalGate === "eligible" ? "eligible" : "locked";
    return progress;
  } catch {
    return createP7Progress();
  }
}

export function writeP7Progress(progress: P7Progress, storage?: P7Storage): void {
  const source = resolveStorage(storage);
  try {
    source?.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // A full or private storage area must not stop a play session.
  }
}

export function getP7Stage(stageId: P7StageId): P7StageDefinition {
  const stage = P7_STAGES.find((candidate) => candidate.id === stageId);
  if (!stage) throw new Error(`P7の面が見つかりません: ${stageId}`);
  return stage;
}

export function isP7StageUnlocked(progress: P7Progress, stageId: P7StageId): boolean {
  return progress.unlockedStageIds.includes(stageId);
}

export function isP7Complete(progress: P7Progress): boolean {
  return P7_STAGE_IDS.filter((stageId) => stageId > 0)
    .every((stageId) => progress.completedStageIds.includes(stageId));
}

export function calculateP7Result(
  stageId: P7StageId,
  metrics: P6RunMetrics,
  state: P5SimulationState,
): P7Result {
  return {
    ...calculateP6Result(metrics, state),
    stageId,
  };
}

function isBetterRecord(result: P7Result, record: P7StageRecord | undefined): boolean {
  if (!record) return true;
  return result.totalScore > record.bestScore
    || (result.totalScore === record.bestScore && result.elapsedSeconds < record.bestTimeSeconds);
}

export function updateP7Progress(progress: P7Progress, result: P7Result): P7Progress {
  if (!result.completed) return progress;
  const completedStageIds = progress.completedStageIds.includes(result.stageId)
    ? [...progress.completedStageIds]
    : [...progress.completedStageIds, result.stageId].sort((first, second) => first - second);
  const unlockedStageIds = [...progress.unlockedStageIds];
  const nextStage = result.stageId + 1;
  if (nextStage <= 6 && !unlockedStageIds.includes(nextStage as P7StageId)) {
    unlockedStageIds.push(nextStage as P7StageId);
    unlockedStageIds.sort((first, second) => first - second);
  }
  const mode: P7RecordMode = result.stageId === 0
    ? "practice"
    : result.assistedMode ? "assisted" : "standard";
  const previousRecords = progress.records[result.stageId] ?? {};
  const previous = previousRecords[mode];
  const better = isBetterRecord(result, previous);
  const record: P7StageRecord = {
    stageId: result.stageId,
    mode,
    bestScore: better ? result.totalScore : previous?.bestScore ?? result.totalScore,
    bestGrade: better ? result.grade as Exclude<P7Grade, "未クリア"> : previous?.bestGrade ?? "C",
    bestTimeSeconds: better
      ? result.elapsedSeconds
      : previous?.bestTimeSeconds ?? result.elapsedSeconds,
    attempts: (previous?.attempts ?? 0) + 1,
  };
  return {
    ...progress,
    completedStageIds,
    unlockedStageIds,
    records: {
      ...progress.records,
      [result.stageId]: { ...previousRecords, [mode]: record },
    },
    fourthAnimalGate: isP7Complete({ ...progress, completedStageIds }) ? "eligible" : progress.fourthAnimalGate,
  };
}

export function getP7StageRecord(
  progress: P7Progress,
  stageId: P7StageId,
  mode: P7RecordMode,
): P7StageRecord | null {
  return progress.records[stageId]?.[mode] ?? null;
}
