export const MOVEMENT_DEAD_ZONE = 0.25;
export const MOVEMENT_WALK_THRESHOLD = 0.68;
export const ACCELERATION_SECONDS = 0.15;

export interface MovementTuning {
  walkSpeed: number;
  runSpeed: number;
}

export const DEFAULT_MOVEMENT_TUNING: MovementTuning = {
  walkSpeed: 2.2,
  runSpeed: 4.8,
};

export interface MovementVector {
  x: number;
  z: number;
  magnitude: number;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothStep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/**
 * Converts the physical stick magnitude into a continuous walk/run target.
 * The dead zone and walk threshold are deliberately kept as named constants
 * because they are part of the P1 input contract.
 */
export function targetSpeedForMagnitude(
  magnitude: number,
  tuning: MovementTuning = DEFAULT_MOVEMENT_TUNING,
): number {
  const value = clamp01(magnitude);
  if (value <= MOVEMENT_DEAD_ZONE) {
    return 0;
  }

  if (value <= MOVEMENT_WALK_THRESHOLD) {
    const walkProgress =
      (value - MOVEMENT_DEAD_ZONE) /
      (MOVEMENT_WALK_THRESHOLD - MOVEMENT_DEAD_ZONE);
    return tuning.walkSpeed * smoothStep(walkProgress);
  }

  const runProgress =
    (value - MOVEMENT_WALK_THRESHOLD) /
    (1 - MOVEMENT_WALK_THRESHOLD);
  return tuning.walkSpeed +
    (tuning.runSpeed - tuning.walkSpeed) * smoothStep(runProgress);
}

/**
 * Applies the roughly 150ms acceleration/deceleration envelope requested by
 * the operation prototype. Exponential smoothing reaches 63% of the target
 * in one envelope and never overshoots.
 */
export function approachSpeed(
  currentSpeed: number,
  targetSpeed: number,
  deltaSeconds: number,
  envelopeSeconds = ACCELERATION_SECONDS,
): number {
  if (deltaSeconds <= 0 || envelopeSeconds <= 0) {
    return currentSpeed;
  }
  const alpha = 1 - Math.exp(-deltaSeconds / envelopeSeconds);
  const next = currentSpeed + (targetSpeed - currentSpeed) * alpha;
  return Math.abs(next) < 0.0001 ? 0 : next;
}

export class MovementDynamics {
  private currentSpeed = 0;

  public constructor(
    private readonly tuning: MovementTuning = DEFAULT_MOVEMENT_TUNING,
    private readonly envelopeSeconds = ACCELERATION_SECONDS,
  ) {}

  public update(magnitude: number, deltaSeconds: number): number {
    const target = targetSpeedForMagnitude(magnitude, this.tuning);
    this.currentSpeed = approachSpeed(
      this.currentSpeed,
      target,
      deltaSeconds,
      this.envelopeSeconds,
    );
    return this.currentSpeed;
  }

  public get speed(): number {
    return this.currentSpeed;
  }

  public reset(): void {
    this.currentSpeed = 0;
  }
}

/**
 * Transforms the screen-space joystick vector into a world-space direction.
 * Y-up on the stick means forward. At yaw zero, forward is world -Z.
 */
export function worldDirectionFromJoystick(
  joystickX: number,
  joystickY: number,
  basisYaw: number,
): MovementVector {
  const rawMagnitude = Math.hypot(joystickX, joystickY);
  const magnitude = Math.min(1, rawMagnitude);
  if (rawMagnitude === 0 || magnitude === 0) {
    return { x: 0, z: 0, magnitude: 0 };
  }

  const x = joystickX / rawMagnitude;
  const forwardInput = -joystickY / rawMagnitude;
  const rightX = Math.cos(basisYaw);
  const rightZ = -Math.sin(basisYaw);
  const forwardX = Math.sin(basisYaw);
  const forwardZ = -Math.cos(basisYaw);

  return {
    x: rightX * x + forwardX * forwardInput,
    z: rightZ * x + forwardZ * forwardInput,
    magnitude,
  };
}

export function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function smoothAngle(
  from: number,
  to: number,
  deltaSeconds: number,
  envelopeSeconds = ACCELERATION_SECONDS,
): number {
  if (deltaSeconds <= 0 || envelopeSeconds <= 0) return from;
  const alpha = 1 - Math.exp(-deltaSeconds / envelopeSeconds);
  return from + shortestAngleDelta(from, to) * alpha;
}
