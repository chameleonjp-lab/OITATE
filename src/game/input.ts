import {
  clamp01,
  smoothAngle,
  shortestAngleDelta,
} from "./movement";
import {
  PointerOwnership,
  type InputCancellationReason,
  type PointerOwnershipSnapshot,
} from "./input-state";

export type SignalType = "guidance" | "threat";
export type LifecyclePauseReason = "visibility" | "blur" | "pagehide";
export type LifecycleReturnReason = "visibility" | "focus" | "pageshow";

export interface InputSnapshot {
  joystickX: number;
  joystickY: number;
  joystickMagnitude: number;
  movementBasisYaw: number;
  cameraYaw: number;
  cameraInteractionActive: boolean;
  pointerOwnership: PointerOwnershipSnapshot;
  cancellationReason: InputCancellationReason | null;
  rejectedPointerClaims: number;
}

export interface InputControllerOptions {
  onSignalReleased: (signal: SignalType) => void;
  onInputCleared: (reason: InputCancellationReason) => void;
  onOrientationChanged: (portrait: boolean) => void;
  onLifecyclePauseRequested: (reason: LifecyclePauseReason) => void;
  onLifecycleReturn: (reason: LifecycleReturnReason) => void;
  onPauseRequested: () => void;
}

interface MovementOrigin {
  pointerId: number;
  x: number;
  y: number;
  radius: number;
}

interface CameraPointer {
  pointerId: number;
  x: number;
}

interface SignalPointer {
  pointerId: number;
  signal: SignalType;
  button: HTMLButtonElement;
  canceled: boolean;
}

const KEY_TO_AXIS: Record<string, { x: number; y: number }> = {
  KeyW: { x: 0, y: -1 },
  ArrowUp: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

const SIGNAL_CONTROLS: readonly SignalType[] = ["guidance", "threat"];

export function isPortraitViewport(): boolean {
  return window.innerHeight > window.innerWidth;
}

function normalizeAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  let normalized = angle % fullTurn;
  if (normalized > Math.PI) normalized -= fullTurn;
  if (normalized < -Math.PI) normalized += fullTurn;
  return normalized;
}

function preventDefault(event: Event): void {
  event.preventDefault();
}

/**
 * Owns the touch, pointer, keyboard, and mouse fallback paths. The game loop
 * reads a snapshot; all DOM events only mutate this input state.
 */
export class InputController {
  public readonly ownership = new PointerOwnership();

  private readonly movementZone: HTMLElement;
  private readonly joystickBase: HTMLElement;
  private readonly joystickKnob: HTMLElement;
  private readonly cameraZone: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly signalButtons = new Map<SignalType, HTMLButtonElement>();
  private readonly activeSignals = new Map<number, SignalPointer>();
  private readonly keys = new Set<string>();
  private movementOrigin: MovementOrigin | null = null;
  private cameraPointer: CameraPointer | null = null;
  private joystickX = 0;
  private joystickY = 0;
  private keyboardBasisActive = false;
  private cameraYaw = 0;
  private movementBasisYaw = 0;
  private movementBasisTargetYaw = 0;
  private lastPortrait: boolean;

  public constructor(
    private readonly root: HTMLElement,
    private readonly options: InputControllerOptions,
  ) {
    this.movementZone = this.requiredElement<HTMLElement>(".joystick-zone");
    this.joystickBase = this.requiredElement<HTMLElement>(".joystick-base");
    this.joystickKnob = this.requiredElement<HTMLElement>(".joystick-knob");
    this.cameraZone = this.requiredElement<HTMLElement>(".camera-zone");
    this.pauseButton = this.requiredElement<HTMLButtonElement>(
      "[data-action='pause']",
    );

    for (const signal of SIGNAL_CONTROLS) {
      const button = this.requiredElement<HTMLButtonElement>(
        `button[data-signal='${signal}']`,
      );
      this.signalButtons.set(signal, button);
      this.bindSignalButton(button, signal);
    }

    this.lastPortrait = isPortraitViewport();
    this.bindPointerEvents();
    this.bindKeyboardFallback();
    this.bindLifecycleEvents();
    this.bindGestureSuppression();
  }

  public update(deltaSeconds: number): void {
    const movementActive =
      this.movementOrigin !== null || this.keys.size > 0;
    if (movementActive) {
      this.movementBasisYaw = smoothAngle(
        this.movementBasisYaw,
        this.movementBasisTargetYaw,
        deltaSeconds,
      );
    }
  }

  public getSnapshot(): InputSnapshot {
    const vector = this.movementOrigin
      ? { x: this.joystickX, y: this.joystickY }
      : this.keyboardVector();
    const magnitude = Math.min(1, Math.hypot(vector.x, vector.y));

    return {
      joystickX: vector.x,
      joystickY: vector.y,
      joystickMagnitude: magnitude,
      movementBasisYaw: this.movementBasisYaw,
      cameraYaw: this.cameraYaw,
      cameraInteractionActive: this.cameraPointer !== null,
      pointerOwnership: this.ownership.snapshot(),
      cancellationReason: this.ownership.lastCancellationReason,
      rejectedPointerClaims: this.ownership.rejectedClaims,
    };
  }

  public get cameraHeading(): number {
    return this.cameraYaw;
  }

  public clearAllInput(reason: InputCancellationReason): void {
    this.ownership.clear(reason);
    this.movementOrigin = null;
    this.cameraPointer = null;
    this.activeSignals.clear();
    this.keys.clear();
    this.joystickX = 0;
    this.joystickY = 0;
    this.keyboardBasisActive = false;
    this.joystickBase.classList.remove("is-visible");
    this.joystickKnob.style.transform = "translate(-50%, -50%)";
    for (const button of this.signalButtons.values()) {
      button.classList.remove("is-armed", "is-canceled");
      button.dataset.signalState = "idle";
    }
    this.options.onInputCleared(reason);
  }

  public dispose(): void {
    this.clearAllInput("manual-clear");
  }

  private requiredElement<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing OITATE input element: ${selector}`);
    }
    return element;
  }

  private bindPointerEvents(): void {
    this.movementZone.addEventListener("pointerdown", this.onMovementDown);
    this.movementZone.addEventListener("pointermove", this.onMovementMove);
    this.movementZone.addEventListener("pointerup", this.onMovementUp);
    this.movementZone.addEventListener("pointercancel", this.onMovementCancel);
    this.movementZone.addEventListener(
      "lostpointercapture",
      this.onLostPointerCapture,
    );

    this.cameraZone.addEventListener("pointerdown", this.onCameraDown);
    this.cameraZone.addEventListener("pointermove", this.onCameraMove);
    this.cameraZone.addEventListener("pointerup", this.onCameraUp);
    this.cameraZone.addEventListener("pointercancel", this.onCameraCancel);
    this.cameraZone.addEventListener(
      "lostpointercapture",
      this.onLostPointerCapture,
    );
  }

  private bindSignalButton(
    button: HTMLButtonElement,
    signal: SignalType,
  ): void {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (!this.ownership.claim(signal, event.pointerId)) return;
      this.capturePointerSafely(button, event.pointerId);
      button.classList.add("is-armed");
      button.classList.remove("is-canceled");
      button.dataset.signalState = "armed";
      this.activeSignals.set(event.pointerId, {
        pointerId: event.pointerId,
        signal,
        button,
        canceled: false,
      });
    });

    button.addEventListener("pointermove", (event) => {
      const active = this.activeSignals.get(event.pointerId);
      if (!active) return;
      event.preventDefault();
      const bounds = button.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      const distance = Math.hypot(
        event.clientX - centerX,
        event.clientY - centerY,
      );
      const cancelDistance = Math.max(bounds.width, bounds.height) * 0.72;
      if (distance > cancelDistance && !active.canceled) {
        active.canceled = true;
        this.ownership.cancel("signal-slide-out");
        button.classList.add("is-canceled");
        button.dataset.signalState = "canceled";
      } else if (distance <= cancelDistance && active.canceled) {
        active.canceled = false;
        button.classList.remove("is-canceled");
        button.dataset.signalState = "armed";
      }
    });

    button.addEventListener("pointerup", this.onGlobalPointerUp);

    button.addEventListener("pointercancel", () => {
      this.clearAllInput("pointercancel");
    });
    button.addEventListener("lostpointercapture", () => {
      if ([...this.activeSignals.values()].some((item) => item.button === button)) {
        this.clearAllInput("lostpointercapture");
      }
    });
  }

  private readonly onMovementDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.ownership.claim("movement", event.pointerId)) {
      return;
    }
    event.preventDefault();
    this.capturePointerSafely(this.movementZone, event.pointerId);
    const bounds = this.movementZone.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const radius = Math.max(44, Math.min(76, Math.min(bounds.width, bounds.height) * 0.15));
    this.movementOrigin = { pointerId: event.pointerId, x, y, radius };
    this.joystickX = 0;
    this.joystickY = 0;
    this.movementBasisYaw = this.cameraYaw;
    this.movementBasisTargetYaw = this.cameraYaw;
    this.joystickBase.style.left = `${x}px`;
    this.joystickBase.style.top = `${y}px`;
    this.joystickBase.classList.add("is-visible");
    this.updateJoystick(event.clientX, event.clientY);
  };

  private readonly onMovementMove = (event: PointerEvent): void => {
    if (!this.movementOrigin || this.movementOrigin.pointerId !== event.pointerId) return;
    event.preventDefault();
    this.updateJoystick(event.clientX, event.clientY);
  };

  private readonly onMovementUp = (event: PointerEvent): void => {
    if (!this.movementOrigin || this.movementOrigin.pointerId !== event.pointerId) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    this.movementOrigin = null;
    this.joystickX = 0;
    this.joystickY = 0;
    this.joystickBase.classList.remove("is-visible");
    this.joystickKnob.style.transform = "translate(-50%, -50%)";
    this.ownership.release("movement", pointerId);
    this.movementBasisYaw = this.cameraYaw;
    this.movementBasisTargetYaw = this.cameraYaw;
    this.releasePointerCaptureSafely(this.movementZone, pointerId);
  };

  private readonly onMovementCancel = (): void => {
    this.clearAllInput("pointercancel");
  };

  private readonly onCameraDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.ownership.claim("camera", event.pointerId)) return;
    event.preventDefault();
    this.capturePointerSafely(this.cameraZone, event.pointerId);
    this.cameraPointer = { pointerId: event.pointerId, x: event.clientX };
  };

  private readonly onCameraMove = (event: PointerEvent): void => {
    if (!this.cameraPointer || this.cameraPointer.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - this.cameraPointer.x;
    this.cameraPointer.x = event.clientX;
    if (deltaX === 0) return;
    this.cameraYaw = normalizeAngle(this.cameraYaw - deltaX * 0.006);
    this.movementBasisTargetYaw = this.cameraYaw;
  };

  private readonly onCameraUp = (event: PointerEvent): void => {
    if (!this.cameraPointer || this.cameraPointer.pointerId !== event.pointerId) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    this.cameraPointer = null;
    this.ownership.release("camera", pointerId);
    this.releasePointerCaptureSafely(this.cameraZone, pointerId);
  };

  private readonly onCameraCancel = (): void => {
    this.clearAllInput("pointercancel");
  };

  private readonly onLostPointerCapture = (event: PointerEvent): void => {
    const movementLost = this.movementOrigin?.pointerId === event.pointerId;
    const cameraLost = this.cameraPointer?.pointerId === event.pointerId;
    if (movementLost || cameraLost) {
      this.clearAllInput("lostpointercapture");
    }
  };

  private updateJoystick(clientX: number, clientY: number): void {
    if (!this.movementOrigin) return;
    const bounds = this.movementZone.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const dx = localX - this.movementOrigin.x;
    const dy = localY - this.movementOrigin.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > this.movementOrigin.radius
      ? this.movementOrigin.radius / distance
      : 1;
    this.joystickX = clamp01(Math.abs(dx * scale / this.movementOrigin.radius)) * Math.sign(dx);
    this.joystickY = clamp01(Math.abs(dy * scale / this.movementOrigin.radius)) * Math.sign(dy);
    this.joystickKnob.style.transform = `translate(calc(-50% + ${dx * scale}px), calc(-50% + ${dy * scale}px))`;
  }

  private bindKeyboardFallback(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const axis = KEY_TO_AXIS[event.code];
    if (axis) {
      event.preventDefault();
      if (!this.keys.has(event.code) && this.keys.size === 0) {
        this.movementBasisYaw = this.cameraYaw;
        this.movementBasisTargetYaw = this.cameraYaw;
        this.keyboardBasisActive = true;
      }
      this.keys.add(event.code);
      return;
    }
    if (event.code === "KeyQ" && !event.repeat) {
      event.preventDefault();
      this.options.onSignalReleased("guidance");
    } else if (event.code === "KeyE" && !event.repeat) {
      event.preventDefault();
      this.options.onSignalReleased("threat");
    } else if (event.code === "Escape" && !event.repeat) {
      event.preventDefault();
      this.options.onPauseRequested();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!KEY_TO_AXIS[event.code]) return;
    event.preventDefault();
    this.keys.delete(event.code);
    if (this.keys.size === 0) {
      this.keyboardBasisActive = false;
      this.movementBasisYaw = this.cameraYaw;
      this.movementBasisTargetYaw = this.cameraYaw;
    }
  };

  private keyboardVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const code of this.keys) {
      const axis = KEY_TO_AXIS[code];
      if (!axis) continue;
      x += axis.x;
      y += axis.y;
    }
    const magnitude = Math.hypot(x, y);
    if (magnitude > 1) {
      x /= magnitude;
      y /= magnitude;
    }
    if (this.keys.size === 0 && this.keyboardBasisActive) {
      this.keyboardBasisActive = false;
    }
    return { x, y };
  }

  private bindLifecycleEvents(): void {
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("orientationchange", this.onOrientationChange);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("blur", this.onWindowBlur);
    window.addEventListener("focus", this.onWindowFocus);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("pageshow", this.onPageShow);
    window.addEventListener("pointercancel", this.onGlobalPointerCancel, true);
    window.addEventListener("pointerup", this.onGlobalPointerUp, true);
    this.pauseButton.addEventListener("click", this.options.onPauseRequested);
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      this.clearAllInput("visibility");
      this.options.onLifecyclePauseRequested("visibility");
      return;
    }
    this.options.onLifecycleReturn("visibility");
  };

  private readonly onOrientationChange = (): void => {
    this.lastPortrait = isPortraitViewport();
    this.clearAllInput("orientation");
    this.options.onOrientationChanged(this.lastPortrait);
  };

  private readonly onResize = (): void => {
    const portrait = isPortraitViewport();
    if (portrait === this.lastPortrait) return;
    this.lastPortrait = portrait;
    this.clearAllInput("orientation");
    this.options.onOrientationChanged(portrait);
  };

  private readonly onWindowBlur = (): void => {
    this.clearAllInput("blur");
    this.options.onLifecyclePauseRequested("blur");
  };

  private readonly onWindowFocus = (): void => {
    this.options.onLifecycleReturn("focus");
  };

  private readonly onPageHide = (): void => {
    this.clearAllInput("pagehide");
    this.options.onLifecyclePauseRequested("pagehide");
  };

  private readonly onPageShow = (): void => {
    this.options.onLifecycleReturn("pageshow");
  };

  private readonly onGlobalPointerCancel = (): void => {
    this.clearAllInput("pointercancel");
  };

  private readonly onGlobalPointerUp = (event: PointerEvent): void => {
    if (this.movementOrigin?.pointerId === event.pointerId) {
      this.onMovementUp(event);
      return;
    }
    if (this.cameraPointer?.pointerId === event.pointerId) {
      this.onCameraUp(event);
      return;
    }

    const active = this.activeSignals.get(event.pointerId);
    if (!active) return;
    event.preventDefault();
    const bounds = active.button.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const cancelDistance = Math.max(bounds.width, bounds.height) * 0.72;
    const releasedOutside = Math.hypot(
      event.clientX - centerX,
      event.clientY - centerY,
    ) > cancelDistance;

    this.activeSignals.delete(event.pointerId);
    this.ownership.release(active.signal, event.pointerId);
    active.button.classList.remove("is-armed", "is-canceled");
    active.button.dataset.signalState = "idle";
    if (!active.canceled && !releasedOutside) {
      this.options.onSignalReleased(active.signal);
    }
    this.releasePointerCaptureSafely(active.button, event.pointerId);
  };

  private bindGestureSuppression(): void {
    this.root.addEventListener("contextmenu", preventDefault);
    this.root.addEventListener("selectstart", preventDefault);
    this.root.addEventListener("dragstart", preventDefault);
  }

  private releasePointerCaptureSafely(element: HTMLElement, pointerId: number): void {
    if (!element.hasPointerCapture(pointerId)) return;
    try {
      element.releasePointerCapture(pointerId);
    } catch {
      // Browsers can release capture between pointerup and this cleanup call.
    }
  }

  private capturePointerSafely(element: HTMLElement, pointerId: number): void {
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // Synthetic browser checks and older WebKit can reject capture. Pointer
      // ownership still prevents a finger from changing controls mid-gesture.
    }
  }
}

export function cameraYawDelta(from: number, to: number): number {
  return shortestAngleDelta(from, to);
}
