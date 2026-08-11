/**
 * Deterministic P4 "危険検証版" rules.
 *
 * P4 is intentionally separate from the P3 flock simulation. It proves the
 * danger loop in isolation: find a protected target, warn before an attack,
 * rescue the target after the first hit, and lead the predator into its own
 * pen. Rendering and browser input are kept outside this module.
 */

import {
  constrainCircleAgainstPenRails,
  DEFAULT_P2_PEN,
  isFullBodyInsidePen,
  isPressureBlockedByPen,
  type P2Pen,
  type P2PlayerPosition,
} from "./p2-cowardly-simulation";

export type P4AttackPhase =
  | "search"
  | "chase"
  | "aim"
  | "lunge"
  | "recovery"
  | "disabled";

export type P4PredatorIntent = "hunt" | "chasePlayer" | "none";
export type P4LifeState = "active" | "rescuePending" | "captured" | "failureLocked";
export type P4RunStatus = "active" | "completed" | "failed";
export type P4FailureReason = "none" | "rescueTimeout" | "repeatedAttack";
export type P4EventType =
  | "predatorTargeted"
  | "predatorAimStarted"
  | "predatorLungeStarted"
  | "victimRescuePending"
  | "rescueSucceeded"
  | "rescueFailed"
  | "predatorEnteredPen"
  | "predatorCaptured"
  | "threatAccepted"
  | "threatRejected";

export interface P4Event {
  id: number;
  type: P4EventType;
  atSeconds: number;
  subjectId: string;
  reason: string;
}

export interface P4VictimState {
  id: string;
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  lifeState: P4LifeState;
  rescueSeconds: number;
  protectionSeconds: number;
  rescueCount: number;
  stress: number;
}

export interface P4PredatorState {
  id: string;
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  attackPhase: P4AttackPhase;
  intent: P4PredatorIntent;
  targetId: string | null;
  phaseSeconds: number;
  aimSeconds: number;
  lungeSeconds: number;
  recoverySeconds: number;
  lungeTargetX: number;
  lungeTargetZ: number;
  threatSeconds: number;
  threatCooldownSeconds: number;
  threatResistanceSeconds: number;
  insidePen: boolean;
  captureHoldSeconds: number;
  lastMoveX: number;
  lastMoveZ: number;
  playerDazedSeconds: number;
}

export interface P4SimulationState {
  elapsedSeconds: number;
  status: P4RunStatus;
  failureReason: P4FailureReason;
  predator: P4PredatorState;
  victim: P4VictimState;
  pen: P2Pen;
  rescueOverrideUsed: boolean;
  eventSequence: number;
  events: P4Event[];
}

export interface P4StepInput extends P2PlayerPosition {
  /** One-shot signal consumed by the next fixed decision update. */
  threatSignal?: boolean;
}

export interface P4StepResult {
  status: P4RunStatus;
  failureReason: P4FailureReason;
  attackStarted: boolean;
  threatAccepted: boolean;
  rescued: boolean;
  rescuePending: boolean;
  captured: boolean;
}

const P4_WORLD_MIN = -16.5;
const P4_WORLD_MAX = 16.5;

export const P4_TUNING = {
  decisionStepSeconds: 1 / 20,
  detectionDistance: 8,
  attackDistance: 1.25,
  playerContactDistance: 0.78,
  rescueDistance: 2.25,
  threatDistance: 7,
  aimSeconds: 1.2,
  lungeSeconds: 0.45,
  recoverySeconds: 1,
  threatDurationSeconds: 4,
  threatCooldownSeconds: 3,
  threatResistanceSeconds: 1.75,
  rescueDeadlineSeconds: 3,
  rescueProtectionSeconds: 1,
  captureHoldSeconds: 0.6,
  predatorRadius: 0.55,
  victimRadius: 0.52,
  predatorSpeed: 1.25,
  playerChaseSpeed: 1.8,
  lungeSpeed: 2.8,
  worldMin: P4_WORLD_MIN,
  worldMax: P4_WORLD_MAX,
  pen: {
    ...DEFAULT_P2_PEN,
    centerZ: -10.5,
    halfWidth: 4.6,
    halfDepth: 2.6,
    entranceZ: -7.9,
    entranceHalfWidth: 1.35,
    animalRadius: 0.55,
  } satisfies P2Pen,
} as const;

const EPSILON = 1e-7;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distance(firstX: number, firstZ: number, secondX: number, secondZ: number): number {
  return Math.hypot(secondX - firstX, secondZ - firstZ);
}

function normalized(x: number, z: number): { x: number; z: number } {
  const length = Math.hypot(x, z);
  if (length < EPSILON) return { x: 0, z: -1 };
  return { x: x / length, z: z / length };
}

function clampWorld(position: { x: number; z: number }, radius: number): void {
  position.x = clamp(position.x, P4_WORLD_MIN + radius, P4_WORLD_MAX - radius);
  position.z = clamp(position.z, P4_WORLD_MIN + radius, P4_WORLD_MAX - radius);
}

function playerInsidePen(player: P2PlayerPosition, pen: P2Pen): boolean {
  return isFullBodyInsidePen(player, pen);
}

function canSeeVictim(state: P4SimulationState): boolean {
  const predator = state.predator;
  const victim = state.victim;
  if (victim.lifeState !== "active" || victim.protectionSeconds > EPSILON) return false;
  if (distance(predator.x, predator.z, victim.x, victim.z) > P4_TUNING.detectionDistance) {
    return false;
  }
  return !isPressureBlockedByPen(
    { x: predator.x, z: predator.z },
    { x: victim.x, z: victim.z },
    state.pen,
  );
}

function canAttackVictim(state: P4SimulationState): boolean {
  if (!canSeeVictim(state)) return false;
  return distance(
    state.predator.x,
    state.predator.z,
    state.victim.x,
    state.victim.z,
  ) <= P4_TUNING.attackDistance;
}

function canSeePlayer(
  state: P4SimulationState,
  player: P2PlayerPosition,
): boolean {
  return !isPressureBlockedByPen(
    { x: state.predator.x, z: state.predator.z },
    { x: player.x, z: player.z },
    state.pen,
  );
}

function recordEvent(
  state: P4SimulationState,
  type: P4EventType,
  subjectId: string,
  reason: string,
): void {
  state.eventSequence += 1;
  state.events.push({
    id: state.eventSequence,
    type,
    atSeconds: state.elapsedSeconds,
    subjectId,
    reason,
  });
}

function createPredator(): P4PredatorState {
  return {
    id: "predator-1",
    x: 0,
    z: -2.15,
    previousX: 0,
    previousZ: -2.15,
    attackPhase: "search",
    intent: "hunt",
    targetId: null,
    phaseSeconds: 0,
    aimSeconds: 0,
    lungeSeconds: 0,
    recoverySeconds: 0,
    lungeTargetX: 0,
    lungeTargetZ: 0,
    threatSeconds: 0,
    threatCooldownSeconds: 0,
    threatResistanceSeconds: 0,
    insidePen: false,
    captureHoldSeconds: 0,
    lastMoveX: 0,
    lastMoveZ: -1,
    playerDazedSeconds: 0,
  };
}

function createVictim(): P4VictimState {
  return {
    id: "victim-1",
    x: 0,
    z: -0.15,
    previousX: 0,
    previousZ: -0.15,
    lifeState: "active",
    rescueSeconds: 0,
    protectionSeconds: 0,
    rescueCount: 0,
    stress: 0,
  };
}

export function createP4Simulation(): P4SimulationState {
  return {
    elapsedSeconds: 0,
    status: "active",
    failureReason: "none",
    predator: createPredator(),
    victim: createVictim(),
    pen: { ...P4_TUNING.pen },
    rescueOverrideUsed: false,
    eventSequence: 0,
    events: [],
  };
}

function movePredator(
  state: P4SimulationState,
  directionX: number,
  directionZ: number,
  speed: number,
  deltaSeconds: number,
): void {
  const predator = state.predator;
  const direction = normalized(directionX, directionZ);
  predator.lastMoveX = direction.x;
  predator.lastMoveZ = direction.z;
  predator.previousX = predator.x;
  predator.previousZ = predator.z;
  predator.x += direction.x * speed * deltaSeconds;
  predator.z += direction.z * speed * deltaSeconds;

  if (predator.insidePen) {
    const inner = isFullBodyInsidePen(predator, state.pen)
      ? { x: predator.x, z: predator.z }
      : {
          x: clamp(predator.x, state.pen.centerX - state.pen.halfWidth + state.pen.animalRadius, state.pen.centerX + state.pen.halfWidth - state.pen.animalRadius),
          z: clamp(predator.z, state.pen.centerZ - state.pen.halfDepth + state.pen.animalRadius, state.pen.centerZ + state.pen.halfDepth - state.pen.animalRadius),
        };
    predator.x = inner.x;
    predator.z = inner.z;
    return;
  }

  const constrained = constrainCircleAgainstPenRails(
    { x: predator.previousX, z: predator.previousZ },
    { x: predator.x, z: predator.z },
    state.pen,
    P4_TUNING.predatorRadius,
    true,
  );
  predator.x = constrained.x;
  predator.z = constrained.z;
  clampWorld(predator, P4_TUNING.predatorRadius);
}

function setSearch(state: P4SimulationState): void {
  state.predator.attackPhase = "search";
  state.predator.intent = "hunt";
  state.predator.targetId = null;
  state.predator.phaseSeconds = 0;
  state.predator.aimSeconds = 0;
  state.predator.lungeSeconds = 0;
  state.predator.lungeTargetX = state.predator.x;
  state.predator.lungeTargetZ = state.predator.z;
}

function setChasePlayer(state: P4SimulationState): void {
  state.predator.attackPhase = "chase";
  state.predator.intent = "chasePlayer";
  state.predator.targetId = null;
  state.predator.phaseSeconds = 0;
  state.predator.aimSeconds = 0;
  state.predator.lungeSeconds = 0;
}

function setRecovery(state: P4SimulationState): void {
  state.predator.attackPhase = "recovery";
  state.predator.phaseSeconds = 0;
  state.predator.recoverySeconds = 0;
  state.predator.aimSeconds = 0;
  state.predator.lungeSeconds = 0;
}

function failRun(
  state: P4SimulationState,
  reason: Exclude<P4FailureReason, "none">,
): void {
  if (state.status !== "active") return;
  state.status = "failed";
  state.failureReason = reason;
  state.victim.lifeState = "failureLocked";
  state.predator.attackPhase = "disabled";
  state.predator.intent = "none";
  state.predator.targetId = null;
  recordEvent(state, "rescueFailed", state.victim.id, reason);
}

function enterRescuePending(state: P4SimulationState): void {
  const victim = state.victim;
  if (victim.lifeState !== "active") return;
  if (victim.rescueCount > 0) {
    failRun(state, "repeatedAttack");
    return;
  }
  victim.lifeState = "rescuePending";
  victim.rescueSeconds = 0;
  victim.protectionSeconds = 0;
  victim.stress = 100;
  recordEvent(state, "victimRescuePending", victim.id, "first-valid-lunge-contact");
  setRecovery(state);
}

function rescueVictim(state: P4SimulationState, reason: string): boolean {
  const victim = state.victim;
  if (state.status !== "active" || victim.lifeState !== "rescuePending") return false;
  victim.lifeState = "active";
  victim.rescueSeconds = 0;
  victim.protectionSeconds = P4_TUNING.rescueProtectionSeconds;
  victim.rescueCount += 1;
  victim.stress = 55;
  state.rescueOverrideUsed = reason === "threat-signal";
  recordEvent(state, "rescueSucceeded", victim.id, reason);
  state.predator.threatSeconds = P4_TUNING.threatDurationSeconds;
  setChasePlayer(state);
  return true;
}

function applyThreatSignal(
  state: P4SimulationState,
  player: P4StepInput,
): { accepted: boolean; rescued: boolean } {
  if (!player.threatSignal || state.status !== "active") {
    return { accepted: false, rescued: false };
  }
  const predator = state.predator;
  if (predator.attackPhase === "disabled" || predator.attackPhase === "lunge") {
    recordEvent(state, "threatRejected", predator.id, "lunge-or-disabled");
    return { accepted: false, rescued: false };
  }
  const inRange = distance(predator.x, predator.z, player.x, player.z)
    <= P4_TUNING.threatDistance;
  const rescueOverride = state.victim.lifeState === "rescuePending"
    && !state.rescueOverrideUsed;
  if (!inRange || !canSeePlayer(state, player)
    || (predator.threatResistanceSeconds > EPSILON && !rescueOverride)
    || predator.threatCooldownSeconds > EPSILON) {
    recordEvent(state, "threatRejected", predator.id, "range-visibility-or-resistance");
    return { accepted: false, rescued: false };
  }
  predator.threatCooldownSeconds = P4_TUNING.threatCooldownSeconds;
  predator.threatSeconds = P4_TUNING.threatDurationSeconds;
  recordEvent(state, "threatAccepted", predator.id, rescueOverride ? "rescue-override" : "normal-threat");
  const rescued = rescueVictim(state, "threat-signal");
  if (predator.attackPhase === "aim" || predator.attackPhase === "chase" || predator.attackPhase === "search") {
    setChasePlayer(state);
  }
  return { accepted: true, rescued };
}

function applyProximityRescue(
  state: P4SimulationState,
  player: P4StepInput,
): boolean {
  if (state.victim.lifeState !== "rescuePending") return false;
  if (distance(state.predator.x, state.predator.z, player.x, player.z)
    > P4_TUNING.rescueDistance) return false;
  if (!canSeePlayer(state, player)) return false;
  return rescueVictim(state, "player-proximity");
}

function updateVictimTimers(
  state: P4SimulationState,
  deltaSeconds: number,
): void {
  const victim = state.victim;
  victim.protectionSeconds = Math.max(0, victim.protectionSeconds - deltaSeconds);
  if (victim.lifeState !== "rescuePending") return;
  victim.rescueSeconds += deltaSeconds;
  if (victim.rescueSeconds >= P4_TUNING.rescueDeadlineSeconds) {
    failRun(state, "rescueTimeout");
  }
}

function beginAim(state: P4SimulationState): void {
  const predator = state.predator;
  predator.attackPhase = "aim";
  predator.intent = "hunt";
  predator.targetId = state.victim.id;
  predator.phaseSeconds = 0;
  predator.aimSeconds = 0;
  predator.lungeSeconds = 0;
  recordEvent(state, "predatorAimStarted", predator.id, "target-in-attack-distance");
}

function beginLunge(state: P4SimulationState): void {
  const predator = state.predator;
  predator.attackPhase = "lunge";
  predator.intent = "hunt";
  predator.phaseSeconds = 0;
  predator.lungeSeconds = 0;
  predator.lungeTargetX = state.victim.x;
  predator.lungeTargetZ = state.victim.z;
  recordEvent(state, "predatorLungeStarted", predator.id, "aim-complete-and-revalidated");
}

function updateLunge(
  state: P4SimulationState,
  deltaSeconds: number,
): boolean {
  const predator = state.predator;
  predator.phaseSeconds += deltaSeconds;
  predator.lungeSeconds += deltaSeconds;
  const direction = normalized(
    predator.lungeTargetX - predator.x,
    predator.lungeTargetZ - predator.z,
  );
  movePredator(
    state,
    direction.x,
    direction.z,
    P4_TUNING.lungeSpeed,
    deltaSeconds,
  );
  const touchedVictim = state.victim.lifeState === "active"
    && distance(predator.x, predator.z, state.victim.x, state.victim.z)
      <= P4_TUNING.playerContactDistance;
  if (touchedVictim) enterRescuePending(state);
  if (state.status === "active"
    && predator.lungeSeconds >= P4_TUNING.lungeSeconds) {
    setRecovery(state);
  }
  return touchedVictim;
}

function updateAim(
  state: P4SimulationState,
  deltaSeconds: number,
): void {
  const predator = state.predator;
  predator.phaseSeconds += deltaSeconds;
  predator.aimSeconds += deltaSeconds;
  if (!canAttackVictim(state)) {
    setSearch(state);
    return;
  }
  if (predator.aimSeconds >= P4_TUNING.aimSeconds) beginLunge(state);
}

function updateChasePlayer(
  state: P4SimulationState,
  player: P4StepInput,
  deltaSeconds: number,
): void {
  const predator = state.predator;
  predator.phaseSeconds += deltaSeconds;
  if (distance(predator.x, predator.z, player.x, player.z)
    <= P4_TUNING.playerContactDistance) {
    predator.threatSeconds = 0;
    predator.threatResistanceSeconds = P4_TUNING.threatResistanceSeconds;
    predator.playerDazedSeconds = 0.5;
    setRecovery(state);
    return;
  }
  movePredator(
    state,
    player.x - predator.x,
    player.z - predator.z,
    P4_TUNING.playerChaseSpeed,
    deltaSeconds,
  );
}

function updateHunt(
  state: P4SimulationState,
  deltaSeconds: number,
): void {
  const predator = state.predator;
  predator.phaseSeconds += deltaSeconds;
  if (!canSeeVictim(state)) {
    setSearch(state);
    return;
  }
  predator.targetId = state.victim.id;
  if (canAttackVictim(state)) {
    beginAim(state);
    return;
  }
  movePredator(
    state,
    state.victim.x - predator.x,
    state.victim.z - predator.z,
    P4_TUNING.predatorSpeed,
    deltaSeconds,
  );
}

function updateRecovery(
  state: P4SimulationState,
  deltaSeconds: number,
): void {
  const predator = state.predator;
  predator.phaseSeconds += deltaSeconds;
  predator.recoverySeconds += deltaSeconds;
  if (predator.recoverySeconds >= P4_TUNING.recoverySeconds) {
    setSearch(state);
  }
}

function updatePenCapture(
  state: P4SimulationState,
  player: P4StepInput,
  deltaSeconds: number,
): boolean {
  const predator = state.predator;
  if (!predator.insidePen) {
    if (isFullBodyInsidePen(predator, state.pen)) {
      predator.insidePen = true;
      predator.captureHoldSeconds = 0;
      recordEvent(state, "predatorEnteredPen", predator.id, "full-body-inside");
    }
  }
  if (!predator.insidePen) return false;
  const playerIsOutside = !playerInsidePen(player, state.pen);
  const victimIsOutside = !isFullBodyInsidePen(state.victim, state.pen);
  if (playerIsOutside && victimIsOutside) {
    predator.captureHoldSeconds += deltaSeconds;
  } else {
    predator.captureHoldSeconds = 0;
  }
  if (predator.captureHoldSeconds < P4_TUNING.captureHoldSeconds) return false;
  state.status = "completed";
  predator.attackPhase = "disabled";
  predator.intent = "none";
  predator.targetId = null;
  recordEvent(state, "predatorCaptured", predator.id, "pen-closed-with-player-outside");
  return true;
}

function updateTimers(
  state: P4SimulationState,
  deltaSeconds: number,
): void {
  const predator = state.predator;
  predator.threatSeconds = Math.max(0, predator.threatSeconds - deltaSeconds);
  predator.threatCooldownSeconds = Math.max(0, predator.threatCooldownSeconds - deltaSeconds);
  predator.playerDazedSeconds = Math.max(0, predator.playerDazedSeconds - deltaSeconds);
  if (predator.threatResistanceSeconds > 0) {
    predator.threatResistanceSeconds = Math.max(0, predator.threatResistanceSeconds - deltaSeconds);
  }
  if (predator.threatSeconds <= EPSILON
    && predator.intent === "chasePlayer"
    && predator.attackPhase === "chase") {
    setSearch(state);
    predator.threatResistanceSeconds = Math.max(
      predator.threatResistanceSeconds,
      P4_TUNING.threatResistanceSeconds,
    );
  }
}

function noOpResult(state: P4SimulationState): P4StepResult {
  return {
    status: state.status,
    failureReason: state.failureReason,
    attackStarted: false,
    threatAccepted: false,
    rescued: false,
    rescuePending: state.victim.lifeState === "rescuePending",
    captured: state.status === "completed",
  };
}

function readRunStatus(state: P4SimulationState): P4RunStatus {
  return state.status;
}

export function stepP4Simulation(
  state: P4SimulationState,
  player: P4StepInput,
  deltaSeconds: number,
): P4StepResult {
  if (state.status !== "active") return noOpResult(state);
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0
    || !Number.isFinite(player.x) || !Number.isFinite(player.z)
    || !Number.isFinite(player.speed ?? 0)) {
    return noOpResult(state);
  }
  const safeDelta = Math.min(deltaSeconds, 0.25);
  state.elapsedSeconds += safeDelta;
  const predator = state.predator;
  predator.previousX = predator.x;
  predator.previousZ = predator.z;
  state.victim.previousX = state.victim.x;
  state.victim.previousZ = state.victim.z;
  updateTimers(state, safeDelta);
  const threat = applyThreatSignal(state, player);
  const proximityRescue = applyProximityRescue(state, player);
  updateVictimTimers(state, safeDelta);
  if (state.status !== "active") return noOpResult(state);

  if (predator.attackPhase === "lunge") {
    updateLunge(state, safeDelta);
  } else if (predator.attackPhase === "aim") {
    updateAim(state, safeDelta);
  } else if (predator.attackPhase === "recovery") {
    updateRecovery(state, safeDelta);
  } else if (predator.intent === "chasePlayer" && predator.threatSeconds > EPSILON) {
    updateChasePlayer(state, player, safeDelta);
  } else {
    predator.intent = "hunt";
    updateHunt(state, safeDelta);
  }

  clampWorld(predator, P4_TUNING.predatorRadius);
  if (state.status === "active") updatePenCapture(state, player, safeDelta);
  const finalStatus = readRunStatus(state);
  return {
    status: finalStatus,
    failureReason: state.failureReason,
    attackStarted: state.events.some((event) =>
      event.type === "predatorAimStarted" && event.atSeconds === state.elapsedSeconds),
    threatAccepted: threat.accepted,
    rescued: threat.rescued || proximityRescue,
    rescuePending: state.victim.lifeState === "rescuePending",
    captured: finalStatus === "completed",
  };
}
