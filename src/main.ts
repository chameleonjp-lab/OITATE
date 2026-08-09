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
}

declare global {
  interface Window {
    __OITATE_P1__: {
      getState: () => P1State;
    };
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
          <p class="eyebrow">P1 操作試作</p>
          <h1>移動・カメラ・複数指の確認</h1>
        </div>
        <button class="icon-button" type="button" data-action="pause" aria-label="一時停止">Ⅱ</button>
      </header>

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

      <div class="world-label animal-label" aria-hidden="true">仮動物</div>
      <div class="world-label player-label" aria-hidden="true">主人公</div>
      <div class="signal-feedback" id="signal-feedback" aria-live="polite"></div>

      <div class="camera-zone" aria-label="右側カメラ操作領域" data-testid="camera-zone"></div>
      <div class="joystick-zone" aria-label="左側移動領域" data-testid="joystick-zone">
        <div class="joystick-base" aria-hidden="true">
          <div class="joystick-knob"></div>
        </div>
        <span class="zone-hint">ここに触れて移動</span>
      </div>

      <div class="signal-controls" aria-label="P1用の合図入力確認">
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

const animal = new THREE.Group();
const animalBody = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 0.76, 1.45),
  new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.95 }),
);
animalBody.position.y = 0.78;
const animalHead = new THREE.Mesh(
  new THREE.BoxGeometry(0.62, 0.62, 0.62),
  new THREE.MeshStandardMaterial({ color: 0xc98c58, roughness: 0.9 }),
);
animalHead.position.set(0, 0.88, -0.92);
animal.add(animalBody, animalHead);
for (const x of [-0.4, 0.4]) {
  for (const z of [-0.48, 0.48]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.58, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x6e4d39, roughness: 0.9 }),
    );
    leg.position.set(x, 0.3, z);
    animal.add(leg);
  }
}
animal.position.set(0, 0, -4.5);
scene.add(animal);

for (const [x, z, color] of [
  [-8, -7, 0xe56c62],
  [8, -7, 0xe1bc58],
  [-8, 7, 0x5aa9d6],
  [8, 7, 0xa875d6],
] as const) {
  const marker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 2.2, 8),
    new THREE.MeshStandardMaterial({ color }),
  );
  marker.position.set(x, 1.1, z);
  scene.add(marker);
}

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
let previousFocus: HTMLElement | null = null;

function clearSimulationDebt(): void {
  fixedStep.clearAccumulator();
  previousSimulationPosition.copy(simulationPosition);
  player.position.copy(simulationPosition);
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
  if (paused || portrait) return;
  const startedAt = performance.now();
  const button = required<HTMLButtonElement>(`button[data-signal='${signal}']`);
  signalFireCount += 1;
  button.dataset.fireCount = String(Number(button.dataset.fireCount ?? "0") + 1);
  button.classList.remove("did-fire");
  void button.offsetWidth;
  button.classList.add("did-fire");
  feedback.textContent = signal === "guidance" ? "誘導入力を受け付けました" : "威嚇入力を受け付けました";
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
    if (direction.magnitude > 0.02 && speed > 0.02) {
      simulationRotationY = Math.atan2(-direction.x, -direction.z);
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

  cameraTarget.set(player.position.x, 0.85, player.position.z);
  desiredCameraPosition.set(
    player.position.x - Math.sin(snapshot.cameraYaw) * 7.8,
    5.5,
    player.position.z + Math.cos(snapshot.cameraYaw) * 7.8,
  );
  const cameraFollow = 1 - Math.exp(-Math.min(renderDeltaSeconds, 0.25) * 9);
  camera.position.lerp(desiredCameraPosition, cameraFollow);
  camera.lookAt(cameraTarget);

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
    };
  },
};

root.dataset.ready = "true";
root.dataset.worldEntities = "player,animal";
requestAnimationFrame(frame);
