/**
 * Deterministic P3 "最初に遊べる版" rules.
 *
 * P2 proved the single pressure rule with three animals. P3 keeps that
 * readable rule and adds six animals, flock cohesion, tension/confusion, and
 * a real entrance queue with bounded recovery. Rendering is intentionally not
 * part of this module so the important game rules remain testable on their
 * own.
 */

import {
  constrainCircleAgainstPenRails,
  DEFAULT_P2_PEN,
  getPressureBand,
  isFullBodyInsidePen,
  isPressureBlockedByPen,
  P2_TUNING,
  type P2Pen,
  type P2PlayerPosition,
  type PressureBand,
} from "./p2-cowardly-simulation";

export type P3MovementPhase =
  | "idle"
  | "anticipating"
  | "fleeing"
  | "waitingForEntrance"
  | "backingOff"
  | "enteringPen"
  | "captured";

export type P3TensionState = "calm" | "alert" | "confused";
export type P3FlockState = "cohesive" | "stretched" | "split";
export type P3ConfusionCause = "none" | "pressure" | "flockSplit" | "entrance";

export interface P3AnimalState {
  id: string;
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  phase: P3MovementPhase;
  phaseSeconds: number;
  captureHoldSeconds: number;
  fullBodyInside: boolean;
  escapeX: number;
  escapeZ: number;
  lastMoveX: number;
  lastMoveZ: number;
  pressureBand: PressureBand;
  fleeTriggerBand: "guidance" | "urgent" | null;
  pressureReleaseSeconds: number;
  tension: number;
  tensionState: P3TensionState;
  confusionSeconds: number;
  confusionCause: P3ConfusionCause;
  waitingSeconds: number;
  backoffSeconds: number;
  stuckSeconds: number;
  recoveryCount: number;
}

export interface P3FlockMetrics {
  centerX: number;
  centerZ: number;
  spread: number;
  splitSeconds: number;
  state: P3FlockState;
}

export interface P3SimulationState {
  elapsedSeconds: number;
  animals: P3AnimalState[];
  pen: P2Pen;
  penReservedAnimalId: string | null;
  flock: P3FlockMetrics;
  capturedCount: number;
  completed: boolean;
}

export const P3_TUNING = {
  animalCount: 6,
  decisionStepSeconds: 1 / 20,
  attentionDistance: P2_TUNING.attentionDistance,
  guidanceDistance: P2_TUNING.guidanceDistance,
  urgentDistance: P2_TUNING.urgentDistance,
  preReactionSeconds: P2_TUNING.preReactionSeconds,
  walkSpeed: P2_TUNING.walkSpeed,
  runningPressureMultiplier: P2_TUNING.runningPressureMultiplier,
  urgentEscapeSpeedMultiplier: P2_TUNING.urgentEscapeSpeedMultiplier,
  pressureReleaseSeconds: P2_TUNING.pressureReleaseSeconds,
  captureHoldSeconds: P2_TUNING.captureHoldSeconds,
  enteringSpeed: P2_TUNING.enteringSpeed,
  enteringTimeoutSeconds: 2,
  waitingTimeoutSeconds: 2,
  backoffSeconds: 0.85,
  minimumAnimalSeparation: 1.15,
  flockStretchDistance: 3.2,
  flockSplitDistance: 4.5,
  flockRecoverDistance: 3.6,
  flockSplitDelaySeconds: 1,
  flockCohesionPerSecond: 0.55,
  confusionMinimumSeconds: 1.5,
  tensionAlertEnter: 45,
  tensionAlertExit: 30,
  tensionConfusionEnter: 85,
  tensionConfusionExit: 55,
  tensionIncrease: {
    none: -12,
    attention: 8,
    guidance: 18,
    urgent: 32,
  },
  tensionSplitIncrease: 8,
  tensionStretchIncrease: 3,
  worldMin: P2_TUNING.animalWorldMin,
  worldMax: P2_TUNING.animalWorldMax,
} as const;

export const DEFAULT_P3_PEN: P2Pen = { ...DEFAULT_P2_PEN };

const INITIAL_ANIMALS: readonly P2PlayerPosition[] = [
  { x: -1.875, z: -2.65 },
  { x: -0.625, z: -2.65 },
  { x: 0.625, z: -2.65 },
  { x: 1.875, z: -2.65 },
  { x: -0.625, z: -3.85 },
  { x: 0.625, z: -3.85 },
];

const EPSILON = 1e-7;
const RAIL_SEPARATION = 1e-4;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function magnitude(x: number, z: number): number {
  return Math.hypot(x, z);
}

function normalized(x: number, z: number): { x: number; z: number } {
  const length = magnitude(x, z);
  if (length < EPSILON) return { x: 0, z: -1 };
  return { x: x / length, z: z / length };
}

function animalBounds(pen: P2Pen): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const radius = Math.max(0, finiteOr(pen.animalRadius, 0));
  return {
    minX: P3_TUNING.worldMin + radius,
    maxX: P3_TUNING.worldMax - radius,
    minZ: P3_TUNING.worldMin + radius,
    maxZ: P3_TUNING.worldMax - radius,
  };
}

function clampAnimalToWorld(animal: { x: number; z: number }, pen: P2Pen): void {
  const bounds = animalBounds(pen);
  animal.x = clamp(animal.x, bounds.minX, bounds.maxX);
  animal.z = clamp(animal.z, bounds.minZ, bounds.maxZ);
}

function interiorBounds(pen: P2Pen): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  return {
    minX: pen.centerX - pen.halfWidth + pen.animalRadius,
    maxX: pen.centerX + pen.halfWidth - pen.animalRadius,
    minZ: pen.centerZ - pen.halfDepth + pen.animalRadius,
    maxZ: pen.centerZ + pen.halfDepth - pen.animalRadius,
  };
}

function entranceClearance(pen: P2Pen): number {
  return Math.max(0, pen.entranceHalfWidth - pen.animalRadius);
}

function outerEntranceFace(pen: P2Pen): number {
  return pen.entranceZ + pen.animalRadius;
}

function innerEntranceFace(pen: P2Pen): number {
  return pen.entranceZ - pen.animalRadius;
}

function isNearEntrance(animal: P3AnimalState, pen: P2Pen): boolean {
  return Math.abs(animal.x - pen.centerX) <= entranceClearance(pen) + 0.12
    && animal.z <= outerEntranceFace(pen) + 0.12
    && animal.z > innerEntranceFace(pen) - 0.12;
}

/** The short staging lane is part of the one-at-a-time entrance queue. */
function isInEntranceQueueZone(animal: P3AnimalState, pen: P2Pen): boolean {
  return Math.abs(animal.x - pen.centerX) <= entranceClearance(pen) + 0.16
    && animal.z > outerEntranceFace(pen) - 0.12
    && animal.z <= outerEntranceFace(pen) + 1.35;
}

function crossedIntoEntranceThroat(
  animal: P3AnimalState,
  pen: P2Pen,
): boolean {
  const front = outerEntranceFace(pen);
  const deltaZ = animal.z - animal.previousZ;
  if (Math.abs(deltaZ) < EPSILON) return false;
  if (animal.previousZ < front - EPSILON || animal.z >= front - EPSILON) {
    return false;
  }
  const progress = (front - animal.previousZ) / deltaZ;
  if (progress < -EPSILON || progress > 1 + EPSILON) return false;
  const crossingX = animal.previousX + (animal.x - animal.previousX) * progress;
  return Math.abs(crossingX - pen.centerX) <= entranceClearance(pen) + EPSILON;
}

function stableOrder(first: P3AnimalState, second: P3AnimalState): number {
  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
}

function createAnimal(id: string, position: P2PlayerPosition): P3AnimalState {
  return {
    id,
    x: position.x,
    z: position.z,
    previousX: position.x,
    previousZ: position.z,
    phase: "idle",
    phaseSeconds: 0,
    captureHoldSeconds: 0,
    fullBodyInside: false,
    escapeX: 0,
    escapeZ: -1,
    lastMoveX: 0,
    lastMoveZ: 0,
    pressureBand: "none",
    fleeTriggerBand: null,
    pressureReleaseSeconds: 0,
    tension: 0,
    tensionState: "calm",
    confusionSeconds: 0,
    confusionCause: "none",
    waitingSeconds: 0,
    backoffSeconds: 0,
    stuckSeconds: 0,
    recoveryCount: 0,
  };
}

function createFlockMetrics(animals: readonly P3AnimalState[]): P3FlockMetrics {
  const active = animals.filter((animal) => animal.phase !== "captured");
  const count = Math.max(1, active.length);
  const centerX = active.reduce((sum, animal) => sum + animal.x, 0) / count;
  const centerZ = active.reduce((sum, animal) => sum + animal.z, 0) / count;
  const spread = active.reduce(
    (maximum, animal) => Math.max(maximum, magnitude(animal.x - centerX, animal.z - centerZ)),
    0,
  );
  return { centerX, centerZ, spread, splitSeconds: 0, state: "cohesive" };
}

export function createP3Simulation(): P3SimulationState {
  const animals = INITIAL_ANIMALS.map((position, index) =>
    createAnimal(`coward-${index + 1}`, position));
  return {
    elapsedSeconds: 0,
    animals,
    pen: { ...DEFAULT_P3_PEN },
    penReservedAnimalId: null,
    flock: createFlockMetrics(animals),
    capturedCount: 0,
    completed: false,
  };
}

function updateFlockMetrics(state: P3SimulationState, deltaSeconds: number): void {
  const active = state.animals.filter((animal) => animal.phase !== "captured");
  const count = Math.max(1, active.length);
  const centerX = active.reduce((sum, animal) => sum + animal.x, 0) / count;
  const centerZ = active.reduce((sum, animal) => sum + animal.z, 0) / count;
  const spread = active.reduce(
    (maximum, animal) => Math.max(maximum, magnitude(animal.x - centerX, animal.z - centerZ)),
    0,
  );
  state.flock.centerX = centerX;
  state.flock.centerZ = centerZ;
  state.flock.spread = spread;
  if (spread >= P3_TUNING.flockSplitDistance) {
    state.flock.splitSeconds += deltaSeconds;
  } else if (spread <= P3_TUNING.flockRecoverDistance) {
    state.flock.splitSeconds = Math.max(0, state.flock.splitSeconds - deltaSeconds * 2);
  }
  state.flock.state = state.flock.splitSeconds >= P3_TUNING.flockSplitDelaySeconds
    ? "split"
    : spread >= P3_TUNING.flockStretchDistance
      ? "stretched"
      : "cohesive";
}

function updateTension(
  animal: P3AnimalState,
  band: PressureBand,
  flockState: P3FlockState,
  deltaSeconds: number,
): void {
  const baseChange = P3_TUNING.tensionIncrease[band];
  const flockChange = flockState === "split"
    ? P3_TUNING.tensionSplitIncrease
    : flockState === "stretched"
      ? P3_TUNING.tensionStretchIncrease
      : 0;
  animal.tension = clamp(
    animal.tension + (baseChange + flockChange) * deltaSeconds,
    0,
    100,
  );

  if (animal.tensionState === "confused") {
    animal.confusionSeconds += deltaSeconds;
    if (animal.confusionSeconds >= P3_TUNING.confusionMinimumSeconds
      && animal.tension <= P3_TUNING.tensionConfusionExit) {
      animal.tensionState = "alert";
      animal.confusionCause = "none";
    }
    return;
  }
  if (animal.tensionState === "calm"
    && animal.tension >= P3_TUNING.tensionAlertEnter) {
    animal.tensionState = "alert";
  } else if (animal.tensionState === "alert"
    && animal.tension >= P3_TUNING.tensionConfusionEnter) {
    animal.tensionState = "confused";
    animal.confusionSeconds = 0;
    animal.confusionCause = flockState === "split" ? "flockSplit" : "pressure";
  } else if (animal.tensionState === "alert"
    && animal.tension <= P3_TUNING.tensionAlertExit) {
    animal.tensionState = "calm";
  }
}

function beginAnticipation(animal: P3AnimalState, player: P2PlayerPosition): void {
  const escape = normalized(animal.x - player.x, animal.z - player.z);
  animal.escapeX = escape.x;
  animal.escapeZ = escape.z;
  animal.phase = "anticipating";
  animal.phaseSeconds = 0;
  animal.captureHoldSeconds = 0;
  animal.pressureReleaseSeconds = 0;
  animal.fleeTriggerBand = null;
  animal.lastMoveX = 0;
  animal.lastMoveZ = 0;
}

function moveAnimal(
  animal: P3AnimalState,
  directionX: number,
  directionZ: number,
  speed: number,
  deltaSeconds: number,
): void {
  const direction = normalized(directionX, directionZ);
  animal.lastMoveX = direction.x;
  animal.lastMoveZ = direction.z;
  animal.x += direction.x * speed * deltaSeconds;
  animal.z += direction.z * speed * deltaSeconds;
}

function enforcePenRails(
  animal: P3AnimalState,
  pen: P2Pen,
  entranceOpen: boolean,
): void {
  const constrained = constrainCircleAgainstPenRails(
    { x: animal.previousX, z: animal.previousZ },
    { x: animal.x, z: animal.z },
    pen,
    pen.animalRadius,
    entranceOpen,
  );
  animal.x = constrained.x;
  animal.z = constrained.z;
}

function recoverOutsideEntrance(
  animal: P3AnimalState,
  pen: P2Pen,
  phase: "waitingForEntrance" | "fleeing" | "backingOff" = "waitingForEntrance",
): void {
  const clearance = entranceClearance(pen);
  animal.x = clamp(animal.x, pen.centerX - clearance, pen.centerX + clearance);
  if (animal.z <= outerEntranceFace(pen) + RAIL_SEPARATION) {
    animal.z = outerEntranceFace(pen) + RAIL_SEPARATION;
  }
  animal.phase = phase;
  animal.phaseSeconds = 0;
  animal.captureHoldSeconds = 0;
  animal.fullBodyInside = false;
  animal.lastMoveX = 0;
  animal.lastMoveZ = 0;
}

function desiredFleeDirection(
  state: P3SimulationState,
  animal: P3AnimalState,
  player: P2PlayerPosition,
): { x: number; z: number } {
  const away = normalized(animal.x - player.x, animal.z - player.z);
  const cohesion = normalized(state.flock.centerX - animal.x, state.flock.centerZ - animal.z);
  const towardPen = normalized(state.pen.centerX - animal.x, state.pen.entranceZ - animal.z);
  let x = away.x * 0.72 + cohesion.x * 0.25 + towardPen.x * 0.08;
  let z = away.z * 0.72 + cohesion.z * 0.25 + towardPen.z * 0.08;
  if (animal.tensionState === "confused") {
    const wobble = Math.sin(state.elapsedSeconds * 3.2 + Number(animal.id.at(-1) ?? 1));
    x += -away.z * wobble * 0.22;
    z += away.x * wobble * 0.22;
  }
  return normalized(x, z);
}

function updateEntering(
  animal: P3AnimalState,
  pen: P2Pen,
  deltaSeconds: number,
): void {
  const bounds = interiorBounds(pen);
  const targetX = clamp(animal.x, bounds.minX + 0.18, bounds.maxX - 0.18);
  const targetZ = clamp(pen.centerZ, bounds.minZ + 0.18, bounds.maxZ - 0.18);
  const deltaX = targetX - animal.x;
  const deltaZ = targetZ - animal.z;
  if (magnitude(deltaX, deltaZ) > 0.05) {
    moveAnimal(animal, deltaX, deltaZ, P3_TUNING.enteringSpeed, deltaSeconds);
  } else {
    animal.lastMoveX = 0;
    animal.lastMoveZ = -1;
  }
  animal.fullBodyInside = isFullBodyInsidePen(animal, pen);
  if (animal.fullBodyInside) animal.captureHoldSeconds += deltaSeconds;
  else animal.captureHoldSeconds = 0;
}

function updateWaiting(
  animal: P3AnimalState,
  pen: P2Pen,
  deltaSeconds: number,
): void {
  animal.waitingSeconds += deltaSeconds;
  animal.phaseSeconds += deltaSeconds;
  recoverOutsideEntrance(animal, pen, "waitingForEntrance");
  if (animal.waitingSeconds >= P3_TUNING.waitingTimeoutSeconds) {
    animal.phase = "backingOff";
    animal.backoffSeconds = 0;
    animal.confusionCause = "entrance";
    animal.tension = Math.max(animal.tension, P3_TUNING.tensionAlertEnter);
    animal.recoveryCount += 1;
  }
}

function updateBackingOff(
  animal: P3AnimalState,
  pen: P2Pen,
  deltaSeconds: number,
): void {
  animal.backoffSeconds += deltaSeconds;
  animal.phaseSeconds += deltaSeconds;
  const away = normalized(animal.x - pen.centerX, animal.z - pen.entranceZ);
  moveAnimal(animal, away.x, away.z, P3_TUNING.walkSpeed, deltaSeconds);
  enforcePenRails(animal, pen, false);
  clampAnimalToWorld(animal, pen);
  if (animal.backoffSeconds >= P3_TUNING.backoffSeconds) {
    animal.phase = "fleeing";
    animal.phaseSeconds = 0;
    animal.waitingSeconds = 0;
    animal.backoffSeconds = 0;
    animal.pressureReleaseSeconds = 0;
    animal.fleeTriggerBand = "guidance";
  }
}

interface AnimalUpdateResult {
  crossedEntrance: boolean;
  newlyCaptured: boolean;
}

function updateAnimal(
  state: P3SimulationState,
  animal: P3AnimalState,
  player: P2PlayerPosition,
  deltaSeconds: number,
): AnimalUpdateResult {
  if (animal.phase === "captured") return { crossedEntrance: false, newlyCaptured: false };
  animal.x = finiteOr(animal.x, state.flock.centerX);
  animal.z = finiteOr(animal.z, state.flock.centerZ);
  clampAnimalToWorld(animal, state.pen);

  const blocked = isPressureBlockedByPen(player, animal, state.pen);
  const pressureBand = blocked ? "none" : getPressureBand(player, animal);
  animal.pressureBand = pressureBand;
  updateTension(animal, pressureBand, state.flock.state, deltaSeconds);

  if (animal.phase === "waitingForEntrance") {
    updateWaiting(animal, state.pen, deltaSeconds);
    return { crossedEntrance: false, newlyCaptured: false };
  }
  if (animal.phase === "backingOff") {
    updateBackingOff(animal, state.pen, deltaSeconds);
    return { crossedEntrance: false, newlyCaptured: false };
  }
  if (animal.phase === "anticipating") {
    const seeingPlayer = pressureBand !== "none";
    if (!seeingPlayer) {
      animal.phase = "idle";
      animal.phaseSeconds = 0;
      animal.escapeX = 0;
      animal.escapeZ = -1;
      return { crossedEntrance: false, newlyCaptured: false };
    }
    animal.phaseSeconds = Math.min(
      P3_TUNING.preReactionSeconds,
      animal.phaseSeconds + deltaSeconds,
    );
    const escape = normalized(animal.x - player.x, animal.z - player.z);
    animal.escapeX = escape.x;
    animal.escapeZ = escape.z;
    if ((pressureBand === "guidance" || pressureBand === "urgent")
      && animal.phaseSeconds >= P3_TUNING.preReactionSeconds) {
      animal.phase = "fleeing";
      animal.phaseSeconds = 0;
      animal.fleeTriggerBand = pressureBand === "urgent" ? "urgent" : "guidance";
    }
    return { crossedEntrance: false, newlyCaptured: false };
  }
  if (animal.phase === "enteringPen") {
    animal.phaseSeconds += deltaSeconds;
    updateEntering(animal, state.pen, deltaSeconds);
    if (animal.fullBodyInside
      && animal.captureHoldSeconds + EPSILON >= P3_TUNING.captureHoldSeconds) {
      animal.phase = "captured";
      animal.tensionState = "calm";
      animal.confusionCause = "none";
      return { crossedEntrance: false, newlyCaptured: true };
    }
    if (animal.phaseSeconds >= P3_TUNING.enteringTimeoutSeconds
      && !animal.fullBodyInside) {
      recoverOutsideEntrance(animal, state.pen, "backingOff");
      animal.backoffSeconds = 0;
      animal.recoveryCount += 1;
    }
    return { crossedEntrance: false, newlyCaptured: false };
  }

  if (animal.phase === "idle") {
    if (pressureBand !== "none") beginAnticipation(animal, player);
    return { crossedEntrance: false, newlyCaptured: false };
  }

  // Fleeing is the only phase allowed to create a new entrance candidate.
  animal.phaseSeconds += deltaSeconds;
  animal.fleeTriggerBand ??= pressureBand === "urgent" ? "urgent" : "guidance";
  if (pressureBand === "urgent") animal.fleeTriggerBand = "urgent";
  const activePressure = pressureBand === "guidance" || pressureBand === "urgent";
  if (activePressure) animal.pressureReleaseSeconds = 0;
  else if (animal.fleeTriggerBand === "urgent") animal.pressureReleaseSeconds += deltaSeconds;
  const released = animal.fleeTriggerBand === "guidance"
    ? pressureBand === "none"
    : !activePressure
      && animal.pressureReleaseSeconds >= P3_TUNING.pressureReleaseSeconds;
  if (released && !isNearEntrance(animal, state.pen)) {
    animal.phase = "idle";
    animal.phaseSeconds = 0;
    animal.fleeTriggerBand = null;
    animal.lastMoveX = 0;
    animal.lastMoveZ = 0;
    return { crossedEntrance: false, newlyCaptured: false };
  }

  const direction = desiredFleeDirection(state, animal, player);
  const speedMultiplier = pressureBand === "urgent"
    ? P3_TUNING.urgentEscapeSpeedMultiplier
    : 1;
  const beforeX = animal.x;
  const beforeZ = animal.z;
  const entranceOpen = state.penReservedAnimalId === null
    || state.penReservedAnimalId === animal.id;
  moveAnimal(
    animal,
    direction.x,
    direction.z,
    P3_TUNING.walkSpeed * speedMultiplier,
    deltaSeconds,
  );
  enforcePenRails(animal, state.pen, entranceOpen);
  clampAnimalToWorld(animal, state.pen);
  animal.fullBodyInside = isFullBodyInsidePen(animal, state.pen);
  const movedDistance = magnitude(animal.x - beforeX, animal.z - beforeZ);
  animal.stuckSeconds = movedDistance < 0.002 ? animal.stuckSeconds + deltaSeconds : 0;

  const crossedEntrance = crossedIntoEntranceThroat(animal, state.pen);
  if (state.penReservedAnimalId !== null
    && state.penReservedAnimalId !== animal.id
    && isInEntranceQueueZone(animal, state.pen)) {
    recoverOutsideEntrance(animal, state.pen, "waitingForEntrance");
  }
  if (animal.stuckSeconds >= P3_TUNING.waitingTimeoutSeconds
    && !isNearEntrance(animal, state.pen)) {
    animal.phase = "backingOff";
    animal.backoffSeconds = 0;
    animal.confusionCause = "flockSplit";
    animal.recoveryCount += 1;
  }
  return { crossedEntrance, newlyCaptured: false };
}

function shouldReleaseOwner(owner: P3AnimalState, pen: P2Pen): boolean {
  if (owner.phase === "captured" || owner.phase === "idle") return true;
  if (owner.phase === "backingOff") return true;
  return owner.phase === "fleeing"
    && owner.z > outerEntranceFace(pen) + 0.2;
}

function reconcileEntrance(
  state: P3SimulationState,
  candidateIds: readonly string[],
): void {
  const animals = [...state.animals].sort(stableOrder);
  let owner = state.penReservedAnimalId === null
    ? null
    : animals.find((animal) => animal.id === state.penReservedAnimalId) ?? null;
  if (owner && shouldReleaseOwner(owner, state.pen)) owner = null;

  if (!owner) {
    const candidates = new Set(candidateIds);
    owner = animals.find((animal) =>
      candidates.has(animal.id) && animal.phase === "fleeing") ?? null;
    if (!owner) {
      owner = animals.find((animal) =>
        animal.phase === "waitingForEntrance" && isInEntranceQueueZone(animal, state.pen)) ?? null;
      if (owner) {
        owner.phase = "fleeing";
        owner.phaseSeconds = 0;
        owner.waitingSeconds = 0;
        owner.fleeTriggerBand = "guidance";
      }
    }
  }
  state.penReservedAnimalId = owner?.id ?? null;

  for (const animal of animals) {
    if (animal.phase === "captured" || animal.id === state.penReservedAnimalId) continue;
    if (animal.phase === "enteringPen") {
      recoverOutsideEntrance(animal, state.pen, "waitingForEntrance");
    } else if (animal.phase === "fleeing"
      && (isInEntranceQueueZone(animal, state.pen)
        || isFullBodyInsidePen(animal, state.pen))) {
      recoverOutsideEntrance(animal, state.pen, "waitingForEntrance");
    }
  }

  owner = state.penReservedAnimalId === null
    ? null
    : animals.find((animal) => animal.id === state.penReservedAnimalId) ?? null;
  if (owner?.phase === "fleeing" && owner.fullBodyInside) {
    owner.phase = "enteringPen";
    owner.phaseSeconds = 0;
    owner.captureHoldSeconds = 0;
    owner.waitingSeconds = 0;
    owner.fleeTriggerBand = null;
  }
  // The reservation is granted at the body-aware throat crossing, before the
  // full body reaches the interior. Starting the entering phase here prevents
  // a second animal from claiming the same throat on the next 20 Hz tick.
  if (owner?.phase === "fleeing"
    && candidateIds.includes(owner.id)
    && isNearEntrance(owner, state.pen)) {
    owner.phase = "enteringPen";
    owner.phaseSeconds = 0;
    owner.captureHoldSeconds = 0;
    owner.waitingSeconds = 0;
    owner.fleeTriggerBand = null;
  }
}

function applyFlockCohesion(state: P3SimulationState, deltaSeconds: number): void {
  const active = state.animals.filter((animal) =>
    animal.phase === "fleeing",
  );
  for (const animal of active) {
    const dx = state.flock.centerX - animal.x;
    const dz = state.flock.centerZ - animal.z;
    const distance = magnitude(dx, dz);
    if (distance < 0.2) continue;
    const pull = Math.min(distance * 0.18, P3_TUNING.flockCohesionPerSecond * deltaSeconds);
    animal.x += dx / distance * pull;
    animal.z += dz / distance * pull;
  }
}

function applyAnimalSpacing(state: P3SimulationState): void {
  const participatesInSpacing = (animal: P3AnimalState): boolean =>
    animal.phase !== "captured"
      && animal.phase !== "idle"
      && animal.phase !== "anticipating";

  for (let pass = 0; pass < 10; pass += 1) {
    let adjusted = false;
    for (let firstIndex = 0; firstIndex < state.animals.length; firstIndex += 1) {
      const first = state.animals[firstIndex];
      if (!first || !participatesInSpacing(first)) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < state.animals.length; secondIndex += 1) {
        const second = state.animals[secondIndex];
        if (!second || !participatesInSpacing(second)) continue;
        const dx = second.x - first.x;
        const dz = second.z - first.z;
        const distance = magnitude(dx, dz);
        if (distance >= P3_TUNING.minimumAnimalSeparation - 1e-4) continue;
        const direction = normalized(dx, dz);
        const correction = P3_TUNING.minimumAnimalSeparation - distance;
        if (first.phase === "enteringPen") {
          second.x += direction.x * correction;
          second.z += direction.z * correction;
        } else if (second.phase === "enteringPen") {
          first.x -= direction.x * correction;
          first.z -= direction.z * correction;
        } else {
          const push = correction / 2;
          first.x -= direction.x * push;
          first.z -= direction.z * push;
          second.x += direction.x * push;
          second.z += direction.z * push;
        }
        clampAnimalToWorld(first, state.pen);
        clampAnimalToWorld(second, state.pen);
        adjusted = true;
      }
    }
    if (!adjusted) break;
  }
}

function placeCapturedAnimal(state: P3SimulationState, animal: P3AnimalState): void {
  const index = Math.max(0, state.animals.indexOf(animal));
  const centerIndex = (state.animals.length - 1) / 2;
  const bounds = interiorBounds(state.pen);
  animal.x = clamp(
    state.pen.centerX + (index - centerIndex) * P3_TUNING.minimumAnimalSeparation * 1.05,
    bounds.minX,
    bounds.maxX,
  );
  animal.z = clamp(state.pen.centerZ, bounds.minZ, bounds.maxZ);
  animal.fullBodyInside = true;
  animal.lastMoveX = 0;
  animal.lastMoveZ = 0;
}

export interface P3StepResult {
  newlyCapturedIds: string[];
  capturedCount: number;
  completed: boolean;
  flockState: P3FlockState;
  recoveredAnimalIds: string[];
}

export function stepP3Simulation(
  state: P3SimulationState,
  player: P2PlayerPosition,
  deltaSeconds: number,
): P3StepResult {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return {
      newlyCapturedIds: [],
      capturedCount: state.capturedCount,
      completed: state.completed,
      flockState: state.flock.state,
      recoveredAnimalIds: [],
    };
  }
  const safeDelta = Math.min(deltaSeconds, 0.25);
  const safePlayer = {
    x: finiteOr(player.x, 0),
    z: finiteOr(player.z, 0),
    speed: finiteOr(player.speed ?? 0, 0),
    isRunning: player.isRunning,
  };
  state.elapsedSeconds += safeDelta;
  updateFlockMetrics(state, safeDelta);
  for (const animal of state.animals) {
    if (animal.phase !== "captured") {
      animal.previousX = animal.x;
      animal.previousZ = animal.z;
    }
  }

  const newlyCapturedIds: string[] = [];
  const recoveredBefore = new Map(
    state.animals.map((animal) => [animal.id, animal.recoveryCount]),
  );
  const candidateIds: string[] = [];
  for (const animal of state.animals) {
    const result = updateAnimal(state, animal, safePlayer, safeDelta);
    if (result.crossedEntrance) candidateIds.push(animal.id);
    if (result.newlyCaptured) {
      placeCapturedAnimal(state, animal);
      newlyCapturedIds.push(animal.id);
    }
  }

  reconcileEntrance(state, candidateIds);
  updateFlockMetrics(state, 0);
  applyFlockCohesion(state, safeDelta);
  applyAnimalSpacing(state);
  for (const animal of state.animals) {
    if (animal.phase === "captured" || animal.phase === "enteringPen") continue;
    const entranceOpen = state.penReservedAnimalId === null
      || state.penReservedAnimalId === animal.id;
    enforcePenRails(animal, state.pen, entranceOpen);
    clampAnimalToWorld(animal, state.pen);
    animal.fullBodyInside = isFullBodyInsidePen(animal, state.pen);
  }
  reconcileEntrance(state, []);
  updateFlockMetrics(state, 0);

  state.capturedCount = state.animals.filter((animal) => animal.phase === "captured").length;
  state.completed = state.capturedCount === state.animals.length;
  return {
    newlyCapturedIds,
    capturedCount: state.capturedCount,
    completed: state.completed,
    flockState: state.flock.state,
    recoveredAnimalIds: state.animals
      .filter((animal) => animal.recoveryCount > (recoveredBefore.get(animal.id) ?? 0))
      .map((animal) => animal.id),
  };
}
