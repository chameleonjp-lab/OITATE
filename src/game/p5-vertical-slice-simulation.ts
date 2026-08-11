/**
 * Deterministic P5 vertical-slice rules.
 *
 * P5 deliberately owns a separate state from P3 and P4.  It combines the
 * three animal roles, terrain differences, two route choices, and the danger
 * loop without making either earlier slice's state mutable from here.
 */

import { isPressureBlockedByPen } from "./p2-cowardly-simulation";

export type P5AnimalType = "coward" | "follower" | "predator";
export type P5Route = "safe" | "fast";
export type P5RunStatus = "active" | "completed" | "failed";
export type P5FailureReason = "none" | "rescueTimeout" | "repeatedAttack";
export type P5LifeState = "active" | "rescuePending" | "captured" | "disabled";
export type P5AnimalPhase =
  | "idle"
  | "fleeing"
  | "following"
  | "waitingForPen"
  | "enteringPen"
  | "search"
  | "chase"
  | "aim"
  | "lunge"
  | "recovery"
  | "chasePlayer"
  | "rescuePending"
  | "captured"
  | "disabled";

export interface P5Pen {
  type: P5AnimalType;
  centerX: number;
  centerZ: number;
  halfWidth: number;
  halfDepth: number;
  entranceZ: number;
  entranceHalfWidth: number;
  animalRadius: number;
}

export interface P5Terrain {
  water: { minX: number; maxX: number; minZ: number; maxZ: number };
  bridge: { minX: number; maxX: number; minZ: number; maxZ: number };
  safeMarker: { minX: number; maxX: number; minZ: number; maxZ: number };
  fastMarker: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface P5AnimalState {
  id: string;
  type: P5AnimalType;
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  radius: number;
  phase: P5AnimalPhase;
  lifeState: P5LifeState;
  targetId: string | null;
  followingSeconds: number;
  tension: number;
  rescueSeconds: number;
  protectionSeconds: number;
  rescueCount: number;
  captureHoldSeconds: number;
  waitingSeconds: number;
  penRetryCooldownSeconds: number;
  insidePen: boolean;
  route: P5Route;
  lastMoveX: number;
  lastMoveZ: number;
}

export type P5EventType =
  | "routeDiscovered"
  | "animalStartedFollowing"
  | "animalEnteredPen"
  | "animalCaptured"
  | "predatorTargeted"
  | "predatorAimStarted"
  | "predatorLungeStarted"
  | "victimRescuePending"
  | "rescueSucceeded"
  | "rescueFailed"
  | "predatorThreatAccepted"
  | "predatorThreatRejected"
  | "predatorEnteredPen"
  | "predatorCaptured";

export interface P5Event {
  id: number;
  type: P5EventType;
  atSeconds: number;
  subjectId: string;
  reason: string;
}

export interface P5SimulationState {
  elapsedSeconds: number;
  status: P5RunStatus;
  failureReason: P5FailureReason;
  animals: P5AnimalState[];
  pens: Record<P5AnimalType, P5Pen>;
  penReservations: Record<P5AnimalType, string | null>;
  terrain: P5Terrain;
  discoveredRoutes: Record<P5Route, boolean>;
  eventSequence: number;
  events: P5Event[];
  guidanceSignalSeconds: number;
  threatCooldownSeconds: number;
  threatResistanceSeconds: number;
  rescueOverrideUsed: boolean;
}

export interface P5PlayerInput {
  x: number;
  z: number;
  speed: number;
  isRunning: boolean;
  guidanceSignal?: boolean;
  threatSignal?: boolean;
}

export interface P5StepResult {
  status: P5RunStatus;
  failureReason: P5FailureReason;
  guidanceAccepted: boolean;
  threatAccepted: boolean;
  rescued: boolean;
  routeDiscovered: P5Route | null;
  capturedIds: string[];
}

const WORLD_MIN = -16.5;
const WORLD_MAX = 16.5;
const EPSILON = 1e-7;

export const P5_TUNING = {
  decisionStepSeconds: 1 / 20,
  cowardCount: 6,
  followerCount: 4,
  predatorCount: 1,
  cowardPressureDistance: 3.5,
  followerDurationSeconds: 4,
  followerSpeed: 1.45,
  cowardSpeed: 1.12,
  predatorSpeed: 1.2,
  playerChaseSpeed: 1.8,
  runningSpeedMultiplier: 1.35,
  runningSpeedThreshold: 3.2,
  attackDistance: 1.25,
  attackWarningSeconds: 1.2,
  lungeSeconds: 0.45,
  lungeSpeed: 2.8,
  recoverySeconds: 1,
  detectionDistance: 8,
  threatDistance: 7,
  threatDurationSeconds: 4,
  threatCooldownSeconds: 3,
  threatResistanceSeconds: 1.75,
  rescueDeadlineSeconds: 3,
  rescueProtectionSeconds: 1,
  rescueDistance: 2.25,
  captureHoldSeconds: 0.6,
  penWaitSeconds: 0.75,
  penRetryCooldownSeconds: 0.5,
  minimumAnimalSeparation: 1.15,
  worldMin: WORLD_MIN,
  worldMax: WORLD_MAX,
  terrain: {
    water: { minX: -2.8, maxX: 2.8, minZ: -3.8, maxZ: 2.2 },
    bridge: { minX: -0.72, maxX: 0.72, minZ: -3.8, maxZ: 2.2 },
    safeMarker: { minX: -6.6, maxX: -4.2, minZ: -3.8, maxZ: 2.4 },
    fastMarker: { minX: -0.95, maxX: 0.95, minZ: -3.8, maxZ: 2.4 },
  } satisfies P5Terrain,
  pens: {
    coward: {
      type: "coward",
      centerX: -8.2,
      centerZ: -10.2,
      halfWidth: 3.3,
      halfDepth: 2.1,
      entranceZ: -8.1,
      entranceHalfWidth: 1.8,
      animalRadius: 0.52,
    },
    follower: {
      type: "follower",
      centerX: 8.2,
      centerZ: -10.2,
      halfWidth: 3.3,
      halfDepth: 2.1,
      entranceZ: -8.1,
      entranceHalfWidth: 1.8,
      animalRadius: 0.52,
    },
    predator: {
      type: "predator",
      centerX: 0,
      centerZ: -10.8,
      halfWidth: 2.1,
      halfDepth: 1.7,
      entranceZ: -9.1,
      entranceHalfWidth: 1.05,
      animalRadius: 0.55,
    },
  } satisfies Record<P5AnimalType, P5Pen>,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function distance(firstX: number, firstZ: number, secondX: number, secondZ: number): number {
  return Math.hypot(secondX - firstX, secondZ - firstZ);
}

function normalized(x: number, z: number): { x: number; z: number } {
  const length = Math.hypot(x, z);
  if (length < EPSILON) return { x: 0, z: -1 };
  return { x: x / length, z: z / length };
}

function inRect(x: number, z: number, rect: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

function createAnimal(
  id: string,
  type: P5AnimalType,
  x: number,
  z: number,
): P5AnimalState {
  const isPredator = type === "predator";
  return {
    id,
    type,
    x,
    z,
    previousX: x,
    previousZ: z,
    radius: isPredator ? 0.55 : 0.52,
    phase: isPredator ? "search" : "idle",
    lifeState: "active",
    targetId: null,
    followingSeconds: 0,
    tension: 0,
    rescueSeconds: 0,
    protectionSeconds: 0,
    rescueCount: 0,
    captureHoldSeconds: 0,
    waitingSeconds: 0,
    penRetryCooldownSeconds: 0,
    insidePen: false,
    route: "safe",
    lastMoveX: 0,
    lastMoveZ: -1,
  };
}

export function createP5Simulation(): P5SimulationState {
  const animals: P5AnimalState[] = [];
  const cowardPositions: Array<[number, number]> = [
    [-5.8, 5.7], [-4.2, 6.4], [-2.6, 5.5], [-1.0, 6.4], [0.6, 5.6], [2.2, 6.3],
  ];
  for (let index = 0; index < P5_TUNING.cowardCount; index += 1) {
    const [x, z] = cowardPositions[index] ?? [0, 6];
    animals.push(createAnimal(`coward-${index + 1}`, "coward", x, z));
  }
  const followerPositions: Array<[number, number]> = [[5.2, 5.6], [6.8, 6.3], [8.4, 5.5], [10, 6.2]];
  for (let index = 0; index < P5_TUNING.followerCount; index += 1) {
    const [x, z] = followerPositions[index] ?? [7, 6];
    animals.push(createAnimal(`follower-${index + 1}`, "follower", x, z));
  }
  // Keep the predator outside the fast-route marker at spawn; route
  // discovery must represent an animal crossing a route, not initial setup.
  animals.push(createAnimal("predator-1", "predator", 3.6, 0.8));

  return {
    elapsedSeconds: 0,
    status: "active",
    failureReason: "none",
    animals,
    pens: {
      coward: { ...P5_TUNING.pens.coward },
      follower: { ...P5_TUNING.pens.follower },
      predator: { ...P5_TUNING.pens.predator },
    },
    penReservations: { coward: null, follower: null, predator: null },
    terrain: {
      water: { ...P5_TUNING.terrain.water },
      bridge: { ...P5_TUNING.terrain.bridge },
      safeMarker: { ...P5_TUNING.terrain.safeMarker },
      fastMarker: { ...P5_TUNING.terrain.fastMarker },
    },
    discoveredRoutes: { safe: false, fast: false },
    eventSequence: 0,
    events: [],
    guidanceSignalSeconds: 0,
    threatCooldownSeconds: 0,
    threatResistanceSeconds: 0,
    rescueOverrideUsed: false,
  };
}

function recordEvent(
  state: P5SimulationState,
  type: P5EventType,
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

function getAnimal(state: P5SimulationState, id: string): P5AnimalState | undefined {
  return state.animals.find((animal) => animal.id === id);
}

function getPredator(state: P5SimulationState): P5AnimalState {
  const predator = state.animals.find((animal) => animal.type === "predator");
  if (!predator) throw new Error("P5の危険種が見つかりません。");
  return predator;
}

function getVictim(state: P5SimulationState): P5AnimalState | undefined {
  return getAnimal(state, "coward-1");
}

function canOccupy(
  state: P5SimulationState,
  animal: P5AnimalState,
  x: number,
  z: number,
): boolean {
  const water = inRect(x, z, state.terrain.water);
  if (!water) return true;
  if (animal.type === "coward") return false;
  // Followers and the predator can use both the bridge and the shallow
  // water. Cowards must route around the water, including the bridge.
  return true;
}

function clampWorld(animal: P5AnimalState): void {
  animal.x = clamp(animal.x, WORLD_MIN + animal.radius, WORLD_MAX - animal.radius);
  animal.z = clamp(animal.z, WORLD_MIN + animal.radius, WORLD_MAX - animal.radius);
}

function isAnimalClearOfPeers(
  state: P5SimulationState,
  animal: P5AnimalState,
  x: number,
  z: number,
): boolean {
  return state.animals.every((peer) => peer.id === animal.id
    || peer.type !== animal.type
    || peer.lifeState !== "active"
    || distance(x, z, peer.x, peer.z) >= P5_TUNING.minimumAnimalSeparation - EPSILON);
}

function resolveAnimalOverlap(state: P5SimulationState, animal: P5AnimalState): void {
  for (const peer of state.animals) {
    if (peer.id === animal.id || peer.type !== animal.type || peer.lifeState !== "active") continue;
    const currentDistance = distance(animal.x, animal.z, peer.x, peer.z);
    if (currentDistance >= P5_TUNING.minimumAnimalSeparation - EPSILON) continue;
    const direction = normalized(animal.x - peer.x, animal.z - peer.z);
    const correction = (P5_TUNING.minimumAnimalSeparation - currentDistance) + EPSILON;
    animal.x += direction.x * correction;
    animal.z += direction.z * correction;
    clampWorld(animal);
  }
}

function moveAnimal(
  state: P5SimulationState,
  animal: P5AnimalState,
  targetX: number,
  targetZ: number,
  speed: number,
  deltaSeconds: number,
): void {
  resolveAnimalOverlap(state, animal);
  const direction = normalized(targetX - animal.x, targetZ - animal.z);
  animal.lastMoveX = direction.x;
  animal.lastMoveZ = direction.z;
  animal.previousX = animal.x;
  animal.previousZ = animal.z;
  const inForbiddenWater = inRect(animal.x, animal.z, state.terrain.water)
    && !canOccupy(state, animal, animal.x, animal.z);
  if (inForbiddenWater) {
    const escapeX = animal.x <= (state.terrain.water.minX + state.terrain.water.maxX) / 2
      ? state.terrain.water.minX - animal.radius - 0.05
      : state.terrain.water.maxX + animal.radius + 0.05;
    const escapeDirection = normalized(escapeX - animal.x, 0);
    const escapeXPosition = animal.x + escapeDirection.x * speed * deltaSeconds;
    if (isAnimalClearOfPeers(state, animal, escapeXPosition, animal.z)) {
      animal.x = escapeXPosition;
    }
    clampWorld(animal);
    return;
  }
  const nextX = animal.x + direction.x * speed * deltaSeconds;
  const nextZ = animal.z + direction.z * speed * deltaSeconds;
  if (canOccupy(state, animal, nextX, nextZ)
    && isAnimalClearOfPeers(state, animal, nextX, nextZ)) {
    animal.x = nextX;
    animal.z = nextZ;
  } else if (canOccupy(state, animal, animal.x, nextZ)
    && isAnimalClearOfPeers(state, animal, animal.x, nextZ)) {
    animal.z = nextZ;
  } else if (canOccupy(state, animal, nextX, animal.z)
    && isAnimalClearOfPeers(state, animal, nextX, animal.z)) {
    animal.x = nextX;
  } else {
    // A deterministic side-step keeps the simulation recoverable at water
    // edges instead of turning a terrain mismatch into a permanent stall.
    const side = animal.x <= 0 ? -1 : 1;
    const sideX = animal.x + side * speed * deltaSeconds;
    if (canOccupy(state, animal, sideX, animal.z)
      && isAnimalClearOfPeers(state, animal, sideX, animal.z)) animal.x = sideX;
    else animal.lastMoveX = 0, animal.lastMoveZ = 0;
  }
  clampWorld(animal);
}

function isInsidePen(animal: P5AnimalState, pen: P5Pen): boolean {
  return Math.abs(animal.x - pen.centerX) <= pen.halfWidth - animal.radius
    && Math.abs(animal.z - pen.centerZ) <= pen.halfDepth - animal.radius;
}

function isAtEntrance(animal: P5AnimalState, pen: P5Pen): boolean {
  return Math.abs(animal.x - pen.centerX) <= pen.entranceHalfWidth - animal.radius
    && animal.z <= pen.entranceZ + animal.radius + 0.12
    && animal.z >= pen.entranceZ - 0.8;
}

function playerOutsidePen(player: P5PlayerInput, pen: P5Pen): boolean {
  return !(
    Math.abs(player.x - pen.centerX) <= pen.halfWidth - 0.52
    && Math.abs(player.z - pen.centerZ) <= pen.halfDepth - 0.52
  );
}

function updateRouteDiscovery(state: P5SimulationState): P5Route | null {
  const routeMarkers: Array<[P5Route, P5Terrain["safeMarker"]]> = [
    ["safe", state.terrain.safeMarker],
    ["fast", state.terrain.fastMarker],
  ];
  for (const animal of state.animals) {
    if (animal.lifeState === "disabled") continue;
    for (const [route, marker] of routeMarkers) {
      if (inRect(animal.x, animal.z, marker) && !state.discoveredRoutes[route]) {
        state.discoveredRoutes[route] = true;
        recordEvent(state, "routeDiscovered", route, `${animal.id}-entered-route-marker`);
        return route;
      }
    }
  }
  return null;
}

function applyGuidanceSignal(
  state: P5SimulationState,
  player: P5PlayerInput,
): boolean {
  if (!player.guidanceSignal || state.status !== "active") return false;
  state.guidanceSignalSeconds = P5_TUNING.followerDurationSeconds;
  const route: P5Route = inRect(player.x, player.z, state.terrain.fastMarker) ? "fast" : "safe";
  let accepted = false;
  for (const animal of state.animals) {
    if (animal.type !== "follower" || animal.lifeState !== "active") continue;
    animal.followingSeconds = P5_TUNING.followerDurationSeconds;
    animal.phase = "following";
    animal.route = route;
    accepted = true;
    recordEvent(state, "animalStartedFollowing", animal.id, route);
  }
  return accepted;
}

function setPredatorSearch(predator: P5AnimalState): void {
  predator.phase = "search";
  predator.targetId = null;
  predator.followingSeconds = 0;
  predator.captureHoldSeconds = 0;
}

function setPredatorRecovery(predator: P5AnimalState): void {
  predator.phase = "recovery";
  predator.targetId = null;
  predator.waitingSeconds = 0;
}

function canSeeTarget(
  state: P5SimulationState,
  predator: P5AnimalState,
  target: P5AnimalState,
): boolean {
  const from = { x: predator.x, z: predator.z };
  const to = { x: target.x, z: target.z };
  return !Object.values(state.pens).some((pen) => isPressureBlockedByPen(from, to, pen));
}

function targetCanBeAttacked(
  state: P5SimulationState,
  predator: P5AnimalState,
  target: P5AnimalState,
): boolean {
  return target.lifeState === "active"
    && target.protectionSeconds <= EPSILON
    && canSeeTarget(state, predator, target);
}

function applyThreatSignal(
  state: P5SimulationState,
  player: P5PlayerInput,
): { accepted: boolean; rescued: boolean } {
  if (!player.threatSignal || state.status !== "active") return { accepted: false, rescued: false };
  const predator = getPredator(state);
  if (predator.phase === "lunge"
    || predator.lifeState === "disabled"
    || predator.lifeState === "captured") {
    recordEvent(state, "predatorThreatRejected", predator.id, "lunge-or-disabled");
    return { accepted: false, rescued: false };
  }
  const inRange = distance(predator.x, predator.z, player.x, player.z) <= P5_TUNING.threatDistance;
  const rescueOverride = getVictim(state)?.lifeState === "rescuePending" && !state.rescueOverrideUsed;
  if (!inRange || (state.threatCooldownSeconds > EPSILON
    || state.threatResistanceSeconds > EPSILON) && !rescueOverride) {
    recordEvent(state, "predatorThreatRejected", predator.id, "range-or-resistance");
    return { accepted: false, rescued: false };
  }
  state.threatCooldownSeconds = P5_TUNING.threatCooldownSeconds;
  predator.phase = "chasePlayer";
  predator.targetId = null;
  predator.followingSeconds = P5_TUNING.threatDurationSeconds;
  recordEvent(state, "predatorThreatAccepted", predator.id, rescueOverride ? "rescue-override" : "normal-threat");

  const victim = getVictim(state);
  if (victim?.lifeState === "rescuePending" && !state.rescueOverrideUsed) {
    victim.lifeState = "active";
    victim.phase = "chasePlayer";
    victim.rescueSeconds = 0;
    victim.protectionSeconds = P5_TUNING.rescueProtectionSeconds;
    victim.rescueCount += 1;
    victim.tension = 55;
    state.rescueOverrideUsed = true;
    recordEvent(state, "rescueSucceeded", victim.id, "threat-signal");
    return { accepted: true, rescued: true };
  }
  return { accepted: true, rescued: false };
}

function reservePenEntrance(
  state: P5SimulationState,
  animal: P5AnimalState,
): boolean {
  const reservation = state.penReservations[animal.type];
  if (reservation && reservation !== animal.id) return false;
  state.penReservations[animal.type] = animal.id;
  return true;
}

function releasePenEntrance(
  state: P5SimulationState,
  animal: P5AnimalState,
): void {
  if (state.penReservations[animal.type] === animal.id) {
    state.penReservations[animal.type] = null;
  }
}

function moveWaitingAnimalBack(
  state: P5SimulationState,
  animal: P5AnimalState,
  pen: P5Pen,
  deltaSeconds: number,
): void {
  const numericId = Number(animal.id.match(/\d+$/)?.[0] ?? "0");
  const side = numericId % 2 === 0 ? 1 : -1;
  const speed = animal.type === "coward" ? P5_TUNING.cowardSpeed : P5_TUNING.followerSpeed;
  animal.phase = "idle";
  animal.waitingSeconds = 0;
  animal.penRetryCooldownSeconds = P5_TUNING.penRetryCooldownSeconds;
  moveAnimal(
    state,
    animal,
    pen.centerX + side * 1.4,
    pen.entranceZ + 1.6,
    speed,
    deltaSeconds,
  );
}

function updatePrey(
  state: P5SimulationState,
  animal: P5AnimalState,
  player: P5PlayerInput,
  deltaSeconds: number,
): string | null {
  if (animal.lifeState === "captured" || animal.lifeState === "disabled") return null;
  if (animal.lifeState === "rescuePending") return null;
  animal.protectionSeconds = Math.max(0, animal.protectionSeconds - deltaSeconds);
  animal.penRetryCooldownSeconds = Math.max(0, animal.penRetryCooldownSeconds - deltaSeconds);

  const pen = state.pens[animal.type];
  if (animal.phase === "waitingForPen") {
    animal.waitingSeconds += deltaSeconds;
    if (animal.waitingSeconds >= P5_TUNING.penWaitSeconds) {
      moveWaitingAnimalBack(state, animal, pen, deltaSeconds);
    }
    return null;
  }

  if (animal.phase === "enteringPen") {
    if (!reservePenEntrance(state, animal)) {
      animal.phase = "waitingForPen";
      animal.waitingSeconds = 0;
      return null;
    }
    const speed = animal.type === "coward" ? P5_TUNING.cowardSpeed : P5_TUNING.followerSpeed;
    moveAnimal(state, animal, pen.centerX, pen.centerZ, speed, deltaSeconds);
    animal.insidePen = isInsidePen(animal, pen);
    if (animal.insidePen) animal.captureHoldSeconds += deltaSeconds;
    else animal.captureHoldSeconds = 0;
    if (animal.insidePen && animal.captureHoldSeconds >= P5_TUNING.captureHoldSeconds) {
      animal.lifeState = "captured";
      animal.phase = "captured";
      animal.captureHoldSeconds = 0;
      animal.insidePen = true;
      releasePenEntrance(state, animal);
      recordEvent(state, "animalCaptured", animal.id, "full-body-inside-pen");
      return animal.id;
    }
    return null;
  }

  if (animal.type === "coward") {
    const distanceToPlayer = distance(animal.x, animal.z, player.x, player.z);
    animal.tension = clamp(
      animal.tension + (distanceToPlayer <= P5_TUNING.cowardPressureDistance ? 12 : -8) * deltaSeconds,
      0,
      100,
    );
    const underPressure = distanceToPlayer <= P5_TUNING.cowardPressureDistance;
    animal.phase = underPressure ? "fleeing" : "idle";
    if (underPressure) {
      const escape = normalized(animal.x - player.x, animal.z - player.z);
      const targetX = animal.x + escape.x * 2;
      const targetZ = animal.z + escape.z * 2;
      const running = player.isRunning || player.speed >= P5_TUNING.runningSpeedThreshold;
      moveAnimal(
        state,
        animal,
        targetX,
        targetZ,
        P5_TUNING.cowardSpeed * (running ? P5_TUNING.runningSpeedMultiplier : 1),
        deltaSeconds,
      );
    } else {
      animal.lastMoveX = 0;
      animal.lastMoveZ = 0;
    }
  } else {
    animal.followingSeconds = Math.max(0, animal.followingSeconds - deltaSeconds);
    const following = animal.followingSeconds > EPSILON;
    animal.phase = following ? "following" : "idle";
    if (following) {
      const running = player.isRunning || player.speed >= P5_TUNING.runningSpeedThreshold;
      moveAnimal(
        state,
        animal,
        player.x,
        player.z + 1.4,
        P5_TUNING.followerSpeed * (running ? P5_TUNING.runningSpeedMultiplier : 1),
        deltaSeconds,
      );
    } else {
      animal.lastMoveX = 0;
      animal.lastMoveZ = 0;
    }
  }

  if (animal.penRetryCooldownSeconds <= EPSILON && isAtEntrance(animal, pen)) {
    if (reservePenEntrance(state, animal)) {
      animal.phase = "enteringPen";
      animal.waitingSeconds = 0;
      recordEvent(state, "animalEnteredPen", animal.id, "entrance-reserved");
    } else {
      animal.phase = "waitingForPen";
      animal.waitingSeconds = 0;
    }
  }
  return null;
}

function updatePredator(
  state: P5SimulationState,
  player: P5PlayerInput,
  deltaSeconds: number,
): { rescued: boolean } {
  const predator = getPredator(state);
  const victim = getVictim(state);
  if (predator.lifeState === "disabled" || predator.lifeState === "captured") {
    return { rescued: false };
  }
  const predatorPen = state.pens.predator;
  const wasInsidePen = predator.insidePen;
  if (wasInsidePen) {
    predator.x = clamp(
      predator.x,
      predatorPen.centerX - predatorPen.halfWidth + predator.radius,
      predatorPen.centerX + predatorPen.halfWidth - predator.radius,
    );
    predator.z = clamp(
      predator.z,
      predatorPen.centerZ - predatorPen.halfDepth + predator.radius,
      predatorPen.centerZ + predatorPen.halfDepth - predator.radius,
    );
  }
  predator.protectionSeconds = Math.max(0, predator.protectionSeconds - deltaSeconds);
  if (victim?.lifeState === "rescuePending") {
    victim.rescueSeconds += deltaSeconds;
    if (victim.rescueSeconds >= P5_TUNING.rescueDeadlineSeconds) {
      state.status = "failed";
      state.failureReason = "rescueTimeout";
      predator.lifeState = "disabled";
      predator.phase = "disabled";
      recordEvent(state, "rescueFailed", victim.id, "rescue-timeout");
      return { rescued: false };
    }
  }

  let rescued = false;
  if (!wasInsidePen && predator.phase === "chasePlayer") {
    if (distance(predator.x, predator.z, player.x, player.z) <= 0.78) {
      predator.followingSeconds = 0;
      state.threatResistanceSeconds = P5_TUNING.threatResistanceSeconds;
      setPredatorRecovery(predator);
    } else {
      moveAnimal(state, predator, player.x, player.z, P5_TUNING.playerChaseSpeed, deltaSeconds);
    }
  } else if (predator.phase === "aim") {
    predator.waitingSeconds += deltaSeconds;
    const target = predator.targetId ? getAnimal(state, predator.targetId) : undefined;
    if (!target || !targetCanBeAttacked(state, predator, target)
      || distance(predator.x, predator.z, target.x, target.z) > P5_TUNING.attackDistance) {
      setPredatorSearch(predator);
    } else if (predator.waitingSeconds >= P5_TUNING.attackWarningSeconds) {
      predator.phase = "lunge";
      predator.waitingSeconds = 0;
      recordEvent(state, "predatorLungeStarted", predator.id, "aim-complete");
    }
  } else if (predator.phase === "lunge") {
    const target = predator.targetId ? getAnimal(state, predator.targetId) : undefined;
    if (target && targetCanBeAttacked(state, predator, target)) {
      moveAnimal(state, predator, target.x, target.z, P5_TUNING.lungeSpeed, deltaSeconds);
      if (distance(predator.x, predator.z, target.x, target.z) <= 0.78) {
        if (target.rescueCount > 0) {
          state.status = "failed";
          state.failureReason = "repeatedAttack";
          target.lifeState = "disabled";
          target.phase = "disabled";
          predator.lifeState = "disabled";
          predator.phase = "disabled";
          recordEvent(state, "rescueFailed", target.id, "repeated-attack");
        } else {
          target.lifeState = "rescuePending";
          target.phase = "rescuePending";
          target.rescueSeconds = 0;
          target.tension = 100;
          recordEvent(state, "victimRescuePending", target.id, "first-valid-lunge");
          setPredatorRecovery(predator);
        }
      }
    } else {
      setPredatorRecovery(predator);
    }
    if (predator.phase === "lunge" && predator.waitingSeconds >= P5_TUNING.lungeSeconds) {
      setPredatorRecovery(predator);
    }
    predator.waitingSeconds += deltaSeconds;
  } else if (predator.phase === "recovery") {
    predator.waitingSeconds += deltaSeconds;
    if (predator.waitingSeconds >= P5_TUNING.recoverySeconds) setPredatorSearch(predator);
  } else {
    const target = victim && targetCanBeAttacked(state, predator, victim) ? victim : undefined;
    if (!target && predator.phase === "chase") setPredatorSearch(predator);
    if (target && distance(predator.x, predator.z, target.x, target.z) <= P5_TUNING.detectionDistance) {
      predator.targetId = target.id;
      predator.phase = "chase";
      recordEvent(state, "predatorTargeted", predator.id, target.id);
    } else if (target) {
      moveAnimal(state, predator, target.x, target.z, P5_TUNING.predatorSpeed, deltaSeconds);
    }
    const refreshedTarget = predator.targetId ? getAnimal(state, predator.targetId) : undefined;
    if (refreshedTarget && targetCanBeAttacked(state, predator, refreshedTarget)) {
      const targetDistance = distance(predator.x, predator.z, refreshedTarget.x, refreshedTarget.z);
      if (targetDistance <= P5_TUNING.attackDistance) {
        predator.phase = "aim";
        predator.waitingSeconds = 0;
        recordEvent(state, "predatorAimStarted", predator.id, refreshedTarget.id);
      } else if (predator.phase === "chase") {
        moveAnimal(state, predator, refreshedTarget.x, refreshedTarget.z, P5_TUNING.predatorSpeed, deltaSeconds);
      }
    } else if (predator.phase === "chase") {
      setPredatorSearch(predator);
    }
  }

  if (victim?.lifeState === "rescuePending"
    && !state.rescueOverrideUsed
    && distance(predator.x, predator.z, player.x, player.z) <= P5_TUNING.rescueDistance) {
    victim.lifeState = "active";
    victim.phase = "idle";
    victim.rescueSeconds = 0;
    victim.protectionSeconds = P5_TUNING.rescueProtectionSeconds;
    victim.rescueCount += 1;
    victim.tension = 55;
    state.rescueOverrideUsed = true;
    recordEvent(state, "rescueSucceeded", victim.id, "player-proximity");
    rescued = true;
  }

  predator.insidePen = isInsidePen(predator, predatorPen);
  if (predator.insidePen) {
    if (!wasInsidePen && predator.phase !== "disabled") {
      recordEvent(state, "predatorEnteredPen", predator.id, "full-body-inside-pen");
    }
    predator.captureHoldSeconds += deltaSeconds;
    if (playerOutsidePen(player, predatorPen)
      && predator.captureHoldSeconds >= P5_TUNING.captureHoldSeconds) {
      predator.lifeState = "captured";
      predator.phase = "disabled";
      recordEvent(state, "predatorCaptured", predator.id, "player-left-predator-pen");
    }
  } else {
    predator.captureHoldSeconds = 0;
  }
  return { rescued };
}

function updateCompletion(state: P5SimulationState): void {
  if (state.status !== "active") return;
  const preyCaptured = state.animals
    .filter((animal) => animal.type !== "predator")
    .every((animal) => animal.lifeState === "captured");
  const predatorCaptured = getPredator(state).lifeState === "captured";
  if (preyCaptured && predatorCaptured) state.status = "completed";
}

export function stepP5Simulation(
  state: P5SimulationState,
  player: P5PlayerInput,
  deltaSeconds: number,
): P5StepResult {
  const emptyResult: P5StepResult = {
    status: state.status,
    failureReason: state.failureReason,
    guidanceAccepted: false,
    threatAccepted: false,
    rescued: false,
    routeDiscovered: null,
    capturedIds: [],
  };
  if (state.status !== "active" || !finite(deltaSeconds) || deltaSeconds <= 0
    || !finite(player.x) || !finite(player.z) || !finite(player.speed)) return emptyResult;

  for (const animal of state.animals) {
    if (animal.lifeState === "captured" || animal.lifeState === "disabled") continue;
    animal.previousX = animal.x;
    animal.previousZ = animal.z;
  }
  state.elapsedSeconds += deltaSeconds;
  state.guidanceSignalSeconds = Math.max(0, state.guidanceSignalSeconds - deltaSeconds);
  state.threatCooldownSeconds = Math.max(0, state.threatCooldownSeconds - deltaSeconds);
  state.threatResistanceSeconds = Math.max(0, state.threatResistanceSeconds - deltaSeconds);

  let routeDiscovered: P5Route | null = null;
  const guidanceAccepted = applyGuidanceSignal(state, player);
  const threat = applyThreatSignal(state, player);
  const capturedIds: string[] = [];

  if (state.status === "active") {
    for (const animal of state.animals) {
      if (animal.type === "predator") continue;
      const captured = updatePrey(state, animal, player, deltaSeconds);
      if (captured) capturedIds.push(captured);
    }
    const predatorResult = updatePredator(state, player, deltaSeconds);
    routeDiscovered = updateRouteDiscovery(state);
    updateCompletion(state);
    return {
      status: state.status,
      failureReason: state.failureReason,
      guidanceAccepted,
      threatAccepted: threat.accepted,
      rescued: threat.rescued || predatorResult.rescued,
      routeDiscovered,
      capturedIds,
    };
  }
  return {
    ...emptyResult,
    status: state.status,
    failureReason: state.failureReason,
    guidanceAccepted,
    threatAccepted: threat.accepted,
    rescued: threat.rescued,
    routeDiscovered,
    capturedIds,
  };
}
