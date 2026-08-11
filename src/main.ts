import * as THREE from "three";

import {
  InputController,
  isPortraitViewport,
  type LifecyclePauseReason,
  type LifecycleReturnReason,
  type SignalType,
} from "./game/input";
import {
  MovementDynamics,
  worldDirectionFromJoystick,
} from "./game/movement";
import {
  constrainCircleAgainstPenRails,
} from "./game/p2-cowardly-simulation";
import {
  createP3Simulation,
  P3_TUNING,
  stepP3Simulation,
  type P3AnimalState,
  type P3SimulationState,
} from "./game/p3-cowardly-simulation";
import {
  createP4Simulation,
  P4_TUNING,
  stepP4Simulation,
  type P4AttackPhase,
  type P4FailureReason,
  type P4PredatorIntent,
  type P4SimulationState,
  type P4VictimState,
} from "./game/p4-danger-simulation";
import {
  createP5Simulation,
  constrainP5CircleAgainstPens,
  P5_TUNING,
  stepP5Simulation,
  type P5AnimalPhase,
  type P5AnimalType,
  type P5FailureReason,
  type P5SimulationState,
} from "./game/p5-vertical-slice-simulation";
import { FixedStepSimulation } from "./game/fixed-step";
import {
  calculateP6Result,
  createP6RunMetrics,
  formatP6Time,
  markP6IntroSeen,
  observeP6Run,
  readP6RecordBook,
  readP6Settings,
  updateP6RecordBook,
  writeP6RecordBook,
  writeP6Settings,
  type P6Record,
  type P6Result,
  type P6Settings,
} from "./game/p6-vertical-slice-completion";
import "./styles.css";

interface P3PublicState {
  capturedCount: number;
  completed: boolean;
  decisionUpdates: number;
  penReservedAnimalId: string | null;
  flock: P3SimulationState["flock"];
  animals: Array<{
    id: string;
    phase: P3AnimalState["phase"];
    pressureBand: P3AnimalState["pressureBand"];
    tension: number;
    tensionState: P3AnimalState["tensionState"];
    confusionCause: P3AnimalState["confusionCause"];
    waitingSeconds: number;
    recoveryCount: number;
    fullBodyInside: boolean;
    x: number;
    z: number;
  }>;
}

interface P1State {
  paused: boolean;
  portrait: boolean;
  resumeRequired: boolean;
  player: { x: number; z: number; speed: number };
  cameraYaw: number;
  cameraInteractionSeconds: number;
  owners: ReturnType<InputController["getSnapshot"]>["pointerOwnership"];
  cancellationReason: string | null;
  rejectedPointerClaims: number;
  signalFireCount: number;
  simulationSteps: number;
  droppedSimulationSeconds: number;
  /** Kept under the old key for P1/P2 diagnostic compatibility. */
  p2: P3PublicState;
  p3: P3PublicState;
}

interface P3EntranceQueueProbe {
  /** Fixed fixture evidence for the body-aware entrance sweep. */
  entranceClearance: number;
  outerFaceZ: number;
  minimumAnimalSeparation: number;
  decisionStepSeconds: number;
  initialCandidates: Array<{ id: string; x: number; z: number }>;
  firstStepReservedAnimalId: string | null;
  firstStepAnimals: Array<{
    id: string;
    phase: P3AnimalState["phase"];
    x: number;
    z: number;
  }>;
  reservedAnimalId: string | null;
  enteringAnimalIds: string[];
  capturedCount: number;
}

interface P3E2ETestHooks {
  runCompletionReplay: () => void;
  probeEntranceQueue: () => P3EntranceQueueProbe;
}

interface P4PublicState {
  status: P4SimulationState["status"];
  failureReason: P4FailureReason;
  elapsedSeconds: number;
  predator: {
    id: string;
    attackPhase: P4AttackPhase;
    intent: P4PredatorIntent;
    x: number;
    z: number;
    threatSeconds: number;
    threatCooldownSeconds: number;
    threatResistanceSeconds: number;
    insidePen: boolean;
    captureHoldSeconds: number;
    playerDazedSeconds: number;
  };
  victim: Pick<
    P4VictimState,
    "id" | "lifeState" | "rescueSeconds" | "protectionSeconds" | "rescueCount" | "x" | "z"
  >;
  eventCount: number;
  lastEvent: P4SimulationState["events"][number] | null;
}

interface P4E2ETestHooks {
  primeAim: () => void;
  runRescueSuccess: () => void;
  runRescueFailure: () => void;
  runCaptureReplay: () => void;
}

interface P4PublicApi {
  getState: () => P4PublicState;
  retry: () => void;
  e2e?: P4E2ETestHooks;
}

interface P5PublicState {
  status: P5SimulationState["status"];
  failureReason: P5FailureReason;
  elapsedSeconds: number;
  capturedCount: Record<P5AnimalType, number>;
  discoveredRoutes: P5SimulationState["discoveredRoutes"];
  animals: Array<{
    id: string;
    type: P5AnimalType;
    phase: P5AnimalPhase;
    lifeState: P5SimulationState["animals"][number]["lifeState"];
    route: P5SimulationState["animals"][number]["route"];
    x: number;
    z: number;
  }>;
  eventCount: number;
  lastEvent: P5SimulationState["events"][number] | null;
}

interface P5E2ETestHooks {
  primeAim: () => void;
  runRescueSuccess: () => void;
  runRescueFailure: () => void;
  runRouteDiscovery: () => void;
  runCompletionReplay: () => void;
}

interface P5PublicApi {
  getState: () => P5PublicState;
  retry: () => void;
  e2e?: P5E2ETestHooks;
}

interface P6PublicState {
  status: P5SimulationState["status"];
  failureReason: P5FailureReason;
  introVisible: boolean;
  settingsVisible: boolean;
  resultVisible: boolean;
  settings: P6Settings;
  result: P6Result | null;
  record: P6Record | null;
}

interface P6E2ETestHooks {
  start: () => void;
  runCompletionReplay: () => void;
}

interface P6PublicApi {
  getState: () => P6PublicState;
  retry: () => void;
  e2e?: P6E2ETestHooks;
}

interface P3PublicApi {
  getState: () => P3PublicState;
  retry: () => void;
  /** Test-only actions are added only for ?p3-e2e=1 (or legacy ?p2-e2e=1). */
  e2e?: P3E2ETestHooks;
}

type P2PublicApi = P3PublicApi;

declare global {
  interface Window {
    __OITATE_P1__: {
      getState: () => P1State;
    };
    /** State access remains compatible with the P1 diagnostic surface. */
    __OITATE_P2__: P2PublicApi;
    __OITATE_P3__: P2PublicApi;
    __OITATE_P4__: P4PublicApi;
    __OITATE_P5__: P5PublicApi;
    __OITATE_P6__: P6PublicApi;
  }
}

function getAppRoot(): HTMLDivElement {
  const element = document.querySelector<HTMLDivElement>("#app");
  if (!element) throw new Error("OITATEの表示先が見つかりません。");
  return element;
}

const root = getAppRoot();

root.innerHTML = `
  <main class="p1-shell">
    <div class="interaction-layer" id="interaction-layer">
      <canvas class="game-canvas" aria-label="操作試作用の3D画面"></canvas>

      <header class="top-bar">
        <div>
          <p class="eyebrow p1-eyebrow">P1 操作試作</p>
          <p class="eyebrow p2-eyebrow">P3 最初に遊べる版</p>
          <p class="eyebrow p5-eyebrow">P5 縦切り統合版</p>
          <p class="eyebrow p6-eyebrow">P6 縦切り完成版</p>
          <h1>臆病種を囲いへ</h1>
        </div>
        <div class="top-actions">
          <button class="icon-button p6-settings-button" id="p6-settings-button" type="button" aria-label="設定" hidden>⚙</button>
          <button class="icon-button" type="button" data-action="pause" aria-label="一時停止">Ⅱ</button>
        </div>
      </header>

      <section class="p2-status" data-testid="p2-status" aria-live="polite" aria-label="P3試作の状態">
        <strong>動物の反応を観察する</strong>
        <span id="p2-status-text">6体の群れを観察し、囲いへ導きます</span>
        <span id="p2-count-text">収容 0 / 6</span>
      </section>

      <section class="p4-status" data-testid="p4-status" aria-live="polite" aria-label="P4危険検証版の状態" hidden>
        <strong>危険種を専用囲いへ</strong>
        <span id="p4-status-text">危険種を威嚇音で主人公へ引きつけます</span>
        <span id="p4-phase-text">索敵中</span>
      </section>

      <section class="p5-status" data-testid="p5-status" aria-live="polite" aria-label="P5縦切り統合版の状態" hidden>
        <strong>3種類11体を、それぞれの囲いへ</strong>
        <span id="p5-status-text">臆病種は接近、追従種は誘導音、危険種は威嚇音に反応します</span>
        <span id="p5-count-text">臆病 0 / 6　追従 0 / 4　危険 0 / 1</span>
        <span id="p5-danger-text">危険種：索敵　保護対象：待機中</span>
        <span id="p5-route-text">安全な経路 ○　速い経路 ○</span>
      </section>

      <section class="p6-status" data-testid="p6-status" aria-live="polite" aria-label="P6縦切り完成版の状態" hidden>
        <strong>1ステージを完成させる</strong>
        <span id="p6-status-text">説明を確認して開始します</span>
        <span id="p6-time-text">操作時間 0:00　標準</span>
        <span id="p6-record-text">最高記録 --</span>
      </section>

      <aside class="diagnostics" data-testid="diagnostics" aria-label="開発用診断">
        <strong>診断</strong>
        <span id="diag-fps">FPS --</span>
        <span id="diag-frame">フレーム -- ms</span>
        <span id="diag-speed">速度 0.00</span>
        <span id="diag-camera">手動カメラ 0.0秒 / 0%</span>
        <span id="diag-owners">指 移:– 視:– 誘:– 威:–</span>
        <span id="diag-cancel">解除 なし</span>
        <span id="diag-rejected">競合拒否 0</span>
        <span id="diag-signal">合図反応 -- ms</span>
        <span id="diag-simulation">固定更新 遅延破棄 0.000秒</span>
      </aside>

      <div class="world-label animal-label" aria-hidden="true">臆病種 × 6</div>
      <div class="world-label player-label" aria-hidden="true">主人公</div>
      <div class="signal-feedback" id="signal-feedback" aria-live="polite"></div>

      <div class="camera-zone" aria-label="右側カメラ操作領域" data-testid="camera-zone"></div>
      <div class="joystick-zone" aria-label="左側移動領域" data-testid="joystick-zone">
        <div class="joystick-base" aria-hidden="true">
          <div class="joystick-knob"></div>
        </div>
        <span class="zone-hint">ここに触れて移動</span>
      </div>

      <div class="signal-controls" aria-label="P1用入力回帰（P3では動物に効果なし）">
        <span class="signal-note">P1入力回帰<br />P3では効果なし</span>
        <button type="button" class="signal-button guidance" data-signal="guidance" data-signal-state="idle" data-fire-count="0">
          <span aria-hidden="true">♪</span><small>誘導</small>
        </button>
        <button type="button" class="signal-button threat" data-signal="threat" data-signal-state="idle" data-fire-count="0">
          <span aria-hidden="true">!</span><small>威嚇</small>
        </button>
      </div>

      <div class="p4-controls" aria-label="P4危険種操作" hidden>
        <span class="p4-control-note">危険種が狙いを始めたら、威嚇音で主人公へ引きつけます</span>
        <button type="button" class="p4-threat-button" id="p4-threat-button" aria-keyshortcuts="T">
          <span aria-hidden="true">!</span><small>威嚇音</small>
        </button>
      </div>

      <div class="p5-controls" aria-label="P5統合版の合図" hidden>
        <span class="p5-control-note">臆病種は距離、追従種は誘導音、危険種は威嚇音で動きます</span>
        <button class="p5-signal-button guidance" id="p5-guidance-button" type="button" aria-keyshortcuts="G">
          <span aria-hidden="true">♪</span><small>誘導音</small>
        </button>
        <button class="p5-signal-button threat" id="p5-threat-button" type="button" aria-keyshortcuts="T">
          <span aria-hidden="true">!</span><small>威嚇音</small>
        </button>
      </div>
    </div>

    <section class="blocking-overlay" id="orientation-overlay" role="dialog" aria-modal="true" aria-labelledby="orientation-title" tabindex="-1" hidden>
      <div class="overlay-card">
        <span class="rotate-icon" aria-hidden="true">↻</span>
        <h2 id="orientation-title">端末を横向きにしてください</h2>
        <p>回転すると入力をすべて解除し、続きから再開できます。</p>
      </div>
    </section>

    <section class="blocking-overlay" id="resume-overlay" role="dialog" aria-modal="true" aria-labelledby="resume-title" tabindex="-1" hidden>
      <div class="overlay-card">
        <p class="eyebrow" id="pause-reason">操作を停止しました</p>
        <h2 id="resume-title">入力を解除しました</h2>
        <p>意図しない移動を防ぐため、再開してから触れ直してください。</p>
        <button type="button" class="resume-button" data-action="resume">再開する</button>
      </div>
    </section>

    <section class="blocking-overlay" id="p2-complete-overlay" role="dialog" aria-modal="true" aria-labelledby="p2-complete-title" tabindex="-1" hidden>
      <div class="overlay-card">
        <p class="eyebrow">P3 最初に遊べる版</p>
        <h2 id="p2-complete-title">6体を囲いへ収容しました</h2>
        <p>群れのまとまりと入口の順番を考えながら、もう一度試せます。</p>
        <button type="button" class="resume-button" data-action="p2-retry">もう一度試す</button>
      </div>
    </section>

    <section class="blocking-overlay" id="p4-result-overlay" role="dialog" aria-modal="true" aria-labelledby="p4-result-title" tabindex="-1" hidden>
      <div class="overlay-card">
        <p class="eyebrow" id="p4-result-eyebrow">P4 危険検証版</p>
        <h2 id="p4-result-title">危険種を隔離しました</h2>
        <p id="p4-result-text">狙い、威嚇音、専用囲いの順番が成立しました。</p>
      <button type="button" class="resume-button" data-action="p4-retry">もう一度試す</button>
      </div>
    </section>

    <section class="blocking-overlay" id="p5-result-overlay" role="dialog" aria-modal="true" aria-labelledby="p5-result-title" tabindex="-1" hidden>
      <div class="overlay-card p5-result-card">
        <p class="eyebrow" id="p5-result-eyebrow">P5 縦切り統合版</p>
        <h2 id="p5-result-title">3種類を収容しました</h2>
        <p id="p5-result-text">安全な経路と速い経路を使い分けました。</p>
        <p id="p5-result-detail">結果は仮表示です。正式な得点はまだ固定していません。</p>
        <button class="resume-button" type="button" data-action="p5-retry">もう一度試す</button>
      </div>

    <section class="blocking-overlay p6-overlay" id="p6-intro-overlay" role="dialog" aria-modal="true" aria-labelledby="p6-intro-title" tabindex="-1" hidden>
      <div class="overlay-card p6-intro-card">
        <p class="eyebrow">P6 縦切り完成版</p>
        <h2 id="p6-intro-title">動物を直接命令せず、囲いへ導きます</h2>
        <p id="p6-intro-lead">最初の1回だけ、4つの反応を短く確認します。説明はいつでも飛ばせます。</p>
        <div class="p6-intro-steps" aria-label="初回説明">
          <div class="p6-intro-step"><b>1</b><span>左で主人公、右でカメラを動かします。</span></div>
          <div class="p6-intro-step"><b>2</b><span>臆病種の後ろへ立つと、反対へ動きます。</span></div>
          <div class="p6-intro-step"><b>3</b><span>追従種には誘導音、危険種には威嚇音を使います。</span></div>
        </div>
        <div class="p6-intro-actions">
          <button class="resume-button" type="button" data-action="p6-start">説明を確認して始める</button>
          <button class="text-button" type="button" data-action="p6-skip-intro">説明を飛ばして始める</button>
        </div>
      </div>
    </section>

    <section class="blocking-overlay p6-overlay" id="p6-settings-overlay" role="dialog" aria-modal="true" aria-labelledby="p6-settings-title" tabindex="-1" hidden>
      <div class="overlay-card p6-settings-card">
        <p class="eyebrow">P6 設定</p>
        <h2 id="p6-settings-title">遊び方を調整する</h2>
        <div class="p6-settings-list">
          <label class="p6-settings-option"><input id="p6-sound-toggle" type="checkbox" checked /> 音を使う</label>
          <label class="p6-settings-option"><input id="p6-vibration-toggle" type="checkbox" checked /> 振動を使う</label>
          <label class="p6-settings-option"><input id="p6-assist-toggle" type="checkbox" /> 補助あり（危険種の狙いを少し遅くする）</label>
          <label class="p6-settings-option"><input id="p6-large-controls-toggle" type="checkbox" /> 操作部品を大きくする</label>
        </div>
        <p class="p6-settings-note">補助ありの記録は、標準の記録と分けて保存します。</p>
        <button class="resume-button" type="button" data-action="p6-settings-close">設定を閉じる</button>
      </div>
    </section>

    <section class="blocking-overlay p6-overlay" id="p6-result-overlay" role="dialog" aria-modal="true" aria-labelledby="p6-result-title" tabindex="-1" hidden>
      <div class="overlay-card p6-result-card">
        <p class="eyebrow" id="p6-result-eyebrow">P6 縦切り完成版</p>
        <h2 id="p6-result-title">結果</h2>
        <p id="p6-result-score" class="p6-result-score">未クリア</p>
        <p id="p6-result-grade" class="p6-result-grade">評価 —</p>
        <p id="p6-result-title-text" class="p6-result-title-text">記録を確認してください</p>
        <div class="p6-score-grid" aria-label="得点内訳">
          <div><span>安全</span><b id="p6-score-safety">—</b><small>/ 40,000</small></div>
          <div><span>統率</span><b id="p6-score-coordination">—</b><small>/ 25,000</small></div>
          <div><span>判断</span><b id="p6-score-judgement">—</b><small>/ 20,000</small></div>
          <div><span>時間</span><b id="p6-score-time">—</b><small>/ 15,000</small></div>
        </div>
        <p id="p6-result-advice" class="p6-result-advice">次回の助言</p>
        <p id="p6-result-record" class="p6-result-record">記録なし</p>
        <div class="p6-result-actions">
          <button class="resume-button" type="button" data-action="p6-retry">もう一度試す</button>
          <button class="text-button" type="button" data-action="p6-result-settings">設定</button>
        </div>
      </div>
    </section>
  </main>
`;

const required = <T extends Element>(selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`P1画面の要素が見つかりません: ${selector}`);
  return element;
};

const canvas = required<HTMLCanvasElement>(".game-canvas");
const interactionLayer = required<HTMLElement>("#interaction-layer");
const orientationOverlay = required<HTMLElement>("#orientation-overlay");
const resumeOverlay = required<HTMLElement>("#resume-overlay");
const pauseReason = required<HTMLElement>("#pause-reason");
const resumeButton = required<HTMLButtonElement>("[data-action='resume']");
const pauseButton = required<HTMLButtonElement>("[data-action='pause']");
const feedback = required<HTMLElement>("#signal-feedback");
const p2Status = required<HTMLElement>(".p2-status");
const p2StatusText = required<HTMLElement>("#p2-status-text");
const p2CountText = required<HTMLElement>("#p2-count-text");
const p2CompleteOverlay = required<HTMLElement>("#p2-complete-overlay");
const p2RetryButton = required<HTMLButtonElement>("[data-action='p2-retry']");
const p4Status = required<HTMLElement>(".p4-status");
const p4StatusText = required<HTMLElement>("#p4-status-text");
const p4PhaseText = required<HTMLElement>("#p4-phase-text");
const p4Controls = required<HTMLElement>(".p4-controls");
const p4ThreatButton = required<HTMLButtonElement>("#p4-threat-button");
const p4ResultOverlay = required<HTMLElement>("#p4-result-overlay");
const p4ResultEyebrow = required<HTMLElement>("#p4-result-eyebrow");
const p4ResultTitle = required<HTMLElement>("#p4-result-title");
const p4ResultText = required<HTMLElement>("#p4-result-text");
const p4RetryButton = required<HTMLButtonElement>("[data-action='p4-retry']");
const p5Status = required<HTMLElement>(".p5-status");
const p5StatusText = required<HTMLElement>("#p5-status-text");
const p5CountText = required<HTMLElement>("#p5-count-text");
const p5DangerText = required<HTMLElement>("#p5-danger-text");
const p5RouteText = required<HTMLElement>("#p5-route-text");
const p5Controls = required<HTMLElement>(".p5-controls");
const p5GuidanceButton = required<HTMLButtonElement>("#p5-guidance-button");
const p5ThreatButton = required<HTMLButtonElement>("#p5-threat-button");
const p5ResultOverlay = required<HTMLElement>("#p5-result-overlay");
const p5ResultEyebrow = required<HTMLElement>("#p5-result-eyebrow");
const p5ResultTitle = required<HTMLElement>("#p5-result-title");
const p5ResultText = required<HTMLElement>("#p5-result-text");
const p5ResultDetail = required<HTMLElement>("#p5-result-detail");
const p5RetryButton = required<HTMLButtonElement>("[data-action='p5-retry']");
const p6Status = required<HTMLElement>(".p6-status");
const p6StatusText = required<HTMLElement>("#p6-status-text");
const p6TimeText = required<HTMLElement>("#p6-time-text");
const p6RecordText = required<HTMLElement>("#p6-record-text");
const p6SettingsButton = required<HTMLButtonElement>("#p6-settings-button");
const p6IntroOverlay = required<HTMLElement>("#p6-intro-overlay");
const p6IntroLead = required<HTMLElement>("#p6-intro-lead");
const p6IntroSteps = required<HTMLElement>(".p6-intro-steps");
const p6StartButton = required<HTMLButtonElement>("[data-action='p6-start']");
const p6SkipIntroButton = required<HTMLButtonElement>("[data-action='p6-skip-intro']");
const p6SettingsOverlay = required<HTMLElement>("#p6-settings-overlay");
const p6SoundToggle = required<HTMLInputElement>("#p6-sound-toggle");
const p6VibrationToggle = required<HTMLInputElement>("#p6-vibration-toggle");
const p6AssistToggle = required<HTMLInputElement>("#p6-assist-toggle");
const p6LargeControlsToggle = required<HTMLInputElement>("#p6-large-controls-toggle");
const p6SettingsCloseButton = required<HTMLButtonElement>("[data-action='p6-settings-close']");
const p6ResultOverlay = required<HTMLElement>("#p6-result-overlay");
const p6ResultEyebrow = required<HTMLElement>("#p6-result-eyebrow");
const p6ResultTitle = required<HTMLElement>("#p6-result-title");
const p6ResultScore = required<HTMLElement>("#p6-result-score");
const p6ResultGrade = required<HTMLElement>("#p6-result-grade");
const p6ResultTitleText = required<HTMLElement>("#p6-result-title-text");
const p6ScoreSafety = required<HTMLElement>("#p6-score-safety");
const p6ScoreCoordination = required<HTMLElement>("#p6-score-coordination");
const p6ScoreJudgement = required<HTMLElement>("#p6-score-judgement");
const p6ScoreTime = required<HTMLElement>("#p6-score-time");
const p6ResultAdvice = required<HTMLElement>("#p6-result-advice");
const p6ResultRecord = required<HTMLElement>("#p6-result-record");
const p6RetryButton = required<HTMLButtonElement>("[data-action='p6-retry']");
const p6ResultSettingsButton = required<HTMLButtonElement>("[data-action='p6-result-settings']");
const signalControls = required<HTMLElement>(".signal-controls");
const query = new URLSearchParams(window.location.search);
const p1ProbeEnabled = query.get("p1-probe") === "1";
const p6Mode = query.get("p6") === "1";
const p5Mode = !p6Mode && query.get("p5") === "1";
const p5WorldMode = p5Mode || p6Mode;
const p4Mode = !p5WorldMode && query.get("p4") === "1";
const p3E2EEnabled = import.meta.env.DEV
  && (query.get("p3-e2e") === "1" || query.get("p2-e2e") === "1");
const p4E2EEnabled = import.meta.env.DEV && p4Mode && query.get("p4-e2e") === "1";
const p5E2EEnabled = import.meta.env.DEV && p5Mode && query.get("p5-e2e") === "1";
const p6E2EEnabled = import.meta.env.DEV && p6Mode && query.get("p6-e2e") === "1";
const debugEnabled = p1ProbeEnabled || query.get("debug") === "1";
signalControls.hidden = !p1ProbeEnabled;
p2Status.hidden = p4Mode || p5WorldMode;
p4Status.hidden = !p4Mode;
p4Controls.hidden = !p4Mode;
p5Status.hidden = !p5Mode;
p5Controls.hidden = !p5WorldMode;
p6Status.hidden = !p6Mode;
p6SettingsButton.hidden = !p6Mode;
required<HTMLElement>("h1").textContent = p6Mode
  ? "3種類を囲いへ"
  : p5Mode
    ? "3種類を囲いへ"
    : p4Mode
      ? "危険種を囲いへ"
      : "臆病種を囲いへ";
root.querySelector<HTMLElement>(".p1-eyebrow")?.toggleAttribute("hidden", !p1ProbeEnabled);
root.querySelector<HTMLElement>(".p2-eyebrow")?.toggleAttribute("hidden", p4Mode || p5WorldMode);
root.querySelector<HTMLElement>(".p5-eyebrow")?.toggleAttribute("hidden", !p5Mode);
root.querySelector<HTMLElement>(".p6-eyebrow")?.toggleAttribute("hidden", !p6Mode);
root.classList.toggle("p4-mode", p4Mode);
root.classList.toggle("p5-mode", p5WorldMode);
root.classList.toggle("p6-mode", p6Mode);
const diagnostics = {
  fps: required<HTMLElement>("#diag-fps"),
  frame: required<HTMLElement>("#diag-frame"),
  speed: required<HTMLElement>("#diag-speed"),
  camera: required<HTMLElement>("#diag-camera"),
  owners: required<HTMLElement>("#diag-owners"),
  cancel: required<HTMLElement>("#diag-cancel"),
  rejected: required<HTMLElement>("#diag-rejected"),
  signal: required<HTMLElement>("#diag-signal"),
  simulation: required<HTMLElement>("#diag-simulation"),
};
root.querySelector<HTMLElement>(".diagnostics")?.toggleAttribute("hidden", !debugEnabled);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x173c3c);
scene.fog = new THREE.Fog(0x173c3c, 22, 44);

const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 80);
const hemiLight = new THREE.HemisphereLight(0xdff7ff, 0x36523a, 2.1);
scene.add(hemiLight);
const sun = new THREE.DirectionalLight(0xfff1cf, 2.4);
sun.position.set(-6, 12, 8);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(36, 36),
  new THREE.MeshStandardMaterial({ color: 0x5d875c, roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const grid = new THREE.GridHelper(36, 18, 0xb7d694, 0x789b67);
grid.position.y = 0.012;
scene.add(grid);

const player = new THREE.Group();
const playerBody = new THREE.Mesh(
  new THREE.CylinderGeometry(0.4, 0.52, 1.15, 10),
  new THREE.MeshStandardMaterial({ color: 0x6b63d9, roughness: 0.7 }),
);
playerBody.position.y = 0.65;
const playerHead = new THREE.Mesh(
  new THREE.SphereGeometry(0.36, 12, 8),
  new THREE.MeshStandardMaterial({ color: 0xe9c7a2, roughness: 0.8 }),
);
playerHead.position.set(0, 1.43, -0.08);
const playerFacing = new THREE.Mesh(
  new THREE.ConeGeometry(0.18, 0.5, 6),
  new THREE.MeshStandardMaterial({ color: 0xffd764 }),
);
playerFacing.rotation.x = -Math.PI / 2;
playerFacing.position.set(0, 0.74, -0.65);
player.add(playerBody, playerHead, playerFacing);
player.position.set(0, 0, 4.5);
scene.add(player);

interface CowardVisual {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  reactionRing: THREE.Mesh;
  escapeArrow: THREE.Mesh;
}

const cowardVisualColors = [
  0xf0ead8,
  0xd7f0df,
  0xf3d6b6,
  0xe5d4f0,
  0xf0e0b8,
  0xcfe7ee,
] as const;
const cowardVisuals: CowardVisual[] = [];

function createCowardVisual(index: number): CowardVisual {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.7, 1.3),
    new THREE.MeshStandardMaterial({
      color: cowardVisualColors[index] ?? cowardVisualColors[0],
      roughness: 0.95,
    }),
  );
  body.position.y = 0.72;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.58, 0.62),
    new THREE.MeshStandardMaterial({ color: 0xc98c58, roughness: 0.9 }),
  );
  head.position.set(0, 0.8, -0.84);
  group.add(body, head);
  for (const x of [-0.35, 0.35]) {
    for (const z of [-0.42, 0.42]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.54, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x6e4d39, roughness: 0.9 }),
      );
      leg.position.set(x, 0.27, z);
      group.add(leg);
    }
  }
  const reactionRing = new THREE.Mesh(
    new THREE.RingGeometry(0.68, 0.78, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffe085,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  reactionRing.rotation.x = -Math.PI / 2;
  reactionRing.position.y = 0.08;
  reactionRing.visible = false;
  group.add(reactionRing);
  const escapeArrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.68, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe085, transparent: true, opacity: 0.95 }),
  );
  escapeArrow.position.y = 0.42;
  escapeArrow.visible = false;
  group.add(escapeArrow);
  scene.add(group);
  const visual = { group, body, head, reactionRing, escapeArrow };
  cowardVisuals.push(visual);
  return visual;
}

for (let index = 0; index < P3_TUNING.animalCount; index += 1) {
  createCowardVisual(index);
}

const penVisual = new THREE.Group();
const penFloor = new THREE.Mesh(
  new THREE.BoxGeometry(10.4, 0.12, 5.2),
  new THREE.MeshStandardMaterial({ color: 0x86b86c, roughness: 0.9, transparent: true, opacity: 0.72 }),
);
penFloor.position.set(0, 0.06, -8.3);
penVisual.add(penFloor);
const penRailMaterial = new THREE.MeshStandardMaterial({ color: 0xc7a46c, roughness: 0.85 });
for (const x of [-5.15, 5.15]) {
  for (const z of [-10.9, -8.3, -5.7]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.6, 8), penRailMaterial);
    post.position.set(x, 0.8, z);
    penVisual.add(post);
  }
}
for (const x of [-1.7, 1.7]) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.6, 8), penRailMaterial);
  post.position.set(x, 0.8, -5.7);
  penVisual.add(post);
}
const backRail = new THREE.Mesh(new THREE.BoxGeometry(10.3, 0.16, 0.16), penRailMaterial);
backRail.position.set(0, 1.35, -10.9);
penVisual.add(backRail);
for (const x of [-5.15, 5.15]) {
  const sideRail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 5.2), penRailMaterial);
  sideRail.position.set(x, 1.35, -8.3);
  penVisual.add(sideRail);
}
for (const x of [-3.42, 3.42]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(3.45, 0.16, 0.16), penRailMaterial);
  rail.position.set(x, 1.35, -5.7);
  penVisual.add(rail);
}
scene.add(penVisual);

interface P4Visual {
  group: THREE.Group;
  body: THREE.Mesh;
  warningRing: THREE.Mesh;
  intentArrow: THREE.Mesh;
}

function createP4ActorVisual(
  bodyColor: number,
  ringColor: number,
  scale: number,
): P4Visual {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.58 * scale, 14, 10),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.8 }),
  );
  body.position.y = 0.72 * scale;
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.12 * scale, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff4dc }),
  );
  eye.position.set(0, 0.87 * scale, -0.48 * scale);
  const warningRing = new THREE.Mesh(
    new THREE.RingGeometry(0.72 * scale, 0.84 * scale, 28),
    new THREE.MeshBasicMaterial({
      color: ringColor,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    }),
  );
  warningRing.rotation.x = -Math.PI / 2;
  warningRing.position.y = 0.08;
  warningRing.visible = false;
  const intentArrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.17 * scale, 0.7 * scale, 6),
    new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.95 }),
  );
  intentArrow.position.y = 0.56 * scale;
  intentArrow.visible = false;
  group.add(body, eye, warningRing, intentArrow);
  scene.add(group);
  return { group, body, warningRing, intentArrow };
}

const p4PenVisual = new THREE.Group();
const p4Pen = P4_TUNING.pen;
const p4PenFloor = new THREE.Mesh(
  new THREE.BoxGeometry(p4Pen.halfWidth * 2, 0.12, p4Pen.halfDepth * 2),
  new THREE.MeshStandardMaterial({ color: 0x8c6d66, roughness: 0.88, transparent: true, opacity: 0.76 }),
);
p4PenFloor.position.set(p4Pen.centerX, 0.06, p4Pen.centerZ);
p4PenVisual.add(p4PenFloor);
const p4PenRailMaterial = new THREE.MeshStandardMaterial({ color: 0xf09a7e, roughness: 0.78 });
for (const x of [p4Pen.centerX - p4Pen.halfWidth, p4Pen.centerX + p4Pen.halfWidth]) {
  for (const z of [p4Pen.centerZ - p4Pen.halfDepth, p4Pen.entranceZ]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 1.8, 8), p4PenRailMaterial);
    post.position.set(x, 0.9, z);
    p4PenVisual.add(post);
  }
}
const p4BackRail = new THREE.Mesh(
  new THREE.BoxGeometry(p4Pen.halfWidth * 2, 0.18, 0.18),
  p4PenRailMaterial,
);
p4BackRail.position.set(p4Pen.centerX, 1.45, p4Pen.centerZ - p4Pen.halfDepth);
p4PenVisual.add(p4BackRail);
for (const x of [p4Pen.centerX - p4Pen.halfWidth, p4Pen.centerX + p4Pen.halfWidth]) {
  const sideRail = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, p4Pen.halfDepth * 2),
    p4PenRailMaterial,
  );
  sideRail.position.set(x, 1.45, p4Pen.centerZ - p4Pen.halfDepth / 2);
  p4PenVisual.add(sideRail);
}
const p4FrontRailLength = p4Pen.halfWidth - p4Pen.entranceHalfWidth;
for (const x of [
  p4Pen.centerX - (p4Pen.halfWidth + p4Pen.entranceHalfWidth) / 2,
  p4Pen.centerX + (p4Pen.halfWidth + p4Pen.entranceHalfWidth) / 2,
]) {
  const frontRail = new THREE.Mesh(
    new THREE.BoxGeometry(p4FrontRailLength, 0.18, 0.18),
    p4PenRailMaterial,
  );
  frontRail.position.x = x;
  frontRail.position.y = 1.45;
  frontRail.position.z = p4Pen.entranceZ;
  p4PenVisual.add(frontRail);
}
scene.add(p4PenVisual);

const p4PredatorVisual = createP4ActorVisual(0xe56f61, 0xffb38e, 1.1);
const p4VictimVisual = createP4ActorVisual(0x7cc9d8, 0x9fe8f0, 0.82);

function createP5PenVisual(
  pen: P5SimulationState["pens"][P5AnimalType],
  floorColor: number,
  railColor: number,
): THREE.Group {
  const group = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(pen.halfWidth * 2, 0.12, pen.halfDepth * 2),
    new THREE.MeshStandardMaterial({
      color: floorColor,
      roughness: 0.9,
      transparent: true,
      opacity: 0.76,
    }),
  );
  floor.position.set(pen.centerX, 0.06, pen.centerZ);
  group.add(floor);
  const railMaterial = new THREE.MeshStandardMaterial({ color: railColor, roughness: 0.82 });
  const leftX = pen.centerX - pen.halfWidth;
  const rightX = pen.centerX + pen.halfWidth;
  const backZ = pen.centerZ - pen.halfDepth;
  const frontZ = pen.entranceZ;
  for (const x of [leftX, rightX]) {
    for (const z of [backZ, frontZ]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.5, 8), railMaterial);
      post.position.set(x, 0.75, z);
      group.add(post);
    }
    const side = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.15, pen.halfDepth * 2),
      railMaterial,
    );
    side.position.set(x, 1.28, pen.centerZ - pen.halfDepth / 2);
    group.add(side);
  }
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(pen.halfWidth * 2, 0.15, 0.15),
    railMaterial,
  );
  back.position.set(pen.centerX, 1.28, backZ);
  group.add(back);
  const railLength = pen.halfWidth - pen.entranceHalfWidth;
  for (const x of [
    pen.centerX - (pen.halfWidth + pen.entranceHalfWidth) / 2,
    pen.centerX + (pen.halfWidth + pen.entranceHalfWidth) / 2,
  ]) {
    const front = new THREE.Mesh(new THREE.BoxGeometry(railLength, 0.15, 0.15), railMaterial);
    front.position.set(x, 1.28, frontZ);
    group.add(front);
  }
  scene.add(group);
  return group;
}

const p5TerrainVisual = new THREE.Group();
const p5Water = new THREE.Mesh(
  new THREE.PlaneGeometry(
    P5_TUNING.terrain.water.maxX - P5_TUNING.terrain.water.minX,
    P5_TUNING.terrain.water.maxZ - P5_TUNING.terrain.water.minZ,
  ),
  new THREE.MeshStandardMaterial({ color: 0x3f9fc2, roughness: 0.32, transparent: true, opacity: 0.78 }),
);
p5Water.rotation.x = -Math.PI / 2;
p5Water.position.set(
  (P5_TUNING.terrain.water.minX + P5_TUNING.terrain.water.maxX) / 2,
  0.035,
  (P5_TUNING.terrain.water.minZ + P5_TUNING.terrain.water.maxZ) / 2,
);
p5TerrainVisual.add(p5Water);
const p5Bridge = new THREE.Mesh(
  new THREE.PlaneGeometry(
    P5_TUNING.terrain.bridge.maxX - P5_TUNING.terrain.bridge.minX,
    P5_TUNING.terrain.bridge.maxZ - P5_TUNING.terrain.bridge.minZ,
  ),
  new THREE.MeshStandardMaterial({ color: 0xc59b61, roughness: 0.82 }),
);
p5Bridge.rotation.x = -Math.PI / 2;
p5Bridge.position.set(
  (P5_TUNING.terrain.bridge.minX + P5_TUNING.terrain.bridge.maxX) / 2,
  0.055,
  (P5_TUNING.terrain.bridge.minZ + P5_TUNING.terrain.bridge.maxZ) / 2,
);
p5TerrainVisual.add(p5Bridge);
scene.add(p5TerrainVisual);

const p5PenVisuals: Record<P5AnimalType, THREE.Group> = {
  coward: createP5PenVisual(P5_TUNING.pens.coward, 0x83b86d, 0xb6e48c),
  follower: createP5PenVisual(P5_TUNING.pens.follower, 0x6c9dcc, 0x9dd6ee),
  predator: createP5PenVisual(P5_TUNING.pens.predator, 0x9b6e69, 0xf09a7e),
};
const p5FollowerVisuals: P4Visual[] = [];
for (let index = 0; index < P5_TUNING.followerCount; index += 1) {
  p5FollowerVisuals.push(createP4ActorVisual(0x8c98e8, 0xb6b8ff, 0.9));
}
const p5PredatorVisual = createP4ActorVisual(0xe56f61, 0xffb38e, 1.08);
p5TerrainVisual.visible = p5WorldMode;
for (const visual of Object.values(p5PenVisuals)) visual.visible = p5WorldMode;
p4PenVisual.visible = p4Mode;
p4PredatorVisual.group.visible = p4Mode;
p4VictimVisual.group.visible = p4Mode;
for (const visual of cowardVisuals) visual.group.visible = !p4Mode && !p5WorldMode;
for (const visual of p5FollowerVisuals) visual.group.visible = p5WorldMode;
p5PredatorVisual.group.visible = p5WorldMode;

let paused = false;
let portrait = isPortraitViewport();
let resumeRequired = false;
let signalFireCount = 0;
let lastSignalLatency = 0;
let cameraInteractionSeconds = 0;
let activePlaySeconds = 0;
let lastFrameTime = performance.now();
let fpsFrames = 0;
let fpsElapsed = 0;
let displayedFps = 0;
let displayedFrameMs = 0;

const movement = new MovementDynamics();
const fixedStep = new FixedStepSimulation();
const simulationPosition = player.position.clone();
const previousSimulationPosition = simulationPosition.clone();
let simulationRotationY = player.rotation.y;
let p3Simulation: P3SimulationState = createP3Simulation();
const P3_DECISION_SECONDS = P3_TUNING.decisionStepSeconds;
let p4Simulation: P4SimulationState = createP4Simulation();
const P4_DECISION_SECONDS = P4_TUNING.decisionStepSeconds;
let p5Simulation: P5SimulationState = createP5Simulation();
const P5_DECISION_SECONDS = P5_TUNING.decisionStepSeconds;
const PLAYER_COLLISION_RADIUS = 0.52;
let p3DecisionAccumulator = 0;
let p3DecisionUpdates = 0;
let p3CompleteShown = false;
let p4DecisionAccumulator = 0;
let p4DecisionUpdates = 0;
let p4PendingThreatSignal = false;
let p4ResultShown = false;
let p5DecisionAccumulator = 0;
let p5DecisionUpdates = 0;
let p5PendingGuidanceSignal = false;
let p5PendingThreatSignal = false;
let p5ResultShown = false;
let previousFocus: HTMLElement | null = null;
let p6Settings: P6Settings = readP6Settings();
let p6RecordBook = readP6RecordBook();
let p6Metrics = createP6RunMetrics(p6Settings.assistedMode);
let p6Result: P6Result | null = null;
let p6ResultShown = false;
let p6SettingsReturnToResult = false;
let p6AudioContext: AudioContext | null = null;

if (p5WorldMode) {
  simulationPosition.set(0, 0, 7.5);
  previousSimulationPosition.copy(simulationPosition);
  player.position.copy(simulationPosition);
} else if (p4Mode) {
  simulationPosition.set(0, 0, -5.25);
  previousSimulationPosition.copy(simulationPosition);
  player.position.copy(simulationPosition);
}

function clearSimulationDebt(): void {
  fixedStep.clearAccumulator();
  p3DecisionAccumulator = 0;
  p4DecisionAccumulator = 0;
  p5DecisionAccumulator = 0;
  previousSimulationPosition.copy(simulationPosition);
  player.position.copy(simulationPosition);
  for (const animal of p3Simulation.animals) {
    animal.previousX = animal.x;
    animal.previousZ = animal.z;
  }
  for (const animal of p5Simulation.animals) {
    animal.previousX = animal.x;
    animal.previousZ = animal.z;
  }
}

function blockInteraction(focusTarget?: HTMLElement): void {
  if (!interactionLayer.inert) {
    const active = document.activeElement;
    previousFocus = active instanceof HTMLElement && interactionLayer.contains(active)
      ? active
      : null;
  }
  interactionLayer.inert = true;
  if (focusTarget) {
    focusTarget.focus({ preventScroll: true });
  } else {
    const active = document.activeElement;
    if (active instanceof HTMLElement && interactionLayer.contains(active)) {
      active.blur();
    }
  }
  interactionLayer.setAttribute("aria-hidden", "true");
}

function unblockInteraction(): void {
  interactionLayer.inert = false;
  interactionLayer.removeAttribute("aria-hidden");
  const restoreTarget = previousFocus;
  previousFocus = null;
  const focusTarget = restoreTarget?.isConnected ? restoreTarget : pauseButton;
  focusTarget.focus({ preventScroll: true });
}


function playP6Tone(kind: "start" | "signal" | "danger" | "success" | "failure"): void {
  if (!p6Mode || !p6Settings.soundEnabled) return;
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return;
  p6AudioContext ??= new AudioContextConstructor();
  if (p6AudioContext.state === "suspended") void p6AudioContext.resume();
  const oscillator = p6AudioContext.createOscillator();
  const gain = p6AudioContext.createGain();
  const frequency: Record<typeof kind, number> = {
    start: 440,
    signal: 580,
    danger: 220,
    success: 760,
    failure: 150,
  };
  oscillator.type = kind === "danger" || kind === "failure" ? "sawtooth" : "sine";
  oscillator.frequency.value = frequency[kind];
  gain.gain.setValueAtTime(0.0001, p6AudioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.06, p6AudioContext.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, p6AudioContext.currentTime + 0.16);
  oscillator.connect(gain);
  gain.connect(p6AudioContext.destination);
  oscillator.start();
  oscillator.stop(p6AudioContext.currentTime + 0.18);
}

function pulseP6Haptics(pattern: number | number[]): void {
  if (!p6Mode || !p6Settings.vibrationEnabled || !("vibrate" in navigator)) return;
  navigator.vibrate(pattern);
}

function showResume(reason: string): void {
  paused = true;
  resumeRequired = true;
  pauseReason.textContent = reason;
  const canShow = !portrait && document.visibilityState !== "hidden";
  resumeOverlay.hidden = !canShow;
  orientationOverlay.hidden = !portrait;
  movement.reset();
  clearSimulationDebt();
  if (canShow) blockInteraction(resumeButton);
}

const lifecyclePauseLabels: Record<LifecyclePauseReason, string> = {
  visibility: "画面が非表示になりました",
  blur: "画面からフォーカスが外れました",
  pagehide: "ページがバックグラウンドになりました",
};

const lifecycleReturnLabels: Record<LifecycleReturnReason, string> = {
  visibility: "画面へ戻りました",
  focus: "画面へ戻りました",
  pageshow: "ページへ戻りました",
};

function requestAutoPause(reason: LifecyclePauseReason): void {
  paused = true;
  resumeRequired = true;
  pauseReason.textContent = lifecyclePauseLabels[reason];
  resumeOverlay.hidden = true;
  movement.reset();
  clearSimulationDebt();
  blockInteraction();
}

function handleLifecycleReturn(reason: LifecycleReturnReason): void {
  if (!resumeRequired) return;
  showResume(lifecycleReturnLabels[reason]);
}

function pulseSignal(signal: SignalType): void {
  if (!p1ProbeEnabled || paused || portrait) return;
  const startedAt = performance.now();
  const button = required<HTMLButtonElement>(`button[data-signal='${signal}']`);
  signalFireCount += 1;
  button.dataset.fireCount = String(Number(button.dataset.fireCount ?? "0") + 1);
  button.classList.remove("did-fire");
  void button.offsetWidth;
  button.classList.add("did-fire");
  feedback.textContent = signal === "guidance"
    ? "誘導入力（P3では動物に効果なし）"
    : "威嚇入力（P3では動物に効果なし）";
  feedback.dataset.signal = signal;
  feedback.classList.remove("is-visible");
  void feedback.offsetWidth;
  feedback.classList.add("is-visible");
  lastSignalLatency = performance.now() - startedAt;
  window.setTimeout(() => feedback.classList.remove("is-visible"), 520);
}

function pulseP4ThreatSignal(): void {
  if (!p4Mode || paused || portrait || p4ResultShown) return;
  p4PendingThreatSignal = true;
  p4ThreatButton.classList.remove("did-fire");
  void p4ThreatButton.offsetWidth;
  p4ThreatButton.classList.add("did-fire");
  feedback.textContent = "威嚇音：危険種を主人公へ引きつけます";
  feedback.dataset.signal = "threat";
  feedback.classList.remove("is-visible");
  void feedback.offsetWidth;
  feedback.classList.add("is-visible");
  window.setTimeout(() => feedback.classList.remove("is-visible"), 520);
}

function pulseP5Signal(signal: "guidance" | "threat"): void {
  if (!p5WorldMode || paused || portrait || (p6Mode ? p6ResultShown : p5ResultShown)) return;
  if (signal === "guidance") p5PendingGuidanceSignal = true;
  else p5PendingThreatSignal = true;
  const button = signal === "guidance" ? p5GuidanceButton : p5ThreatButton;
  button.classList.remove("did-fire");
  void button.offsetWidth;
  button.classList.add("did-fire");
  feedback.textContent = signal === "guidance"
    ? "誘導音：追従種が主人公を追います"
    : "威嚇音：危険種を主人公へ引きつけます";
  feedback.dataset.signal = signal;
  feedback.classList.remove("is-visible");
  void feedback.offsetWidth;
  feedback.classList.add("is-visible");
  window.setTimeout(() => feedback.classList.remove("is-visible"), 520);
  if (p6Mode) {
    playP6Tone(signal === "guidance" ? "signal" : "danger");
    pulseP6Haptics(signal === "guidance" ? 12 : [0, 35, 35]);
  }
}

const input = new InputController(root, {
  onSignalReleased: pulseSignal,
  onInputCleared: () => movement.reset(),
  onOrientationChanged: (isPortrait) => {
    portrait = isPortrait;
    orientationOverlay.hidden = !portrait;
    if (portrait) {
      paused = true;
      resumeRequired = true;
      resumeOverlay.hidden = true;
      clearSimulationDebt();
      blockInteraction(orientationOverlay);
    } else {
      showResume("横画面へ戻りました");
    }
  },
  onLifecyclePauseRequested: requestAutoPause,
  onLifecycleReturn: handleLifecycleReturn,
  onPauseRequested: () => {
    input.clearAllInput("manual-clear");
    showResume("一時停止しました");
  },
});

p4ThreatButton.addEventListener("click", pulseP4ThreatSignal);
p5GuidanceButton.addEventListener("click", () => pulseP5Signal("guidance"));
p5ThreatButton.addEventListener("click", () => pulseP5Signal("threat"));
p6SettingsButton.addEventListener("click", () => openP6Settings(false));
p6StartButton.addEventListener("click", startP6Prototype);
p6SkipIntroButton.addEventListener("click", startP6Prototype);
p6SettingsCloseButton.addEventListener("click", closeP6Settings);
p6ResultSettingsButton.addEventListener("click", () => openP6Settings(true));
p6RetryButton.addEventListener("click", retryP6Prototype);

function updateP6Settings(): void {
  const requestedAssistedMode = p6AssistToggle.checked;
  if (
    p6Mode &&
    p5Simulation.status === "active" &&
    p5Simulation.elapsedSeconds > 0 &&
    requestedAssistedMode !== p6Settings.assistedMode
  ) {
    p6AssistToggle.checked = p6Settings.assistedMode;
    return;
  }

  p6Settings = {
    soundEnabled: p6SoundToggle.checked,
    vibrationEnabled: p6VibrationToggle.checked,
    assistedMode: requestedAssistedMode,
    largeControls: p6LargeControlsToggle.checked,
  };
  writeP6Settings(p6Settings);
  p6Metrics.assistedMode = p6Settings.assistedMode;
  syncP6SettingsControls();
  updateP6Status();
}

p6SoundToggle.addEventListener("change", updateP6Settings);
p6VibrationToggle.addEventListener("change", updateP6Settings);
p6AssistToggle.addEventListener("change", updateP6Settings);
p6LargeControlsToggle.addEventListener("change", updateP6Settings);
window.addEventListener("keydown", (event) => {
  if (p4Mode && event.key.toLowerCase() === "t") {
    event.preventDefault();
    pulseP4ThreatSignal();
  }
  if (p5WorldMode && event.key.toLowerCase() === "g") {
    event.preventDefault();
    pulseP5Signal("guidance");
  }
  if (p5WorldMode && event.key.toLowerCase() === "t") {
    event.preventDefault();
    pulseP5Signal("threat");
  }
});

function syncP6Intro(): void {
  const returningPlayer = p6RecordBook.introSeen;
  p6IntroLead.textContent = returningPlayer
    ? "前回の説明を省略しています。必要なら設定から補助を選び、すぐに再挑戦できます。"
    : "最初の1回だけ、4つの反応を短く確認します。説明はいつでも飛ばせます。";
  p6IntroSteps.hidden = returningPlayer;
  p6StartButton.textContent = returningPlayer ? "要点を確認して始める" : "説明を確認して始める";
  p6SkipIntroButton.textContent = returningPlayer ? "すぐに始める" : "説明を飛ばして始める";
}

if (p6Mode && !portrait) {
  paused = true;
  resumeRequired = false;
  p6IntroOverlay.hidden = false;
  syncP6Intro();
  syncP6SettingsControls();
  updateP6Status();
  blockInteraction(p6StartButton);
}

if (portrait) {
  paused = true;
  resumeRequired = true;
  orientationOverlay.hidden = false;
  blockInteraction(orientationOverlay);
}

resumeButton.addEventListener("click", () => {
  if (portrait) return;
  input.clearAllInput("manual-clear");
  paused = false;
  resumeRequired = false;
  resumeOverlay.hidden = true;
  unblockInteraction();
  clearSimulationDebt();
  lastFrameTime = performance.now();
});

function resetP3Prototype(): void {
  p3Simulation = createP3Simulation();
  p3DecisionAccumulator = 0;
  p3DecisionUpdates = 0;
  p3CompleteShown = false;
  p2StatusText.textContent = "6体の群れを観察し、囲いへ導きます";
  p2CountText.textContent = "収容 0 / 6";
  simulationPosition.set(0, 0, 4.5);
  previousSimulationPosition.copy(simulationPosition);
  player.position.copy(simulationPosition);
  simulationRotationY = 0;
  clearSimulationDebt();
}

function resetP4Prototype(): void {
  p4Simulation = createP4Simulation();
  p4DecisionAccumulator = 0;
  p4DecisionUpdates = 0;
  p4PendingThreatSignal = false;
  p4ResultShown = false;
  p4StatusText.textContent = "危険種を威嚇音で主人公へ引きつけます";
  p4PhaseText.textContent = "索敵中";
  simulationPosition.set(0, 0, -5.25);
  previousSimulationPosition.copy(simulationPosition);
  player.position.copy(simulationPosition);
  simulationRotationY = 0;
  clearSimulationDebt();
}

function resetP5Prototype(): void {
  p5Simulation = createP5Simulation();
  p5DecisionAccumulator = 0;
  p5DecisionUpdates = 0;
  p5PendingGuidanceSignal = false;
  p5PendingThreatSignal = false;
  p5ResultShown = false;
  p6Result = null;
  p6ResultShown = false;
  p6Metrics = createP6RunMetrics(p6Settings.assistedMode);
  p5StatusText.textContent = "臆病種は接近、追従種は誘導音、危険種は威嚇音に反応します";
  p5CountText.textContent = "臆病 0 / 6　追従 0 / 4　危険 0 / 1";
  p5DangerText.textContent = "危険種：索敵　保護対象：待機中";
  p5RouteText.textContent = "安全な経路 ○　速い経路 ○";
  p6ResultOverlay.hidden = true;
  p6IntroOverlay.hidden = true;
  updateP6Status();
  simulationPosition.set(0, 0, 7.5);
  previousSimulationPosition.copy(simulationPosition);
  player.position.copy(simulationPosition);
  simulationRotationY = 0;
  clearSimulationDebt();
}

function showP3Complete(): void {
  if (p3CompleteShown) return;
  p3CompleteShown = true;
  paused = true;
  resumeRequired = false;
  input.clearAllInput("manual-clear");
  p2StatusText.textContent = "6体とも全身が囲いの内側へ入りました";
  p2CountText.textContent = "収容 6 / 6　P3完了";
  p2CompleteOverlay.hidden = false;
  blockInteraction(p2RetryButton);
}

function retryP3Prototype(): void {
  if (!p3CompleteShown) return;
  p2CompleteOverlay.hidden = true;
  resetP3Prototype();
  paused = false;
  resumeRequired = false;
  if (interactionLayer.inert) unblockInteraction();
  lastFrameTime = performance.now();
}

function showP4Result(): void {
  if (p4ResultShown) return;
  p4ResultShown = true;
  paused = true;
  resumeRequired = false;
  input.clearAllInput("manual-clear");
  if (p4Simulation.status === "completed") {
    p4ResultEyebrow.textContent = "P4 危険検証版 完了";
    p4ResultTitle.textContent = "危険種を隔離しました";
    p4ResultText.textContent = "狙い、威嚇音、専用囲いの順番が成立しました。";
  } else {
    p4ResultEyebrow.textContent = "P4 危険検証版 失敗";
    p4ResultTitle.textContent = "保護対象を救助できませんでした";
    p4ResultText.textContent = p4Simulation.failureReason === "rescueTimeout"
      ? "救助待ちの時間を過ぎました。次は狙いの段階で引きつけます。"
      : "救助後に再び攻撃を許しました。危険種を先に隔離します。";
  }
  p4ResultOverlay.hidden = false;
  blockInteraction(p4RetryButton);
}

function retryP4Prototype(): void {
  if (!p4ResultShown) return;
  p4ResultOverlay.hidden = true;
  resetP4Prototype();
  paused = false;
  resumeRequired = false;
  if (interactionLayer.inert) unblockInteraction();
  lastFrameTime = performance.now();
}


function getP6Record(): P6Record | null {
  return p6Settings.assistedMode ? p6RecordBook.assisted : p6RecordBook.standard;
}

function updateP6Status(): void {
  const record = getP6Record();
  p6StatusText.textContent = p5Simulation.status === "completed"
    ? "結果を確認して、次の改善点を選びます"
    : p5Simulation.status === "failed"
      ? "失敗理由を確認して、もう一度試せます"
      : p6IntroOverlay.hidden
        ? "臆病種は接近、追従種は誘導音、危険種は威嚇音に反応します"
        : "説明を確認して開始します";
  p6TimeText.textContent = "操作時間 " + formatP6Time(p5Simulation.elapsedSeconds)
    + "　" + (p6Settings.assistedMode ? "補助あり" : "標準");
  p6RecordText.textContent = record
    ? "最高 " + record.bestScore.toLocaleString("ja-JP") + "点 / " + record.bestGrade
    : "最高記録 --";
}

function populateP6Result(): void {
  if (!p6Result) return;
  const completed = p6Result.completed;
  p6ResultEyebrow.textContent = completed ? "P6 縦切り完成版 完了" : "P6 縦切り完成版 失敗";
  p6ResultTitle.textContent = completed ? "結果を確認してください" : "今回は収容できませんでした";
  p6ResultScore.textContent = completed
    ? p6Result.totalScore.toLocaleString("ja-JP") + "点"
    : "未クリア";
  p6ResultGrade.textContent = completed ? "評価 " + p6Result.grade : "評価 —";
  p6ResultTitleText.textContent = completed
    ? p6Result.titles.join("・")
    : "次の試行で変える内容を一つ選びます";
  p6ScoreSafety.textContent = completed ? p6Result.breakdown.safety.toLocaleString("ja-JP") : "—";
  p6ScoreCoordination.textContent = completed ? p6Result.breakdown.coordination.toLocaleString("ja-JP") : "—";
  p6ScoreJudgement.textContent = completed ? p6Result.breakdown.judgement.toLocaleString("ja-JP") : "—";
  p6ScoreTime.textContent = completed ? p6Result.breakdown.time.toLocaleString("ja-JP") : "—";
  p6ResultAdvice.textContent = "次回の助言： " + p6Result.advice;
  const record = getP6Record();
  p6ResultRecord.textContent = record
    ? (p6Result.assistedMode ? "補助あり" : "標準") + "の最高記録："
      + record.bestScore.toLocaleString("ja-JP") + "点 / " + record.bestGrade
    : "このモードの記録はまだありません";
}

function showP6Result(): void {
  if (p6ResultShown) return;
  p6ResultShown = true;
  paused = true;
  resumeRequired = false;
  input.clearAllInput("manual-clear");
  p6Result = calculateP6Result(p6Metrics, p5Simulation);
  p6RecordBook = updateP6RecordBook(p6RecordBook, p6Result);
  writeP6RecordBook(p6RecordBook);
  populateP6Result();
  updateP6Status();
  p6ResultOverlay.hidden = false;
  blockInteraction(p6RetryButton);
  playP6Tone(p6Result.completed ? "success" : "failure");
  pulseP6Haptics(p6Result.completed ? [0, 80] : [0, 50, 50, 50]);
}

function retryP6Prototype(): void {
  if (!p6ResultShown) return;
  p6ResultOverlay.hidden = true;
  resetP5Prototype();
  paused = false;
  resumeRequired = false;
  if (interactionLayer.inert) unblockInteraction();
  lastFrameTime = performance.now();
}

function syncP6SettingsControls(): void {
  p6SoundToggle.checked = p6Settings.soundEnabled;
  p6VibrationToggle.checked = p6Settings.vibrationEnabled;
  p6AssistToggle.checked = p6Settings.assistedMode;
  p6LargeControlsToggle.checked = p6Settings.largeControls;
  root.classList.toggle("p6-large-controls", p6Settings.largeControls);
}

function openP6Settings(returnToResult = p6ResultShown): void {
  if (!p6Mode || portrait) return;
  p6SettingsReturnToResult = returnToResult;
  input.clearAllInput("manual-clear");
  paused = true;
  p6SettingsOverlay.hidden = false;
  syncP6SettingsControls();
  blockInteraction(p6SettingsCloseButton);
}

function closeP6Settings(): void {
  p6SettingsOverlay.hidden = true;
  if (p6SettingsReturnToResult || p6ResultShown) {
    paused = true;
    blockInteraction(p6RetryButton);
    return;
  }
  paused = false;
  resumeRequired = false;
  if (interactionLayer.inert) unblockInteraction();
  clearSimulationDebt();
  lastFrameTime = performance.now();
}

function startP6Prototype(): void {
  if (!p6Mode || portrait) return;
  p6IntroOverlay.hidden = true;
  p6SettingsButton.hidden = false;
  p6RecordBook = markP6IntroSeen(p6RecordBook);
  writeP6RecordBook(p6RecordBook);
  paused = false;
  resumeRequired = false;
  input.clearAllInput("manual-clear");
  if (interactionLayer.inert) unblockInteraction();
  clearSimulationDebt();
  lastFrameTime = performance.now();
  updateP6Status();
  playP6Tone("start");
}

function showP5Result(): void {
  if (p6Mode) {
    showP6Result();
    return;
  }
  if (p5ResultShown) return;
  p5ResultShown = true;
  paused = true;
  resumeRequired = false;
  input.clearAllInput("manual-clear");
  const counts = getP5CapturedCounts();
  const routes = p5Simulation.discoveredRoutes;
  p5ResultEyebrow.textContent = p5Simulation.status === "completed"
    ? "P5 縦切り統合版 完了"
    : "P5 縦切り統合版 失敗";
  if (p5Simulation.status === "completed") {
    p5ResultTitle.textContent = "3種類11体を収容しました";
    p5ResultText.textContent = `臆病 ${counts.coward} / 6　追従 ${counts.follower} / 4　危険 ${counts.predator} / 1`;
    p5ResultDetail.textContent = `発見した経路：${routes.safe ? "安全" : "未発見"}・${routes.fast ? "速い" : "未発見"}。結果は仮表示です。`;
  } else {
    p5ResultTitle.textContent = "危険種への対応に失敗しました";
    p5ResultText.textContent = p5Simulation.failureReason === "rescueTimeout"
      ? "救助待ちの時間を過ぎました。次は狙いの段階で引きつけます。"
      : "救助後に再び攻撃を許しました。危険種を先に隔離します。";
    p5ResultDetail.textContent = `収容：臆病 ${counts.coward} / 6　追従 ${counts.follower} / 4　危険 ${counts.predator} / 1。発見経路：${routes.safe ? "安全" : "未発見"}・${routes.fast ? "速い" : "未発見"}。失敗理由：${p5Simulation.failureReason}。結果は仮表示です。`;
  }
  p5ResultOverlay.hidden = false;
  blockInteraction(p5RetryButton);
}

function retryP5Prototype(): void {
  if (p6Mode) {
    retryP6Prototype();
    return;
  }
  if (!p5ResultShown) return;
  p5ResultOverlay.hidden = true;
  resetP5Prototype();
  paused = false;
  resumeRequired = false;
  if (interactionLayer.inert) unblockInteraction();
  lastFrameTime = performance.now();
}

p2RetryButton.addEventListener("click", retryP3Prototype);
p4RetryButton.addEventListener("click", retryP4Prototype);
p5RetryButton.addEventListener("click", retryP5Prototype);

/**
 * Runs one animal decision through the production P3 simulation. E2E replay
 * helpers use this same path with a deterministic fixture instead of
 * reimplementing the capture or entrance rules in the browser harness.
 */
function stepP3DecisionAtPlayer(
  x: number,
  z: number,
  speed: number,
  isRunning: boolean,
  deltaSeconds: number,
): void {
  const decision = stepP3Simulation(
    p3Simulation,
    { x, z, speed, isRunning },
    deltaSeconds,
  );
  p3DecisionUpdates += 1;
  if (decision.completed) showP3Complete();
  updateP3Status();
}

function stepP4DecisionAtPlayer(
  x: number,
  z: number,
  speed: number,
  isRunning: boolean,
  deltaSeconds: number,
): void {
  const decision = stepP4Simulation(
    p4Simulation,
    {
      x,
      z,
      speed,
      isRunning,
      threatSignal: p4PendingThreatSignal,
    },
    deltaSeconds,
  );
  p4PendingThreatSignal = false;
  p4DecisionUpdates += 1;
  updateP4Status();
  if (decision.status !== "active") showP4Result();
}

function stepP5DecisionAtPlayer(
  x: number,
  z: number,
  speed: number,
  isRunning: boolean,
  deltaSeconds: number,
): void {
  const p6DecisionSeconds = p6Mode
    && p6Settings.assistedMode
    && p5Simulation.animals.some((animal) => animal.type === "predator" && animal.phase === "aim")
    ? deltaSeconds * 0.7
    : deltaSeconds;
  const decision = stepP5Simulation(
    p5Simulation,
    {
      x,
      z,
      speed,
      isRunning,
      guidanceSignal: p5PendingGuidanceSignal,
      threatSignal: p5PendingThreatSignal,
    },
    p6DecisionSeconds,
  );
  if (p6Mode) observeP6Run(p6Metrics, p5Simulation, p6DecisionSeconds);
  p5PendingGuidanceSignal = false;
  p5PendingThreatSignal = false;
  p5DecisionUpdates += 1;
  if (p6Mode) updateP6Status();
  else updateP5Status();
  if (decision.status !== "active") showP5Result();
}

function prepareP3E2EFixture(): void {
  p2CompleteOverlay.hidden = true;
  if (interactionLayer.inert) unblockInteraction();
  resetP3Prototype();
  input.clearAllInput("manual-clear");
  paused = false;
  resumeRequired = false;
  lastFrameTime = performance.now();
}

function primeP3EnteringAnimal(index: number): void {
  const animal = p3Simulation.animals[index];
  if (!animal) throw new Error(`P3 E2E fixture animal ${index} is missing`);
  const x = [-3.1, -1.86, -0.62, 0.62, 1.86, 3.1][index] ?? 0;
  animal.x = x;
  animal.z = p3Simulation.pen.centerZ;
  animal.previousX = animal.x;
  animal.previousZ = animal.z;
  animal.phase = "enteringPen";
  animal.phaseSeconds = 0;
  animal.captureHoldSeconds = 0;
  animal.fullBodyInside = true;
  animal.escapeX = 0;
  animal.escapeZ = -1;
  animal.lastMoveX = 0;
  animal.lastMoveZ = 0;
  animal.pressureReleaseSeconds = 0;
  animal.pressureBand = "none";
  animal.fleeTriggerBand = null;
  animal.tension = 0;
  animal.tensionState = "calm";
  animal.confusionSeconds = 0;
  animal.confusionCause = "none";
  animal.waitingSeconds = 0;
  animal.backoffSeconds = 0;
  animal.stuckSeconds = 0;
  // The fixture represents an already granted entrance token; the
  // production reconciliation then owns and advances this body normally.
  p3Simulation.penReservedAnimalId = animal.id;
}

function runP3CompletionReplay(): void {
  prepareP3E2EFixture();
  const playerX = 0;
  const playerZ = 4.5;

  for (let index = 0; index < p3Simulation.animals.length; index += 1) {
    primeP3EnteringAnimal(index);
    const animal = p3Simulation.animals[index];
    for (let holdStep = 0; holdStep < 12 && animal?.phase !== "captured"; holdStep += 1) {
      stepP3DecisionAtPlayer(
        playerX,
        playerZ,
        0,
        false,
        P3_DECISION_SECONDS,
      );
    }
    if (animal?.phase !== "captured") {
      throw new Error(`P3 E2E completion fixture did not capture ${animal?.id ?? index}`);
    }
  }
}

function probeP3EntranceQueue(): P3EntranceQueueProbe {
  prepareP3E2EFixture();
  const entranceClearance = p3Simulation.pen.entranceHalfWidth - p3Simulation.pen.animalRadius;
  const outerFaceZ = p3Simulation.pen.entranceZ + p3Simulation.pen.animalRadius;
  const queueSpacing = P3_TUNING.minimumAnimalSeparation;
  const candidates = Array.from({ length: p3Simulation.animals.length }, (_, index) => ({
    // The nearest body is last in the stable list, so the other five form a
    // physically separated staging queue behind it.
    x: 0,
    z: outerFaceZ + queueSpacing * (p3Simulation.animals.length - index - 1) + 0.02,
  }));
  const initialCandidates = candidates.map((candidate, index) => ({
    id: p3Simulation.animals[index]?.id ?? `coward-${index + 1}`,
    ...candidate,
  }));
  for (const [index, candidate] of candidates.entries()) {
    const animal = p3Simulation.animals[index];
    if (!animal) throw new Error(`P3 E2E entrance fixture animal ${index} is missing`);
    animal.x = candidate.x;
    animal.z = candidate.z;
    animal.previousX = candidate.x;
    animal.previousZ = candidate.z;
    animal.phase = "fleeing";
    animal.phaseSeconds = 0;
    animal.captureHoldSeconds = 0;
    animal.fullBodyInside = false;
    animal.escapeX = 0;
    animal.escapeZ = -1;
    animal.lastMoveX = 0;
    animal.lastMoveZ = 0;
    animal.pressureReleaseSeconds = 0;
    animal.pressureBand = "guidance";
    animal.fleeTriggerBand = "guidance";
  }

  // Acquire the actual owner only after a production step; the five
  // non-owners remain outside as a physically separated waiting queue.
  stepP3DecisionAtPlayer(0, 0, 0, false, P3_DECISION_SECONDS);
  const firstStepReservedAnimalId = p3Simulation.penReservedAnimalId;
  if (!firstStepReservedAnimalId) {
    throw new Error("P3 E2E entrance fixture did not reserve an owner on the first step");
  }
  const firstStepAnimals = p3Simulation.animals.map((animal) => ({
    id: animal.id,
    phase: animal.phase,
    x: animal.x,
    z: animal.z,
  }));

  const reservedCandidate = p3Simulation.animals.find(
    (animal) => animal.id === firstStepReservedAnimalId,
  );
  for (let attempt = 0; attempt < 48; attempt += 1) {
    if (reservedCandidate?.phase === "enteringPen") break;
    // Keep the player behind the real owner while the production simulation
    // advances it through the opening; no state is written by this hook.
    stepP3DecisionAtPlayer(
      reservedCandidate?.x ?? 0,
      (reservedCandidate?.z ?? outerFaceZ) + 2.4,
      0,
      false,
      P3_DECISION_SECONDS,
    );
  }

  paused = true;
  resumeRequired = false;
  input.clearAllInput("manual-clear");
  clearSimulationDebt();
  return {
    entranceClearance,
    outerFaceZ,
    minimumAnimalSeparation: queueSpacing,
    decisionStepSeconds: P3_DECISION_SECONDS,
    initialCandidates,
    firstStepReservedAnimalId,
    firstStepAnimals,
    reservedAnimalId: p3Simulation.penReservedAnimalId,
    enteringAnimalIds: p3Simulation.animals
      .filter((animal) => animal.phase === "enteringPen")
      .map((animal) => animal.id),
    capturedCount: p3Simulation.capturedCount,
  };
}

function prepareP4E2EFixture(): void {
  p4ResultOverlay.hidden = true;
  if (interactionLayer.inert) unblockInteraction();
  resetP4Prototype();
  input.clearAllInput("manual-clear");
  paused = false;
  resumeRequired = false;
  lastFrameTime = performance.now();
}

function primeP4Aim(): void {
  prepareP4E2EFixture();
  p4Simulation.predator.x = 0;
  p4Simulation.predator.z = -1.3;
  p4Simulation.predator.previousX = p4Simulation.predator.x;
  p4Simulation.predator.previousZ = p4Simulation.predator.z;
  stepP4DecisionAtPlayer(10, 10, 0, false, P4_DECISION_SECONDS);
  paused = true;
  clearSimulationDebt();
}

function runP4RescueSuccess(): void {
  prepareP4E2EFixture();
  p4Simulation.victim.lifeState = "rescuePending";
  p4Simulation.victim.rescueSeconds = 1;
  p4Simulation.predator.attackPhase = "recovery";
  p4Simulation.predator.recoverySeconds = 0;
  stepP4DecisionAtPlayer(
    p4Simulation.predator.x,
    p4Simulation.predator.z,
    0,
    false,
    P4_DECISION_SECONDS,
  );
  paused = true;
  clearSimulationDebt();
}

function runP4RescueFailure(): void {
  prepareP4E2EFixture();
  p4Simulation.victim.lifeState = "rescuePending";
  p4Simulation.victim.rescueSeconds = P4_TUNING.rescueDeadlineSeconds - P4_DECISION_SECONDS;
  p4Simulation.predator.attackPhase = "recovery";
  p4Simulation.predator.recoverySeconds = 0;
  stepP4DecisionAtPlayer(10, 10, 0, false, P4_DECISION_SECONDS);
  clearSimulationDebt();
}

function runP4CaptureReplay(): void {
  prepareP4E2EFixture();
  p4Simulation.predator.x = p4Simulation.pen.centerX;
  p4Simulation.predator.z = p4Simulation.pen.centerZ;
  p4Simulation.predator.previousX = p4Simulation.predator.x;
  p4Simulation.predator.previousZ = p4Simulation.predator.z;
  p4Simulation.predator.insidePen = true;
  p4Simulation.predator.attackPhase = "search";
  for (let step = 0; step < 20 && p4Simulation.status === "active"; step += 1) {
    stepP4DecisionAtPlayer(0, 0, 0, false, P4_DECISION_SECONDS);
  }
  clearSimulationDebt();
}

function prepareP5E2EFixture(): void {
  p5ResultOverlay.hidden = true;
  if (interactionLayer.inert) unblockInteraction();
  resetP5Prototype();
  input.clearAllInput("manual-clear");
  paused = false;
  resumeRequired = false;
  lastFrameTime = performance.now();
}

function primeP5Aim(): void {
  prepareP5E2EFixture();
  const victim = p5Simulation.animals.find((animal) => animal.id === "coward-1");
  const predator = p5Simulation.animals.find((animal) => animal.id === "predator-1");
  if (!victim || !predator) throw new Error("P5 danger fixture is incomplete");
  predator.x = victim.x;
  predator.z = victim.z - 1.1;
  predator.previousX = predator.x;
  predator.previousZ = predator.z;
  stepP5DecisionAtPlayer(10, 10, 0, false, P5_DECISION_SECONDS);
  paused = true;
  clearSimulationDebt();
}

function runP5RescueSuccess(): void {
  prepareP5E2EFixture();
  const victim = p5Simulation.animals.find((animal) => animal.id === "coward-1");
  const predator = p5Simulation.animals.find((animal) => animal.id === "predator-1");
  if (!victim || !predator) throw new Error("P5 rescue fixture is incomplete");
  victim.lifeState = "rescuePending";
  victim.phase = "rescuePending";
  victim.rescueSeconds = 1;
  predator.phase = "recovery";
  predator.waitingSeconds = 0;
  predator.x = 0;
  predator.z = 0;
  stepP5DecisionAtPlayer(10, 10, 0, false, P5_DECISION_SECONDS);
  p5PendingThreatSignal = true;
  stepP5DecisionAtPlayer(0, 0, 0, false, P5_DECISION_SECONDS);
  paused = true;
  clearSimulationDebt();
}

function runP5RescueFailure(): void {
  prepareP5E2EFixture();
  const victim = p5Simulation.animals.find((animal) => animal.id === "coward-1");
  const predator = p5Simulation.animals.find((animal) => animal.id === "predator-1");
  if (!victim || !predator) throw new Error("P5 failure fixture is incomplete");
  victim.lifeState = "rescuePending";
  victim.phase = "rescuePending";
  victim.rescueSeconds = P5_TUNING.rescueDeadlineSeconds - P5_DECISION_SECONDS;
  predator.phase = "recovery";
  predator.waitingSeconds = 0;
  stepP5DecisionAtPlayer(10, 10, 0, false, P5_DECISION_SECONDS);
  clearSimulationDebt();
}

function runP5RouteDiscovery(): void {
  prepareP5E2EFixture();
  const safeAnimal = p5Simulation.animals.find((animal) => animal.id === "coward-1");
  const fastAnimal = p5Simulation.animals.find((animal) => animal.id === "follower-1");
  if (!safeAnimal || !fastAnimal) throw new Error("P5 route fixture is incomplete");
  safeAnimal.x = -5.2;
  safeAnimal.z = 0;
  safeAnimal.previousX = safeAnimal.x;
  safeAnimal.previousZ = safeAnimal.z;
  stepP5DecisionAtPlayer(10, 10, 0, false, P5_DECISION_SECONDS);
  fastAnimal.x = 0;
  fastAnimal.z = 0;
  fastAnimal.previousX = fastAnimal.x;
  fastAnimal.previousZ = fastAnimal.z;
  stepP5DecisionAtPlayer(10, 10, 0, false, P5_DECISION_SECONDS);
  paused = true;
  clearSimulationDebt();
}

function runP5CompletionReplay(): void {
  prepareP5E2EFixture();
  const safeAnimal = p5Simulation.animals.find((animal) => animal.id === "coward-1");
  const fastAnimal = p5Simulation.animals.find((animal) => animal.id === "follower-1");
  if (!safeAnimal || !fastAnimal) throw new Error("P5 completion route fixture is incomplete");
  safeAnimal.x = -5.2;
  safeAnimal.z = 0;
  safeAnimal.previousX = safeAnimal.x;
  safeAnimal.previousZ = safeAnimal.z;
  stepP5DecisionAtPlayer(10, 10, 0, false, P5_DECISION_SECONDS);
  fastAnimal.x = 0;
  fastAnimal.z = 0;
  fastAnimal.previousX = fastAnimal.x;
  fastAnimal.previousZ = fastAnimal.z;
  stepP5DecisionAtPlayer(10, 10, 0, false, P5_DECISION_SECONDS);
  const predator = p5Simulation.animals.find((animal) => animal.type === "predator");
  if (!predator) throw new Error("P5 completion fixture is incomplete");
  const predatorPen = p5Simulation.pens.predator;
  predator.x = predatorPen.centerX;
  predator.z = predatorPen.entranceZ + 0.3;
  predator.previousX = predator.x;
  predator.previousZ = predator.z;
  p5PendingThreatSignal = true;
  for (let step = 0; step < 60 && !predator.insidePen; step += 1) {
    stepP5DecisionAtPlayer(predatorPen.centerX, predatorPen.centerZ, 0, false, P5_DECISION_SECONDS);
  }
  for (const animal of p5Simulation.animals.filter((candidate) => candidate.type !== "predator")) {
    const pen = p5Simulation.pens[animal.type];
    animal.x = pen.centerX;
    animal.z = pen.entranceZ - 0.3;
    animal.previousX = animal.x;
    animal.previousZ = animal.z;
    for (let step = 0; step < 30 && animal.lifeState === "active"; step += 1) {
      stepP5DecisionAtPlayer(10, 10, 0, false, P5_DECISION_SECONDS);
    }
  }
  clearSimulationDebt();
}

function resize(): void {
  const width = Math.max(1, root.clientWidth);
  const height = Math.max(1, root.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize);
resize();

const cameraTarget = new THREE.Vector3();
const desiredCameraPosition = new THREE.Vector3();

function updateP3Status(): void {
  p2CountText.textContent = p3Simulation.completed
    ? "収容 6 / 6　P3完了"
    : `収容 ${p3Simulation.capturedCount} / 6`;
  if (p3Simulation.completed) {
    p2StatusText.textContent = "6体とも全身が囲いの内側へ入りました";
    return;
  }
  const anticipating = p3Simulation.animals.some((animal) => animal.phase === "anticipating");
  const confused = p3Simulation.animals.some((animal) => animal.tensionState === "confused");
  const waiting = p3Simulation.animals.some((animal) => animal.phase === "waitingForEntrance");
  const fleeing = p3Simulation.animals.some((animal) => animal.phase === "fleeing");
  const entering = p3Simulation.animals.some((animal) => animal.phase === "enteringPen");
  if (anticipating) {
    p2StatusText.textContent = "動物がこちらを見ています";
  } else if (confused) {
    p2StatusText.textContent = "群れが混乱しています。位置を整えます";
  } else if (waiting) {
    p2StatusText.textContent = "入口を順番に待っています";
  } else if (fleeing) {
    p2StatusText.textContent = "動物が反応しています";
  } else if (entering) {
    p2StatusText.textContent = "囲いへ進入中：全身が内側へ入るまで待ちます";
  } else {
    p2StatusText.textContent = "6体の群れを観察し、囲いへ導きます";
  }
}

function updateP4Status(): void {
  const predator = p4Simulation.predator;
  const victim = p4Simulation.victim;
  if (p4Simulation.status === "completed") {
    p4StatusText.textContent = "危険種を専用囲いへ隔離しました";
    p4PhaseText.textContent = "隔離完了";
    return;
  }
  if (p4Simulation.status === "failed") {
    p4StatusText.textContent = victim.rescueSeconds >= P4_TUNING.rescueDeadlineSeconds
      ? "救助待ちの時間を過ぎました"
      : "救助後に危険種の再攻撃を許しました";
    p4PhaseText.textContent = "失敗確定";
    return;
  }
  if (victim.lifeState === "rescuePending") {
    p4StatusText.textContent = `救助待ち：残り ${Math.max(0, P4_TUNING.rescueDeadlineSeconds - victim.rescueSeconds).toFixed(1)}秒`;
    p4PhaseText.textContent = "救助範囲へ入り、威嚇音でも止められます";
    return;
  }
  if (predator.insidePen) {
    p4StatusText.textContent = "危険種は囲いの中です。主人公だけ外へ出ます";
    p4PhaseText.textContent = `隔離判定 ${predator.captureHoldSeconds.toFixed(1)} / ${P4_TUNING.captureHoldSeconds.toFixed(1)}秒`;
    return;
  }
  const phaseLabels: Record<P4AttackPhase, string> = {
    search: "索敵中",
    chase: predator.intent === "chasePlayer" ? "主人公を追跡中" : "保護対象を追跡中",
    aim: "狙い中：攻撃前に威嚇音を使います",
    lunge: "飛びかかり中",
    recovery: "攻撃後の回復中",
    disabled: "停止中",
  };
  p4StatusText.textContent = predator.attackPhase === "aim"
    ? "狙いを始めました。今なら威嚇音で中断できます"
    : predator.intent === "chasePlayer"
      ? "危険種が主人公を追っています。囲いへ誘導します"
      : "危険種が保護対象を探しています";
  p4PhaseText.textContent = phaseLabels[predator.attackPhase];
}

function getP5CapturedCounts(): Record<P5AnimalType, number> {
  return {
    coward: p5Simulation.animals.filter(
      (animal) => animal.type === "coward" && animal.lifeState === "captured",
    ).length,
    follower: p5Simulation.animals.filter(
      (animal) => animal.type === "follower" && animal.lifeState === "captured",
    ).length,
    predator: p5Simulation.animals.filter(
      (animal) => animal.type === "predator" && animal.lifeState === "captured",
    ).length,
  };
}

function updateP5Status(): void {
  const counts = getP5CapturedCounts();
  p5CountText.textContent = `臆病 ${counts.coward} / 6　追従 ${counts.follower} / 4　危険 ${counts.predator} / 1`;
  p5RouteText.textContent = `安全な経路 ${p5Simulation.discoveredRoutes.safe ? "●" : "○"}　速い経路 ${p5Simulation.discoveredRoutes.fast ? "●" : "○"}`;
  const predator = p5Simulation.animals.find((animal) => animal.type === "predator");
  const victim = p5Simulation.animals.find((animal) => animal.id === "coward-1");
  const predatorLabels: Record<P5AnimalPhase, string> = {
    idle: "待機",
    fleeing: "逃走",
    following: "追従",
    waitingForPen: "入口待機",
    enteringPen: "入場中",
    search: "索敵",
    chase: "追跡",
    aim: "狙い",
    lunge: "飛びかかり",
    recovery: "回復",
    chasePlayer: "主人公追跡",
    rescuePending: "救助待ち",
    captured: "隔離済み",
    disabled: "停止",
  };
  p5DangerText.textContent = `危険種：${predator ? predatorLabels[predator.phase] : "不明"}　保護対象：${victim?.lifeState ?? "不明"}`;
  if (p5Simulation.status === "completed") {
    p5StatusText.textContent = "3種類11体を、それぞれの囲いへ収容しました";
    return;
  }
  if (p5Simulation.status === "failed") {
    p5StatusText.textContent = p5Simulation.failureReason === "rescueTimeout"
      ? "救助待ちの時間を過ぎました"
      : "救助後に危険種の再攻撃を許しました";
    return;
  }
  if (victim?.lifeState === "rescuePending") {
    p5StatusText.textContent = `救助待ち：残り ${Math.max(0, P5_TUNING.rescueDeadlineSeconds - victim.rescueSeconds).toFixed(1)}秒`;
    return;
  }
  if (predator?.phase === "aim") {
    p5StatusText.textContent = "危険種が狙っています。威嚇音で主人公へ引きつけます";
    return;
  }
  if (p5Simulation.animals.some((animal) => animal.phase === "following")) {
    p5StatusText.textContent = "追従種がついてきています。橋を使うと速く進めます";
    return;
  }
  if (p5Simulation.animals.some((animal) => animal.phase === "fleeing")) {
    p5StatusText.textContent = "臆病種が反応しています。水場へ押し込まないようにします";
    return;
  }
  p5StatusText.textContent = "臆病種は接近、追従種は誘導音、危険種は威嚇音に反応します";
}

function updateP3Visuals(interpolationAlpha: number): void {
  for (let index = 0; index < cowardVisuals.length; index += 1) {
    const visual = cowardVisuals[index];
    const animal = p3Simulation.animals[index];
    if (!visual || !animal) continue;
    visual.group.position.set(
      THREE.MathUtils.lerp(animal.previousX, animal.x, interpolationAlpha),
      0,
      THREE.MathUtils.lerp(animal.previousZ, animal.z, interpolationAlpha),
    );
    // Captured animals remain visible in the pen so success is readable.
    visual.group.visible = !p4Mode;
    visual.reactionRing.visible = animal.phase === "anticipating"
      || animal.tensionState === "alert"
      || animal.tensionState === "confused";
    const ringMaterial = visual.reactionRing.material as THREE.MeshBasicMaterial;
    ringMaterial.color.set(animal.tensionState === "confused" ? 0xff7777 : 0xffe085);
    visual.escapeArrow.visible = debugEnabled
      && (animal.phase === "anticipating"
        || animal.phase === "fleeing"
        || animal.tensionState === "confused");
    const direction = animal.phase === "anticipating"
      ? { x: animal.escapeX, z: animal.escapeZ }
      : { x: animal.lastMoveX, z: animal.lastMoveZ };
    if (Math.hypot(direction.x, direction.z) > 0.01) {
      visual.group.rotation.y = Math.atan2(-direction.x, -direction.z);
      visual.escapeArrow.rotation.y = Math.atan2(direction.x, direction.z);
    }
    if (animal.phase === "anticipating" || animal.tensionState !== "calm") {
      const pulse = 1 + Math.sin(animal.phaseSeconds * 14) * 0.08;
      visual.reactionRing.scale.setScalar(pulse);
    }
  }
}

function updateP4Visuals(interpolationAlpha: number): void {
  const predator = p4Simulation.predator;
  const victim = p4Simulation.victim;
  p4PredatorVisual.group.position.set(
    THREE.MathUtils.lerp(predator.previousX, predator.x, interpolationAlpha),
    0,
    THREE.MathUtils.lerp(predator.previousZ, predator.z, interpolationAlpha),
  );
  p4VictimVisual.group.position.set(
    THREE.MathUtils.lerp(victim.previousX, victim.x, interpolationAlpha),
    0,
    THREE.MathUtils.lerp(victim.previousZ, victim.z, interpolationAlpha),
  );
  const isAiming = predator.attackPhase === "aim";
  const isRescuePending = victim.lifeState === "rescuePending";
  p4PredatorVisual.warningRing.visible = isAiming || predator.intent === "chasePlayer";
  p4VictimVisual.warningRing.visible = isAiming || isRescuePending;
  const predatorRing = p4PredatorVisual.warningRing.material as THREE.MeshBasicMaterial;
  const victimRing = p4VictimVisual.warningRing.material as THREE.MeshBasicMaterial;
  predatorRing.color.set(predator.intent === "chasePlayer" ? 0xffd36d : 0xffb38e);
  victimRing.color.set(isRescuePending ? 0xff6767 : 0xffd36d);
  p4PredatorVisual.intentArrow.visible = predator.attackPhase === "aim"
    || predator.intent === "chasePlayer";
  p4VictimVisual.intentArrow.visible = isRescuePending;
  if (Math.hypot(predator.lastMoveX, predator.lastMoveZ) > 0.01) {
    p4PredatorVisual.group.rotation.y = Math.atan2(-predator.lastMoveX, -predator.lastMoveZ);
    p4PredatorVisual.intentArrow.rotation.y = Math.atan2(predator.lastMoveX, predator.lastMoveZ);
  }
  const pulse = 1 + Math.sin(p4Simulation.elapsedSeconds * 14) * 0.08;
  p4PredatorVisual.warningRing.scale.setScalar(pulse);
  p4VictimVisual.warningRing.scale.setScalar(pulse);
}

function updateP5Visuals(interpolationAlpha: number): void {
  const cowards = p5Simulation.animals.filter((animal) => animal.type === "coward");
  const followers = p5Simulation.animals.filter((animal) => animal.type === "follower");
  const predator = p5Simulation.animals.find((animal) => animal.type === "predator");
  for (let index = 0; index < cowards.length; index += 1) {
    const visual = cowardVisuals[index];
    const animal = cowards[index];
    if (!visual || !animal) continue;
    visual.group.visible = p5WorldMode;
    visual.group.position.set(
      THREE.MathUtils.lerp(animal.previousX, animal.x, interpolationAlpha),
      0,
      THREE.MathUtils.lerp(animal.previousZ, animal.z, interpolationAlpha),
    );
    visual.reactionRing.visible = animal.phase === "fleeing"
      || animal.phase === "rescuePending"
      || animal.tension >= 55;
    const ringMaterial = visual.reactionRing.material as THREE.MeshBasicMaterial;
    ringMaterial.color.set(animal.phase === "rescuePending" ? 0xff6767 : 0xffe085);
    visual.escapeArrow.visible = debugEnabled && animal.phase === "fleeing";
    if (Math.hypot(animal.lastMoveX, animal.lastMoveZ) > 0.01) {
      visual.group.rotation.y = Math.atan2(-animal.lastMoveX, -animal.lastMoveZ);
      visual.escapeArrow.rotation.y = Math.atan2(animal.lastMoveX, animal.lastMoveZ);
    }
  }
  for (let index = 0; index < followers.length; index += 1) {
    const visual = p5FollowerVisuals[index];
    const animal = followers[index];
    if (!visual || !animal) continue;
    visual.group.visible = p5WorldMode;
    visual.group.position.set(
      THREE.MathUtils.lerp(animal.previousX, animal.x, interpolationAlpha),
      0,
      THREE.MathUtils.lerp(animal.previousZ, animal.z, interpolationAlpha),
    );
    visual.warningRing.visible = animal.phase === "following" || animal.phase === "waitingForPen";
    const ringMaterial = visual.warningRing.material as THREE.MeshBasicMaterial;
    ringMaterial.color.set(animal.route === "fast" ? 0xffd36d : 0xb6b8ff);
    if (Math.hypot(animal.lastMoveX, animal.lastMoveZ) > 0.01) {
      visual.group.rotation.y = Math.atan2(-animal.lastMoveX, -animal.lastMoveZ);
    }
  }
  if (predator) {
    p5PredatorVisual.group.visible = p5WorldMode;
    p5PredatorVisual.group.position.set(
      THREE.MathUtils.lerp(predator.previousX, predator.x, interpolationAlpha),
      0,
      THREE.MathUtils.lerp(predator.previousZ, predator.z, interpolationAlpha),
    );
    p5PredatorVisual.warningRing.visible = predator.phase === "aim"
      || predator.phase === "chasePlayer"
      || predator.phase === "lunge";
    const ringMaterial = p5PredatorVisual.warningRing.material as THREE.MeshBasicMaterial;
    ringMaterial.color.set(predator.phase === "chasePlayer" ? 0xffd36d : 0xffb38e);
    p5PredatorVisual.intentArrow.visible = predator.phase === "aim"
      || predator.phase === "chasePlayer";
    if (Math.hypot(predator.lastMoveX, predator.lastMoveZ) > 0.01) {
      p5PredatorVisual.group.rotation.y = Math.atan2(-predator.lastMoveX, -predator.lastMoveZ);
      p5PredatorVisual.intentArrow.rotation.y = Math.atan2(predator.lastMoveX, predator.lastMoveZ);
    }
  }
  const pulse = 1 + Math.sin(p5Simulation.elapsedSeconds * 14) * 0.08;
  for (const animal of [...cowards, ...followers, ...(predator ? [predator] : [])]) {
    if (animal.type === "coward") {
      const index = cowards.indexOf(animal);
      cowardVisuals[index]?.reactionRing.scale.setScalar(pulse);
    } else if (animal.type === "follower") {
      const index = followers.indexOf(animal);
      p5FollowerVisuals[index]?.warningRing.scale.setScalar(pulse);
    } else {
      p5PredatorVisual.warningRing.scale.setScalar(pulse);
    }
  }
}

function updateDiagnostics(deltaSeconds: number, speed: number): void {
  fpsFrames += 1;
  fpsElapsed += deltaSeconds;
  if (fpsElapsed >= 0.5) {
    displayedFps = Math.round(fpsFrames / fpsElapsed);
    displayedFrameMs = (fpsElapsed / fpsFrames) * 1000;
    fpsFrames = 0;
    fpsElapsed = 0;
  }

  const snapshot = input.getSnapshot();
  const owners = snapshot.pointerOwnership;
  const owner = (value: number | null): string => value === null ? "–" : String(value);
  const cameraRatio = activePlaySeconds > 0
    ? Math.round((cameraInteractionSeconds / activePlaySeconds) * 100)
    : 0;

  diagnostics.fps.textContent = `FPS ${displayedFps || "--"}`;
  diagnostics.frame.textContent = `フレーム ${displayedFrameMs ? displayedFrameMs.toFixed(1) : "--"} ms`;
  diagnostics.speed.textContent = `速度 ${speed.toFixed(2)}`;
  diagnostics.camera.textContent = `手動カメラ ${cameraInteractionSeconds.toFixed(1)}秒 / ${cameraRatio}%`;
  diagnostics.owners.textContent = `指 移:${owner(owners.movement)} 視:${owner(owners.camera)} 誘:${owner(owners.guidance)} 威:${owner(owners.threat)}`;
  diagnostics.cancel.textContent = `解除 ${snapshot.cancellationReason ?? "なし"}`;
  diagnostics.rejected.textContent = `競合拒否 ${snapshot.rejectedPointerClaims}`;
  diagnostics.signal.textContent = `合図反応 ${signalFireCount ? lastSignalLatency.toFixed(1) : "--"} ms`;
  diagnostics.simulation.textContent = `固定更新 遅延破棄 ${fixedStep.diagnostics.droppedTimeSeconds.toFixed(3)}秒`;
  root.dataset.playerX = simulationPosition.x.toFixed(3);
  root.dataset.playerZ = simulationPosition.z.toFixed(3);
  root.dataset.p2Captured = String(p3Simulation.capturedCount);
  root.dataset.p2Complete = String(p3Simulation.completed);
  root.dataset.p3Captured = String(p3Simulation.capturedCount);
  root.dataset.p3Complete = String(p3Simulation.completed);
  root.dataset.p3Flock = p3Simulation.flock.state;
  root.dataset.p3Recovered = String(
    p3Simulation.animals.reduce((sum, animal) => sum + animal.recoveryCount, 0),
  );
  root.dataset.p4Status = p4Simulation.status;
  root.dataset.p4Phase = p4Simulation.predator.attackPhase;
  root.dataset.p4Victim = p4Simulation.victim.lifeState;
  root.dataset.p5Status = p5Simulation.status;
  root.dataset.p5DecisionUpdates = String(p5DecisionUpdates);
  root.dataset.p5Routes = `${p5Simulation.discoveredRoutes.safe ? "safe" : ""}${p5Simulation.discoveredRoutes.fast ? ",fast" : ""}`;
  root.dataset.paused = String(paused);
}

function constrainP5PlayerMovement(
  previous: THREE.Vector3,
  current: THREE.Vector3,
): { x: number; z: number } {
  return constrainP5CircleAgainstPens(
    p5Simulation.pens,
    { x: previous.x, z: previous.z },
    { x: current.x, z: current.z },
    PLAYER_COLLISION_RADIUS,
  );
}

function simulate(stepSeconds: number): void {
  previousSimulationPosition.copy(simulationPosition);
  input.update(stepSeconds);
  const snapshot = input.getSnapshot();

  if (!paused && !portrait && !resumeRequired) {
    activePlaySeconds += stepSeconds;
    if (snapshot.cameraInteractionActive) cameraInteractionSeconds += stepSeconds;
    const speed = movement.update(snapshot.joystickMagnitude, stepSeconds);
    const direction = worldDirectionFromJoystick(
      snapshot.joystickX,
      snapshot.joystickY,
      snapshot.movementBasisYaw,
    );
    simulationPosition.x = THREE.MathUtils.clamp(
      simulationPosition.x + direction.x * speed * stepSeconds,
      -16.5,
      16.5,
    );
    simulationPosition.z = THREE.MathUtils.clamp(
      simulationPosition.z + direction.z * speed * stepSeconds,
      -16.5,
      16.5,
    );
    if (p5WorldMode) {
      const constrainedPlayer = constrainP5PlayerMovement(
        previousSimulationPosition,
        simulationPosition,
      );
      simulationPosition.x = constrainedPlayer.x;
      simulationPosition.z = constrainedPlayer.z;
    } else {
      const constrainedPlayer = constrainCircleAgainstPenRails(
        previousSimulationPosition,
        simulationPosition,
        p3Simulation.pen,
        PLAYER_COLLISION_RADIUS,
      );
      simulationPosition.x = constrainedPlayer.x;
      simulationPosition.z = constrainedPlayer.z;
    }
    if (direction.magnitude > 0.02 && speed > 0.02) {
      simulationRotationY = Math.atan2(-direction.x, -direction.z);
    }

    // P1 keeps integrating input and the active prototype decision slice is
    // intentionally lower-frequency and deterministic.
    if (p5WorldMode) {
      p5DecisionAccumulator += stepSeconds;
      while (p5DecisionAccumulator >= P5_DECISION_SECONDS) {
        p5DecisionAccumulator -= P5_DECISION_SECONDS;
        stepP5DecisionAtPlayer(
          simulationPosition.x,
          simulationPosition.z,
          speed,
          speed >= 3.2,
          P5_DECISION_SECONDS,
        );
      }
    } else if (p4Mode) {
      p4DecisionAccumulator += stepSeconds;
      while (p4DecisionAccumulator >= P4_DECISION_SECONDS) {
        p4DecisionAccumulator -= P4_DECISION_SECONDS;
        stepP4DecisionAtPlayer(
          simulationPosition.x,
          simulationPosition.z,
          speed,
          speed >= 3.2,
          P4_DECISION_SECONDS,
        );
      }
    } else {
      p3DecisionAccumulator += stepSeconds;
      while (p3DecisionAccumulator >= P3_DECISION_SECONDS) {
        p3DecisionAccumulator -= P3_DECISION_SECONDS;
        stepP3DecisionAtPlayer(
          simulationPosition.x,
          simulationPosition.z,
          speed,
          speed >= 3.2,
          P3_DECISION_SECONDS,
        );
      }
    }
  } else {
    movement.reset();
  }
}

function frame(now: number): void {
  const renderDeltaSeconds = Math.max(0, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  let interpolationAlpha = 0;

  if (!paused && !portrait && !resumeRequired) {
    interpolationAlpha = fixedStep.advance(renderDeltaSeconds, simulate).interpolationAlpha;
  } else {
    clearSimulationDebt();
  }

  player.position.lerpVectors(
    previousSimulationPosition,
    simulationPosition,
    interpolationAlpha,
  );
  player.rotation.y = simulationRotationY;
  const snapshot = input.getSnapshot();

  // Keep the active prototype readable while retaining the P1 camera yaw and
  // movement-basis rules. The 35/65 focus is a view aid, not auto-navigation.
  const activeAnimals = p3Simulation.animals.filter((animal) => animal.phase !== "captured");
  const p3SubjectX = activeAnimals.length > 0
    ? activeAnimals.reduce((sum, animal) => sum + animal.x, 0) / activeAnimals.length
    : p3Simulation.pen.centerX;
  const p3SubjectZ = activeAnimals.length > 0
    ? activeAnimals.reduce((sum, animal) => sum + animal.z, 0) / activeAnimals.length
    : p3Simulation.pen.centerZ;
  const p5ActiveAnimals = p5Simulation.animals.filter(
    (animal) => animal.lifeState !== "captured" && animal.lifeState !== "disabled",
  );
  const p5SubjectX = p5ActiveAnimals.length > 0
    ? p5ActiveAnimals.reduce((sum, animal) => sum + animal.x, 0) / p5ActiveAnimals.length
    : 0;
  const p5SubjectZ = p5ActiveAnimals.length > 0
    ? p5ActiveAnimals.reduce((sum, animal) => sum + animal.z, 0) / p5ActiveAnimals.length
    : -8;
  const subjectX = p5WorldMode
    ? p5SubjectX
    : p4Mode
      ? (p4Simulation.predator.x + p4Simulation.victim.x) / 2
      : p3SubjectX;
  const subjectZ = p5WorldMode
    ? p5SubjectZ
    : p4Mode
      ? (p4Simulation.predator.z + p4Simulation.victim.z) / 2
      : p3SubjectZ;
  const focusX = THREE.MathUtils.lerp(player.position.x, subjectX, 0.35);
  const focusZ = THREE.MathUtils.lerp(player.position.z, subjectZ, 0.35);
  cameraTarget.set(focusX, 0.85, focusZ);
  desiredCameraPosition.set(
    focusX - Math.sin(snapshot.cameraYaw) * 10.5,
    6.8,
    focusZ + Math.cos(snapshot.cameraYaw) * 10.5,
  );
  const cameraFollow = 1 - Math.exp(-Math.min(renderDeltaSeconds, 0.25) * 9);
  camera.position.lerp(desiredCameraPosition, cameraFollow);
  camera.lookAt(cameraTarget);

  const prototypeInterpolationAlpha = THREE.MathUtils.clamp(
    (p5WorldMode
      ? p5DecisionAccumulator
      : p4Mode
        ? p4DecisionAccumulator
        : p3DecisionAccumulator)
      / (p5WorldMode
        ? P5_DECISION_SECONDS
        : p4Mode
          ? P4_DECISION_SECONDS
          : P3_DECISION_SECONDS),
    0,
    1,
  );
  if (p5WorldMode) {
    updateP5Visuals(prototypeInterpolationAlpha);
  } else if (p4Mode) {
    updateP4Visuals(prototypeInterpolationAlpha);
  } else {
    updateP3Visuals(prototypeInterpolationAlpha);
  }
  updateDiagnostics(renderDeltaSeconds, movement.speed);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function getP3PublicState(): P3PublicState {
  return {
    capturedCount: p3Simulation.capturedCount,
    completed: p3Simulation.completed,
    decisionUpdates: p3DecisionUpdates,
    penReservedAnimalId: p3Simulation.penReservedAnimalId,
    flock: { ...p3Simulation.flock },
    animals: p3Simulation.animals.map((animal) => ({
      id: animal.id,
      phase: animal.phase,
      pressureBand: animal.pressureBand,
      tension: animal.tension,
      tensionState: animal.tensionState,
      confusionCause: animal.confusionCause,
      waitingSeconds: animal.waitingSeconds,
      recoveryCount: animal.recoveryCount,
      fullBodyInside: animal.fullBodyInside,
      x: animal.x,
      z: animal.z,
    })),
  };
}

function getP4PublicState(): P4PublicState {
  const { predator, victim } = p4Simulation;
  const lastEvent = p4Simulation.events.at(-1) ?? null;
  return {
    status: p4Simulation.status,
    failureReason: p4Simulation.failureReason,
    elapsedSeconds: p4Simulation.elapsedSeconds,
    predator: {
      id: predator.id,
      attackPhase: predator.attackPhase,
      intent: predator.intent,
      x: predator.x,
      z: predator.z,
      threatSeconds: predator.threatSeconds,
      threatCooldownSeconds: predator.threatCooldownSeconds,
      threatResistanceSeconds: predator.threatResistanceSeconds,
      insidePen: predator.insidePen,
      captureHoldSeconds: predator.captureHoldSeconds,
      playerDazedSeconds: predator.playerDazedSeconds,
    },
    victim: {
      id: victim.id,
      lifeState: victim.lifeState,
      rescueSeconds: victim.rescueSeconds,
      protectionSeconds: victim.protectionSeconds,
      rescueCount: victim.rescueCount,
      x: victim.x,
      z: victim.z,
    },
    eventCount: p4Simulation.events.length,
    lastEvent,
  };
}

function getP6PublicState(): P6PublicState {
  return {
    status: p5Simulation.status,
    failureReason: p5Simulation.failureReason,
    introVisible: !p6IntroOverlay.hidden,
    settingsVisible: !p6SettingsOverlay.hidden,
    resultVisible: !p6ResultOverlay.hidden,
    settings: { ...p6Settings },
    result: p6Result,
    record: getP6Record(),
  };
}

function getP5PublicState(): P5PublicState {
  const counts = getP5CapturedCounts();
  return {
    status: p5Simulation.status,
    failureReason: p5Simulation.failureReason,
    elapsedSeconds: p5Simulation.elapsedSeconds,
    capturedCount: counts,
    discoveredRoutes: { ...p5Simulation.discoveredRoutes },
    animals: p5Simulation.animals.map((animal) => ({
      id: animal.id,
      type: animal.type,
      phase: animal.phase,
      lifeState: animal.lifeState,
      route: animal.route,
      x: animal.x,
      z: animal.z,
    })),
    eventCount: p5Simulation.events.length,
    lastEvent: p5Simulation.events.at(-1) ?? null,
  };
}

window.__OITATE_P1__ = {
  getState: () => {
    const snapshot = input.getSnapshot();
    return {
      paused,
      portrait,
      resumeRequired,
      player: {
        x: simulationPosition.x,
        z: simulationPosition.z,
        speed: movement.speed,
      },
      cameraYaw: snapshot.cameraYaw,
      cameraInteractionSeconds,
      owners: snapshot.pointerOwnership,
      cancellationReason: snapshot.cancellationReason,
      rejectedPointerClaims: snapshot.rejectedPointerClaims,
      signalFireCount,
      simulationSteps: fixedStep.diagnostics.totalSteps,
      droppedSimulationSeconds: fixedStep.diagnostics.droppedTimeSeconds,
      p2: getP3PublicState(),
      p3: getP3PublicState(),
    };
  },
};

const p3Api: P2PublicApi = {
  getState: () => window.__OITATE_P1__.getState().p3,
  retry: retryP3Prototype,
  ...(p3E2EEnabled
    ? {
        e2e: {
          runCompletionReplay: runP3CompletionReplay,
          probeEntranceQueue: probeP3EntranceQueue,
        },
      }
    : {}),
};
window.__OITATE_P3__ = p3Api;
// Preserve the P2 diagnostic surface as a compatibility alias for existing
// harnesses while the visible and canonical prototype is now P3.
window.__OITATE_P2__ = {
  ...p3Api,
  getState: () => window.__OITATE_P1__.getState().p2,
};

const p4Api: P4PublicApi = {
  getState: getP4PublicState,
  retry: retryP4Prototype,
  ...(p4E2EEnabled
    ? {
        e2e: {
          primeAim: primeP4Aim,
          runRescueSuccess: runP4RescueSuccess,
          runRescueFailure: runP4RescueFailure,
          runCaptureReplay: runP4CaptureReplay,
        },
      }
    : {}),
};
window.__OITATE_P4__ = p4Api;

const p5Api: P5PublicApi = {
  getState: getP5PublicState,
  retry: retryP5Prototype,
  ...(p5E2EEnabled
    ? {
        e2e: {
          primeAim: primeP5Aim,
          runRescueSuccess: runP5RescueSuccess,
          runRescueFailure: runP5RescueFailure,
          runRouteDiscovery: runP5RouteDiscovery,
          runCompletionReplay: runP5CompletionReplay,
        },
      }
    : {}),
};
window.__OITATE_P5__ = p5Api;

const p6Api: P6PublicApi = {
  getState: getP6PublicState,
  retry: retryP6Prototype,
  ...(p6E2EEnabled
    ? {
        e2e: {
          start: startP6Prototype,
          runCompletionReplay: () => {
            startP6Prototype();
            runP5CompletionReplay();
          },
        },
      }
    : {}),
};
window.__OITATE_P6__ = p6Api;

root.dataset.ready = "true";
// Keep the P1 probe attribute for regression checks while exposing the P3
// world separately for the new slice.
root.dataset.worldEntities = p5WorldMode
  ? "player,coward-1..6,follower-1..4,predator,coward-pen,follower-pen,predator-pen,water,bridge"
  : p4Mode
    ? "player,predator,victim,predator-pen"
    : "player,animal";
root.dataset.p2WorldEntities = "player,coward-1,coward-2,coward-3,coward-4,coward-5,coward-6,pen";
root.dataset.p3WorldEntities = "player,coward-1,coward-2,coward-3,coward-4,coward-5,coward-6,pen";
root.dataset.p4WorldEntities = "player,predator,victim,predator-pen";
root.dataset.p5WorldEntities = "player,coward-1..6,follower-1..4,predator,coward-pen,follower-pen,predator-pen,water,bridge";
root.dataset.p6WorldEntities = "player,coward-1..6,follower-1..4,predator,coward-pen,follower-pen,predator-pen,water,bridge";
root.dataset.p6Mode = String(p6Mode);
requestAnimationFrame(frame);
