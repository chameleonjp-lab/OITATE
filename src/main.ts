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
  createP2Simulation,
  P2_TUNING,
  stepP2Simulation,
  type CowardAnimalState,
  type P2SimulationState,
} from "./game/p2-cowardly-simulation";
import { FixedStepSimulation } from "./game/fixed-step";
import "./styles.css";

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
  p2: {
    capturedCount: number;
    completed: boolean;
    decisionUpdates: number;
    penReservedAnimalId: string | null;
    animals: Array<{
      id: string;
      phase: CowardAnimalState["phase"];
      pressureBand: CowardAnimalState["pressureBand"];
      fullBodyInside: boolean;
      x: number;
      z: number;
    }>;
  };
}

interface P2EntranceQueueProbe {
  /** Fixed fixture evidence for the body-aware entrance sweep. */
  entranceClearance: number;
  outerFaceZ: number;
  minimumAnimalSeparation: number;
  decisionStepSeconds: number;
  initialCandidates: Array<{ id: string; x: number; z: number }>;
  firstStepReservedAnimalId: string | null;
  firstStepAnimals: Array<{
    id: string;
    phase: CowardAnimalState["phase"];
    x: number;
    z: number;
  }>;
  reservedAnimalId: string | null;
  enteringAnimalIds: string[];
  capturedCount: number;
}

interface P2E2ETestHooks {
  runCompletionReplay: () => void;
  probeEntranceQueue: () => P2EntranceQueueProbe;
}

interface P2PublicApi {
  getState: () => P1State["p2"];
  retry: () => void;
  /** Test-only actions are added only for ?p2-e2e=1. */
  e2e?: P2E2ETestHooks;
}

declare global {
  interface Window {
    __OITATE_P1__: {
      getState: () => P1State;
    };
    /** State access remains compatible with the P1 diagnostic surface. */
    __OITATE_P2__: P2PublicApi;
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
          <p class="eyebrow p2-eyebrow">P2 面白さ試作</p>
          <h1>臆病種を囲いへ</h1>
        </div>
        <button class="icon-button" type="button" data-action="pause" aria-label="一時停止">Ⅱ</button>
      </header>

      <section class="p2-status" data-testid="p2-status" aria-live="polite" aria-label="P2試作の状態">
        <strong>動物の反応を観察する</strong>
        <span id="p2-status-text">3体の反応を観察し、囲いへ導きます</span>
        <span id="p2-count-text">収容 0 / 3</span>
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

      <div class="world-label animal-label" aria-hidden="true">臆病種 × 3</div>
      <div class="world-label player-label" aria-hidden="true">主人公</div>
      <div class="signal-feedback" id="signal-feedback" aria-live="polite"></div>

      <div class="camera-zone" aria-label="右側カメラ操作領域" data-testid="camera-zone"></div>
      <div class="joystick-zone" aria-label="左側移動領域" data-testid="joystick-zone">
        <div class="joystick-base" aria-hidden="true">
          <div class="joystick-knob"></div>
        </div>
        <span class="zone-hint">ここに触れて移動</span>
      </div>

      <div class="signal-controls" aria-label="P1用入力回帰（P2では動物に効果なし）">
        <span class="signal-note">P1入力回帰<br />P2では効果なし</span>
        <button type="button" class="signal-button guidance" data-signal="guidance" data-signal-state="idle" data-fire-count="0">
          <span aria-hidden="true">♪</span><small>誘導</small>
        </button>
        <button type="button" class="signal-button threat" data-signal="threat" data-signal-state="idle" data-fire-count="0">
          <span aria-hidden="true">!</span><small>威嚇</small>
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
        <p class="eyebrow">P2 面白さ試作</p>
        <h2 id="p2-complete-title">3体を囲いへ収容しました</h2>
        <p>主人公の位置で反応を読み、反対側へ回り込む遊びをもう一度試せます。</p>
        <button type="button" class="resume-button" data-action="p2-retry">もう一度試す</button>
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
const p2StatusText = required<HTMLElement>("#p2-status-text");
const p2CountText = required<HTMLElement>("#p2-count-text");
const p2CompleteOverlay = required<HTMLElement>("#p2-complete-overlay");
const p2RetryButton = required<HTMLButtonElement>("[data-action='p2-retry']");
const signalControls = required<HTMLElement>(".signal-controls");
const query = new URLSearchParams(window.location.search);
const p1ProbeEnabled = query.get("p1-probe") === "1";
const p2E2EEnabled = import.meta.env.DEV && query.get("p2-e2e") === "1";
const debugEnabled = p1ProbeEnabled || query.get("debug") === "1";
signalControls.hidden = !p1ProbeEnabled;
root.querySelector<HTMLElement>(".p1-eyebrow")?.toggleAttribute("hidden", !p1ProbeEnabled);
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

const cowardVisualColors = [0xf0ead8, 0xd7f0df, 0xf3d6b6] as const;
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

createCowardVisual(0);
createCowardVisual(1);
createCowardVisual(2);

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
let p2Simulation: P2SimulationState = createP2Simulation();
const P2_DECISION_SECONDS = 1 / 20;
const PLAYER_COLLISION_RADIUS = 0.52;
let p2DecisionAccumulator = 0;
let p2DecisionUpdates = 0;
let p2CompleteShown = false;
let previousFocus: HTMLElement | null = null;

function clearSimulationDebt(): void {
  fixedStep.clearAccumulator();
  p2DecisionAccumulator = 0;
  previousSimulationPosition.copy(simulationPosition);
  player.position.copy(simulationPosition);
  for (const animal of p2Simulation.animals) {
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
    ? "誘導入力（P2では動物に効果なし）"
    : "威嚇入力（P2では動物に効果なし）";
  feedback.dataset.signal = signal;
  feedback.classList.remove("is-visible");
  void feedback.offsetWidth;
  feedback.classList.add("is-visible");
  lastSignalLatency = performance.now() - startedAt;
  window.setTimeout(() => feedback.classList.remove("is-visible"), 520);
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

function resetP2Prototype(): void {
  p2Simulation = createP2Simulation();
  p2DecisionAccumulator = 0;
  p2DecisionUpdates = 0;
  p2CompleteShown = false;
  p2StatusText.textContent = "3体の反応を観察し、囲いへ導きます";
  p2CountText.textContent = "収容 0 / 3";
  simulationPosition.set(0, 0, 4.5);
  previousSimulationPosition.copy(simulationPosition);
  player.position.copy(simulationPosition);
  simulationRotationY = 0;
  clearSimulationDebt();
}

function showP2Complete(): void {
  if (p2CompleteShown) return;
  p2CompleteShown = true;
  paused = true;
  resumeRequired = false;
  input.clearAllInput("manual-clear");
  p2StatusText.textContent = "3体とも全身が囲いの内側へ入りました";
  p2CountText.textContent = "収容 3 / 3　試作完了";
  p2CompleteOverlay.hidden = false;
  blockInteraction(p2RetryButton);
}

function retryP2Prototype(): void {
  if (!p2CompleteShown) return;
  p2CompleteOverlay.hidden = true;
  resetP2Prototype();
  paused = false;
  resumeRequired = false;
  if (interactionLayer.inert) unblockInteraction();
  lastFrameTime = performance.now();
}

p2RetryButton.addEventListener("click", retryP2Prototype);

/**
 * Runs one animal decision through the production P2 simulation. E2E replay
 * helpers use this same path with a deterministic fixture instead of
 * reimplementing the capture or entrance rules in the browser harness.
 */
function stepP2DecisionAtPlayer(
  x: number,
  z: number,
  speed: number,
  isRunning: boolean,
  deltaSeconds: number,
): void {
  const decision = stepP2Simulation(
    p2Simulation,
    { x, z, speed, isRunning },
    deltaSeconds,
  );
  p2DecisionUpdates += 1;
  if (decision.completed) showP2Complete();
  updateP2Status();
}

function prepareP2E2EFixture(): void {
  p2CompleteOverlay.hidden = true;
  if (interactionLayer.inert) unblockInteraction();
  resetP2Prototype();
  input.clearAllInput("manual-clear");
  paused = false;
  resumeRequired = false;
  lastFrameTime = performance.now();
}

function primeEnteringAnimal(index: number): void {
  const animal = p2Simulation.animals[index];
  if (!animal) throw new Error(`P2 E2E fixture animal ${index} is missing`);
  const x = [-1.55, 0, 1.55][index] ?? 0;
  animal.x = x;
  animal.z = p2Simulation.pen.centerZ;
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
  // The fixture represents an already granted entrance token; the
  // production reconciliation then owns and advances this body normally.
  p2Simulation.penReservedAnimalId = animal.id;
}

function runP2CompletionReplay(): void {
  prepareP2E2EFixture();
  const playerX = 0;
  const playerZ = 4.5;

  for (let index = 0; index < p2Simulation.animals.length; index += 1) {
    primeEnteringAnimal(index);
    const animal = p2Simulation.animals[index];
    for (let holdStep = 0; holdStep < 10 && animal?.phase !== "captured"; holdStep += 1) {
      stepP2DecisionAtPlayer(
        playerX,
        playerZ,
        0,
        false,
        P2_DECISION_SECONDS,
      );
    }
    if (animal?.phase !== "captured") {
      throw new Error(`P2 E2E completion fixture did not capture ${animal?.id ?? index}`);
    }
  }
}

function probeP2EntranceQueue(): P2EntranceQueueProbe {
  prepareP2E2EFixture();
  const entranceClearance = p2Simulation.pen.entranceHalfWidth - p2Simulation.pen.animalRadius;
  const outerFaceZ = p2Simulation.pen.entranceZ + p2Simulation.pen.animalRadius;
  const queueSpacing = P2_TUNING.minimumAnimalSeparation;
  const candidates = [
    // The queue is deliberately non-overlapping. Only the nearest body is
    // close enough to self-sweep this tick; both followers remain outside.
    { x: 0, z: outerFaceZ + queueSpacing * 2 + 0.02 },
    { x: 0, z: outerFaceZ + queueSpacing + 0.02 },
    { x: 0, z: outerFaceZ + 0.02 },
  ];
  const initialCandidates = candidates.map((candidate, index) => ({
    id: p2Simulation.animals[index]?.id ?? `coward-${index + 1}`,
    ...candidate,
  }));
  for (const [index, candidate] of candidates.entries()) {
    const animal = p2Simulation.animals[index];
    if (!animal) throw new Error(`P2 E2E entrance fixture animal ${index} is missing`);
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

  // Acquire the actual owner only after a production step; the two
  // non-owners remain outside as a physically separated waiting queue.
  stepP2DecisionAtPlayer(0, 0, 0, false, P2_DECISION_SECONDS);
  const firstStepReservedAnimalId = p2Simulation.penReservedAnimalId;
  if (!firstStepReservedAnimalId) {
    throw new Error("P2 E2E entrance fixture did not reserve an owner on the first step");
  }
  const firstStepAnimals = p2Simulation.animals.map((animal) => ({
    id: animal.id,
    phase: animal.phase,
    x: animal.x,
    z: animal.z,
  }));

  const reservedCandidate = p2Simulation.animals.find(
    (animal) => animal.id === firstStepReservedAnimalId,
  );
  for (let attempt = 0; attempt < 48; attempt += 1) {
    if (reservedCandidate?.phase === "enteringPen") break;
    // Keep the player behind the real owner while the production simulation
    // advances it through the opening; no state is written by this hook.
    stepP2DecisionAtPlayer(
      reservedCandidate?.x ?? 0,
      (reservedCandidate?.z ?? outerFaceZ) + 2.4,
      0,
      false,
      P2_DECISION_SECONDS,
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
    decisionStepSeconds: P2_DECISION_SECONDS,
    initialCandidates,
    firstStepReservedAnimalId,
    firstStepAnimals,
    reservedAnimalId: p2Simulation.penReservedAnimalId,
    enteringAnimalIds: p2Simulation.animals
      .filter((animal) => animal.phase === "enteringPen")
      .map((animal) => animal.id),
    capturedCount: p2Simulation.capturedCount,
  };
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

function updateP2Status(): void {
  p2CountText.textContent = p2Simulation.completed
    ? "収容 3 / 3　試作完了"
    : `収容 ${p2Simulation.capturedCount} / 3`;
  if (p2Simulation.completed) {
    p2StatusText.textContent = "3体とも全身が囲いの内側へ入りました";
    return;
  }
  const anticipating = p2Simulation.animals.some((animal) => animal.phase === "anticipating");
  const fleeing = p2Simulation.animals.some((animal) => animal.phase === "fleeing");
  const entering = p2Simulation.animals.some((animal) => animal.phase === "enteringPen");
  if (anticipating) {
    p2StatusText.textContent = "動物がこちらを見ています";
  } else if (fleeing) {
    p2StatusText.textContent = "動物が反応しています";
  } else if (entering) {
    p2StatusText.textContent = "囲いへ進入中：全身が内側へ入るまで待ちます";
  } else {
    p2StatusText.textContent = "3体の反応を観察し、囲いへ導きます";
  }
}

function updateP2Visuals(interpolationAlpha: number): void {
  for (let index = 0; index < cowardVisuals.length; index += 1) {
    const visual = cowardVisuals[index];
    const animal = p2Simulation.animals[index];
    if (!visual || !animal) continue;
    visual.group.position.set(
      THREE.MathUtils.lerp(animal.previousX, animal.x, interpolationAlpha),
      0,
      THREE.MathUtils.lerp(animal.previousZ, animal.z, interpolationAlpha),
    );
    // Captured animals remain visible in the pen so success is readable.
    visual.group.visible = true;
    visual.reactionRing.visible = animal.phase === "anticipating";
    visual.escapeArrow.visible = debugEnabled
      && (animal.phase === "anticipating" || animal.phase === "fleeing");
    const direction = animal.phase === "anticipating"
      ? { x: animal.escapeX, z: animal.escapeZ }
      : { x: animal.lastMoveX, z: animal.lastMoveZ };
    if (Math.hypot(direction.x, direction.z) > 0.01) {
      visual.group.rotation.y = Math.atan2(-direction.x, -direction.z);
      visual.escapeArrow.rotation.y = Math.atan2(direction.x, direction.z);
    }
    if (animal.phase === "anticipating") {
      const pulse = 1 + Math.sin(animal.phaseSeconds * 14) * 0.08;
      visual.reactionRing.scale.setScalar(pulse);
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
  root.dataset.p2Captured = String(p2Simulation.capturedCount);
  root.dataset.p2Complete = String(p2Simulation.completed);
  root.dataset.paused = String(paused);
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
    const constrainedPlayer = constrainCircleAgainstPenRails(
      previousSimulationPosition,
      simulationPosition,
      p2Simulation.pen,
      PLAYER_COLLISION_RADIUS,
    );
    simulationPosition.x = constrainedPlayer.x;
    simulationPosition.z = constrainedPlayer.z;
    if (direction.magnitude > 0.02 && speed > 0.02) {
      simulationRotationY = Math.atan2(-direction.x, -direction.z);
    }

    // P1 keeps integrating input and the player at 60Hz. The P2 animal
    // decision slice is intentionally lower-frequency and deterministic.
    p2DecisionAccumulator += stepSeconds;
    while (p2DecisionAccumulator >= P2_DECISION_SECONDS) {
      p2DecisionAccumulator -= P2_DECISION_SECONDS;
      stepP2DecisionAtPlayer(
        simulationPosition.x,
        simulationPosition.z,
        speed,
        speed >= 3.2,
        P2_DECISION_SECONDS,
      );
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

  // Keep the active animals readable while retaining the P1 camera yaw and
  // movement-basis rules. The 35/65 focus is a view aid, not auto-navigation.
  const activeAnimals = p2Simulation.animals.filter((animal) => animal.phase !== "captured");
  const subjectX = activeAnimals.length > 0
    ? activeAnimals.reduce((sum, animal) => sum + animal.x, 0) / activeAnimals.length
    : p2Simulation.pen.centerX;
  const subjectZ = activeAnimals.length > 0
    ? activeAnimals.reduce((sum, animal) => sum + animal.z, 0) / activeAnimals.length
    : p2Simulation.pen.centerZ;
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

  const p2InterpolationAlpha = THREE.MathUtils.clamp(
    p2DecisionAccumulator / P2_DECISION_SECONDS,
    0,
    1,
  );
  updateP2Visuals(p2InterpolationAlpha);
  updateDiagnostics(renderDeltaSeconds, movement.speed);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
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
      p2: {
        capturedCount: p2Simulation.capturedCount,
        completed: p2Simulation.completed,
        decisionUpdates: p2DecisionUpdates,
        penReservedAnimalId: p2Simulation.penReservedAnimalId,
        animals: p2Simulation.animals.map((animal) => ({
          id: animal.id,
          phase: animal.phase,
          pressureBand: animal.pressureBand,
          fullBodyInside: animal.fullBodyInside,
          x: animal.x,
          z: animal.z,
        })),
      },
    };
  },
};

window.__OITATE_P2__ = {
  getState: () => window.__OITATE_P1__.getState().p2,
  retry: retryP2Prototype,
  ...(p2E2EEnabled
    ? {
        e2e: {
          runCompletionReplay: runP2CompletionReplay,
          probeEntranceQueue: probeP2EntranceQueue,
        },
      }
    : {}),
};

root.dataset.ready = "true";
// Keep the P1 probe attribute for regression checks while exposing the P2
// world separately for the new slice.
root.dataset.worldEntities = "player,animal";
root.dataset.p2WorldEntities = "player,coward-1,coward-2,coward-3,pen";
requestAnimationFrame(frame);
