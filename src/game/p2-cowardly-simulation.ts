/**
 * Deterministic P2 "面白さ試作" rules.
 *
 * This slice deliberately contains only three cowardly animals, one pen, and
 * pressure from the player's position. Signals, tension, flock cohesion,
 * predators, scoring, and navigation meshes are intentionally out of scope.
 */

export type CowardPhase =
  | "idle"
  | "anticipating"
  | "fleeing"
  | "enteringPen"
  | "captured";

export type PressureBand = "none" | "attention" | "guidance" | "urgent";
export type FleeTriggerBand = "guidance" | "urgent";

export interface P2PlayerPosition {
  x: number;
  z: number;
  /** P1 movement speed, used only to distinguish walking from running pressure. */
  speed?: number;
  isRunning?: boolean;
}

export interface P2Pen {
  centerX: number;
  centerZ: number;
  halfWidth: number;
  halfDepth: number;
  entranceZ: number;
  entranceHalfWidth: number;
  animalRadius: number;
}

export interface CowardAnimalState {
  id: string;
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  phase: CowardPhase;
  phaseSeconds: number;
  captureHoldSeconds: number;
  fullBodyInside: boolean;
  /** The direction shown by the readable pre-reaction. */
  escapeX: number;
  escapeZ: number;
  lastMoveX: number;
  lastMoveZ: number;
  /** Time since guidance/urgent pressure was last active. */
  pressureReleaseSeconds: number;
  pressureBand: PressureBand;
  /** The pressure rule that owns the current flee release condition. */
  fleeTriggerBand: FleeTriggerBand | null;
}

export interface P2SimulationState {
  elapsedSeconds: number;
  animals: CowardAnimalState[];
  pen: P2Pen;
  /** Stable single-occupant entrance reservation for this P2 pen. */
  penReservedAnimalId: string | null;
  capturedCount: number;
  completed: boolean;
}

export const P2_TUNING = {
  attentionDistance: 5.5,
  guidanceDistance: 3.5,
  urgentDistance: 1.5,
  preReactionSeconds: 0.45,
  // Leaves the 2.2m/s P1 walk enough flank-changing headroom when several
  // animals react at once; 0.95m/s could outrun the deterministic replay.
  walkSpeed: 0.9,
  runningPressureMultiplier: 1.35,
  urgentEscapeSpeedMultiplier: 1.15,
  pressureReleaseSeconds: 1,
  captureHoldSeconds: 0.35,
  enteringTimeoutSeconds: 1,
  enteringSpeed: 2.2,
  preReactionHysteresis: 0.15,
  minimumAnimalSeparation: 1.35,
  // Keep the P1 world dimensions (±16.5m). Animal centers are clamped to
  // these dimensions inset by their body radius below; the old fixed ±13.8m
  // center bounds made the outer flank unreachable and could pin an animal.
  animalWorldMin: -16.5,
  animalWorldMax: 16.5,
} as const;

export const DEFAULT_P2_PEN: P2Pen = {
  centerX: 0,
  centerZ: -8.3,
  halfWidth: 5.2,
  halfDepth: 2.6,
  entranceZ: -5.7,
  entranceHalfWidth: 1.7,
  animalRadius: 0.52,
};

const INITIAL_ANIMALS: readonly P2PlayerPosition[] = [
  { x: -2.2, z: -2.7 },
  { x: 0, z: -2.25 },
  { x: 2.2, z: -2.7 },
];

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
  if (length < 1e-6) return { x: 0, z: -1 };
  return { x: x / length, z: z / length };
}

function animalWorldBounds(pen: P2Pen): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const radius = Math.max(0, finiteOr(pen.animalRadius, 0));
  const min = P2_TUNING.animalWorldMin + radius;
  const max = P2_TUNING.animalWorldMax - radius;
  return { minX: min, maxX: max, minZ: min, maxZ: max };
}

function clampAnimalToWorld(
  animal: { x: number; z: number },
  pen: P2Pen,
): void {
  const bounds = animalWorldBounds(pen);
  animal.x = clamp(animal.x, bounds.minX, bounds.maxX);
  animal.z = clamp(animal.z, bounds.minZ, bounds.maxZ);
}

function pressureBand(distance: number): PressureBand {
  if (distance <= P2_TUNING.urgentDistance) return "urgent";
  if (distance <= P2_TUNING.guidanceDistance) return "guidance";
  if (distance <= P2_TUNING.attentionDistance) return "attention";
  return "none";
}

function hystereticPressureBand(
  previous: PressureBand,
  effectiveDistance: number,
): PressureBand {
  const hysteresis = P2_TUNING.preReactionHysteresis;
  const current = pressureBand(effectiveDistance);
  if (previous === "urgent"
    && current !== "urgent"
    && effectiveDistance <= P2_TUNING.urgentDistance + hysteresis) {
    return "urgent";
  }
  if (previous === "guidance"
    && current === "attention"
    && effectiveDistance <= P2_TUNING.guidanceDistance + hysteresis) {
    return "guidance";
  }
  if (previous === "attention"
    && current === "none"
    && effectiveDistance <= P2_TUNING.attentionDistance + hysteresis) {
    return "attention";
  }
  return current;
}

function isPlayerRunning(player: P2PlayerPosition): boolean {
  return player.isRunning
    ?? ((player.speed ?? 0) >= P2_TUNING.walkSpeed * 1.15);
}

function effectivePressureDistance(
  player: P2PlayerPosition,
  distance: number,
): number {
  return distance / (isPlayerRunning(player) ? P2_TUNING.runningPressureMultiplier : 1);
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

/** True only when the animal's complete body fits inside the pen. */
export function isFullBodyInsidePen(
  animal: P2PlayerPosition,
  pen: P2Pen,
): boolean {
  const bounds = interiorBounds(pen);
  return animal.x >= bounds.minX
    && animal.x <= bounds.maxX
    && animal.z >= bounds.minZ
    && animal.z <= bounds.maxZ;
}

interface RailSegment {
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
}

interface RailSweepHit {
  progress: number;
  normalX: number;
  normalZ: number;
  kind: "face" | "endpoint" | "portal";
}

const GEOMETRY_EPSILON = 1e-7;
const RAIL_SEPARATION = 1e-4;

function getPenRails(pen: P2Pen, entranceOpen: boolean): RailSegment[] {
  const leftX = pen.centerX - pen.halfWidth;
  const rightX = pen.centerX + pen.halfWidth;
  const backZ = pen.centerZ - pen.halfDepth;
  const frontZ = pen.entranceZ;
  const rails: RailSegment[] = [
    { startX: leftX, startZ: backZ, endX: rightX, endZ: backZ },
    { startX: leftX, startZ: backZ, endX: leftX, endZ: frontZ },
    { startX: rightX, startZ: backZ, endX: rightX, endZ: frontZ },
  ];
  if (!entranceOpen) {
    rails.push({ startX: leftX, startZ: frontZ, endX: rightX, endZ: frontZ });
    return rails;
  }
  const entranceLeftX = pen.centerX - pen.entranceHalfWidth;
  const entranceRightX = pen.centerX + pen.entranceHalfWidth;
  rails.push(
    { startX: leftX, startZ: frontZ, endX: entranceLeftX, endZ: frontZ },
    { startX: entranceRightX, startZ: frontZ, endX: rightX, endZ: frontZ },
  );
  return rails;
}

function centerLineIntersectsRail(
  start: P2PlayerPosition,
  end: P2PlayerPosition,
  rail: RailSegment,
): boolean {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  if (Math.abs(rail.startZ - rail.endZ) < GEOMETRY_EPSILON) {
    const railZ = rail.startZ;
    const minX = Math.min(rail.startX, rail.endX);
    const maxX = Math.max(rail.startX, rail.endX);
    if (Math.abs(deltaZ) < GEOMETRY_EPSILON) {
      if (Math.abs(start.z - railZ) > GEOMETRY_EPSILON) return false;
      return Math.max(Math.min(start.x, end.x), minX)
        <= Math.min(Math.max(start.x, end.x), maxX) + GEOMETRY_EPSILON;
    }
    const progress = (railZ - start.z) / deltaZ;
    if (progress < -GEOMETRY_EPSILON || progress > 1 + GEOMETRY_EPSILON) return false;
    const crossingX = start.x + deltaX * progress;
    return crossingX >= minX - GEOMETRY_EPSILON
      && crossingX <= maxX + GEOMETRY_EPSILON;
  }

  const railX = rail.startX;
  const minZ = Math.min(rail.startZ, rail.endZ);
  const maxZ = Math.max(rail.startZ, rail.endZ);
  if (Math.abs(deltaX) < GEOMETRY_EPSILON) {
    if (Math.abs(start.x - railX) > GEOMETRY_EPSILON) return false;
    return Math.max(Math.min(start.z, end.z), minZ)
      <= Math.min(Math.max(start.z, end.z), maxZ) + GEOMETRY_EPSILON;
  }
  const progress = (railX - start.x) / deltaX;
  if (progress < -GEOMETRY_EPSILON || progress > 1 + GEOMETRY_EPSILON) return false;
  const crossingZ = start.z + deltaZ * progress;
  return crossingZ >= minZ - GEOMETRY_EPSILON
    && crossingZ <= maxZ + GEOMETRY_EPSILON;
}

/** True when a physical rail separates the player and animal centers. */
export function isPressureBlockedByPen(
  player: P2PlayerPosition,
  animal: P2PlayerPosition,
  pen: P2Pen,
): boolean {
  return getPenRails(pen, true).some((rail) =>
    centerLineIntersectsRail(player, animal, rail));
}

function closestPointOnRail(
  x: number,
  z: number,
  rail: RailSegment,
): { x: number; z: number } {
  const railX = rail.endX - rail.startX;
  const railZ = rail.endZ - rail.startZ;
  const lengthSquared = railX * railX + railZ * railZ;
  if (lengthSquared < GEOMETRY_EPSILON) {
    return { x: rail.startX, z: rail.startZ };
  }
  const progress = clamp(
    ((x - rail.startX) * railX + (z - rail.startZ) * railZ) / lengthSquared,
    0,
    1,
  );
  return {
    x: rail.startX + railX * progress,
    z: rail.startZ + railZ * progress,
  };
}

function addEarlierHit(
  earlier: RailSweepHit | null,
  candidate: RailSweepHit,
): RailSweepHit | null {
  if (candidate.progress < -GEOMETRY_EPSILON
    || candidate.progress > 1 + GEOMETRY_EPSILON) return earlier;
  const bounded = { ...candidate, progress: clamp(candidate.progress, 0, 1) };
  return !earlier || bounded.progress < earlier.progress - GEOMETRY_EPSILON
    ? bounded
    : earlier;
}

function sweepCircleAgainstRail(
  start: P2PlayerPosition,
  deltaX: number,
  deltaZ: number,
  rail: RailSegment,
  radius: number,
): RailSweepHit | null {
  let hit: RailSweepHit | null = null;
  const horizontal = Math.abs(rail.startZ - rail.endZ) < GEOMETRY_EPSILON;
  if (horizontal && Math.abs(deltaZ) > GEOMETRY_EPSILON) {
    const minX = Math.min(rail.startX, rail.endX);
    const maxX = Math.max(rail.startX, rail.endX);
    for (const normalZ of [-1, 1] as const) {
      if (deltaZ * normalZ >= -GEOMETRY_EPSILON) continue;
      const progress = (rail.startZ + normalZ * radius - start.z) / deltaZ;
      const crossingX = start.x + deltaX * progress;
      if (crossingX < minX - GEOMETRY_EPSILON
        || crossingX > maxX + GEOMETRY_EPSILON) continue;
      hit = addEarlierHit(hit, { progress, normalX: 0, normalZ, kind: "face" });
    }
  } else if (!horizontal && Math.abs(deltaX) > GEOMETRY_EPSILON) {
    const minZ = Math.min(rail.startZ, rail.endZ);
    const maxZ = Math.max(rail.startZ, rail.endZ);
    for (const normalX of [-1, 1] as const) {
      if (deltaX * normalX >= -GEOMETRY_EPSILON) continue;
      const progress = (rail.startX + normalX * radius - start.x) / deltaX;
      const crossingZ = start.z + deltaZ * progress;
      if (crossingZ < minZ - GEOMETRY_EPSILON
        || crossingZ > maxZ + GEOMETRY_EPSILON) continue;
      hit = addEarlierHit(hit, { progress, normalX, normalZ: 0, kind: "face" });
    }
  }

  const movementSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (movementSquared < GEOMETRY_EPSILON) return hit;
  for (const endpoint of [
    { x: rail.startX, z: rail.startZ },
    { x: rail.endX, z: rail.endZ },
  ]) {
    const relativeX = start.x - endpoint.x;
    const relativeZ = start.z - endpoint.z;
    const b = 2 * (relativeX * deltaX + relativeZ * deltaZ);
    const c = relativeX * relativeX + relativeZ * relativeZ - radius * radius;
    const discriminant = b * b - 4 * movementSquared * c;
    if (discriminant < -GEOMETRY_EPSILON) continue;
    const root = Math.sqrt(Math.max(0, discriminant));
    for (const progress of [
      (-b - root) / (2 * movementSquared),
      (-b + root) / (2 * movementSquared),
    ]) {
      if (progress < -GEOMETRY_EPSILON || progress > 1 + GEOMETRY_EPSILON) continue;
      const contactX = start.x + deltaX * progress - endpoint.x;
      const contactZ = start.z + deltaZ * progress - endpoint.z;
      const normal = normalized(contactX, contactZ);
      if (deltaX * normal.x + deltaZ * normal.z >= -GEOMETRY_EPSILON) continue;
      hit = addEarlierHit(hit, {
        progress,
        normalX: normal.x,
        normalZ: normal.z,
        kind: "endpoint",
      });
      break;
    }
  }
  return hit;
}

/**
 * Sweeps the body-aware opening face continuously with the rest of the rail
 * geometry.  The finite front rails alone are not sufficient: a diagonal
 * segment can cross the gap outside the usable center interval while missing
 * both endpoint circles.  The portal therefore contributes a synthetic hit
 * unless the center crosses the body-aware entrance face inside
 * `entranceHalfWidth - radius`.
 */
function sweepCircleAgainstEntrancePortal(
  start: P2PlayerPosition,
  deltaX: number,
  deltaZ: number,
  pen: P2Pen,
  radius: number,
  entranceOpen: boolean,
): RailSweepHit | null {
  if (Math.abs(deltaZ) < GEOMETRY_EPSILON) return null;
  // A body enters when its front edge reaches the rail plane and exits when
  // its back edge clears it. Evaluate those offset faces continuously so the
  // portal width and the circular sweep agree in both directions.
  const portalZ = deltaZ < 0
    ? pen.entranceZ + radius
    : pen.entranceZ - radius;
  const progress = (portalZ - start.z) / deltaZ;
  if (progress < -GEOMETRY_EPSILON || progress > 1 + GEOMETRY_EPSILON) {
    return null;
  }
  const crossingX = start.x + deltaX * progress;
  const railReach = pen.halfWidth + radius;
  if (Math.abs(crossingX - pen.centerX) > railReach + GEOMETRY_EPSILON) {
    return null;
  }
  const clearance = Math.max(0, pen.entranceHalfWidth - radius);
  if (entranceOpen && Math.abs(crossingX - pen.centerX) <= clearance + GEOMETRY_EPSILON) {
    return null;
  }
  return {
    progress,
    normalX: 0,
    normalZ: deltaZ < 0 ? 1 : -1,
    kind: "portal",
  };
}

function deterministicRailNormal(
  rail: RailSegment,
  pen: P2Pen,
): { x: number; z: number } {
  if (Math.abs(rail.startZ - rail.endZ) < GEOMETRY_EPSILON) {
    return { x: 0, z: rail.startZ >= pen.centerZ ? 1 : -1 };
  }
  return { x: rail.startX >= pen.centerX ? 1 : -1, z: 0 };
}

function resolveRailOverlaps(
  position: { x: number; z: number },
  rails: RailSegment[],
  pen: P2Pen,
  radius: number,
): void {
  for (let pass = 0; pass < 8; pass += 1) {
    let adjusted = false;
    for (const rail of rails) {
      const closest = closestPointOnRail(position.x, position.z, rail);
      const offsetX = position.x - closest.x;
      const offsetZ = position.z - closest.z;
      const distance = magnitude(offsetX, offsetZ);
      if (distance >= radius - GEOMETRY_EPSILON) continue;
      const normal = distance > GEOMETRY_EPSILON
        ? { x: offsetX / distance, z: offsetZ / distance }
        : deterministicRailNormal(rail, pen);
      const correction = radius - distance + RAIL_SEPARATION;
      position.x += normal.x * correction;
      position.z += normal.z * correction;
      adjusted = true;
    }
    if (!adjusted) break;
  }
}

/**
 * Constrains a circular body to its current side of the temporary pen rails.
 * The south rail has one radius-aware opening.
 */
export function constrainCircleAgainstPenRails(
  previous: P2PlayerPosition,
  current: P2PlayerPosition,
  pen: P2Pen,
  radius: number,
  entranceOpen = true,
): { x: number; z: number } {
  const safeRadius = Math.max(0, finiteOr(radius, 0));
  const start = {
    x: finiteOr(previous.x, pen.centerX),
    z: finiteOr(previous.z, pen.entranceZ + safeRadius),
  };
  const target = {
    x: finiteOr(current.x, start.x),
    z: finiteOr(current.z, start.z),
  };
  const rails = getPenRails(pen, entranceOpen);

  // A closed entrance can be applied after ownership changes. An unowned
  // body already in the radius-wide throat is recovered to the outside,
  // rather than being resolved to whichever side happens to be microscopically
  // closer.
  if (!entranceOpen) {
    const throatMinZ = pen.entranceZ - safeRadius;
    const throatMaxZ = pen.entranceZ + safeRadius;
    const inEntranceSpan = Math.abs(start.x - pen.centerX)
      <= pen.entranceHalfWidth + safeRadius;
    if (inEntranceSpan
      && start.z >= throatMinZ - GEOMETRY_EPSILON
      && start.z <= throatMaxZ + GEOMETRY_EPSILON) {
      start.z = throatMaxZ + RAIL_SEPARATION;
    }
  }
  resolveRailOverlaps(start, rails, pen, safeRadius);

  let position = { ...start };
  let remainingX = target.x - position.x;
  let remainingZ = target.z - position.z;
  const initialPortalHit = sweepCircleAgainstEntrancePortal(
    position,
    remainingX,
    remainingZ,
    pen,
    safeRadius,
    entranceOpen,
  );
  for (let pass = 0; pass < 6; pass += 1) {
    if (magnitude(remainingX, remainingZ) < GEOMETRY_EPSILON) break;
    const portalHit = pass === 0
      ? initialPortalHit
      : sweepCircleAgainstEntrancePortal(
        position,
        remainingX,
        remainingZ,
        pen,
        safeRadius,
        entranceOpen,
      );
    let earliest: RailSweepHit | null = null;
    let frontFaceHit: RailSweepHit | null = null;
    for (const rail of rails) {
      const hit = sweepCircleAgainstRail(
        position,
        remainingX,
        remainingZ,
        rail,
        safeRadius,
      );
      if (hit
        && hit.kind === "face"
        && Math.abs(rail.startZ - rail.endZ) < GEOMETRY_EPSILON
        && Math.abs(rail.startZ - pen.entranceZ) < GEOMETRY_EPSILON) {
        if (!frontFaceHit || hit.progress < frontFaceHit.progress) frontFaceHit = hit;
      }
      if (hit && (!earliest || hit.progress < earliest.progress)) earliest = hit;
    }
    if (portalHit) {
      // If the finite front face itself is reached first, retain that
      // conservative body contact. Otherwise the portal hit must win over an
      // endpoint hit, preventing diagonal corner sliding from turning an
      // outside crossing into an unowned entry.
      if (frontFaceHit && frontFaceHit.progress <= portalHit.progress + GEOMETRY_EPSILON) {
        earliest = frontFaceHit;
      } else {
        earliest = portalHit;
      }
    }
    if (!earliest) {
      position.x += remainingX;
      position.z += remainingZ;
      remainingX = 0;
      remainingZ = 0;
      break;
    }
    position.x += remainingX * earliest.progress
      + earliest.normalX * RAIL_SEPARATION;
    position.z += remainingZ * earliest.progress
      + earliest.normalZ * RAIL_SEPARATION;
    const remainingProgress = Math.max(0, 1 - earliest.progress);
    remainingX *= remainingProgress;
    remainingZ *= remainingProgress;
    const intoRail = remainingX * earliest.normalX + remainingZ * earliest.normalZ;
    if (intoRail < 0) {
      remainingX -= earliest.normalX * intoRail;
      remainingZ -= earliest.normalZ * intoRail;
    }
  }
  resolveRailOverlaps(position, rails, pen, safeRadius);
  return position;
}

export function getPressureBand(
  player: P2PlayerPosition,
  animal: P2PlayerPosition,
): PressureBand {
  const distance = magnitude(animal.x - player.x, animal.z - player.z);
  return pressureBand(effectivePressureDistance(player, distance));
}

function createAnimal(id: string, position: P2PlayerPosition): CowardAnimalState {
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
    pressureReleaseSeconds: 0,
    pressureBand: "none",
    fleeTriggerBand: null,
  };
}

export function createP2Simulation(): P2SimulationState {
  return {
    elapsedSeconds: 0,
    animals: INITIAL_ANIMALS.map((position, index) =>
      createAnimal(`coward-${index + 1}`, position)),
    pen: { ...DEFAULT_P2_PEN },
    penReservedAnimalId: null,
    capturedCount: 0,
    completed: false,
  };
}

function beginAnticipation(
  animal: CowardAnimalState,
  player: P2PlayerPosition,
): void {
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
  animal: CowardAnimalState,
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

function enteredPenWithInwardMotion(
  animal: CowardAnimalState,
  pen: P2Pen,
): boolean {
  const bounds = interiorBounds(pen);
  const crossedSouthEntrance = animal.previousZ > bounds.maxZ
    && animal.z <= bounds.maxZ;
  const progress = Math.abs(animal.z - animal.previousZ) > GEOMETRY_EPSILON
    ? (bounds.maxZ - animal.previousZ) / (animal.z - animal.previousZ)
    : 1;
  const crossingX = animal.previousX + (animal.x - animal.previousX) * progress;
  const withinEntranceWidth = crossingX >= pen.centerX
    - pen.entranceHalfWidth + pen.animalRadius
    && crossingX <= pen.centerX
    + pen.entranceHalfWidth - pen.animalRadius;
  if (!crossedSouthEntrance || !withinEntranceWidth) return false;
  if (!isFullBodyInsidePen(animal, pen)) return false;
  const displacementX = animal.x - animal.previousX;
  const displacementZ = animal.z - animal.previousZ;
  if (magnitude(displacementX, displacementZ) < GEOMETRY_EPSILON) return false;
  const displacement = normalized(displacementX, displacementZ);
  const inward = normalized(
    pen.centerX - animal.previousX,
    pen.centerZ - animal.previousZ,
  );
  return displacement.x * inward.x + displacement.z * inward.z > 0.08;
}

/**
 * Keeps an active animal on its current side of the temporary rails. The
 * south rail has one body-width-aware opening; entering through that opening
 * remains entirely driven by the player's position.
 */
function enforcePenRails(
  animal: CowardAnimalState,
  pen: P2Pen,
  entranceOpen: boolean,
): void {
  const constrained = constrainCircleAgainstPenRails(
    { x: animal.previousX, z: animal.previousZ },
    animal,
    pen,
    pen.animalRadius,
    entranceOpen,
  );
  animal.x = constrained.x;
  animal.z = constrained.z;
}

function updateEntering(
  animal: CowardAnimalState,
  pen: P2Pen,
  deltaSeconds: number,
): void {
  const bounds = interiorBounds(pen);
  const targetX = clamp(animal.x, bounds.minX + 0.18, bounds.maxX - 0.18);
  const targetZ = clamp(pen.centerZ, bounds.minZ + 0.18, bounds.maxZ - 0.18);
  const deltaX = targetX - animal.x;
  const deltaZ = targetZ - animal.z;
  const distance = magnitude(deltaX, deltaZ);
  if (distance > 0.05) {
    moveAnimal(animal, deltaX, deltaZ, P2_TUNING.enteringSpeed, deltaSeconds);
  } else {
    animal.lastMoveX = 0;
    animal.lastMoveZ = -1;
  }
  animal.fullBodyInside = isFullBodyInsidePen(animal, pen);
  if (animal.fullBodyInside) {
    animal.captureHoldSeconds += deltaSeconds;
  } else {
    animal.captureHoldSeconds = 0;
  }
}

interface AnimalUpdateResult {
  newlyCaptured: boolean;
  crossedEntranceThroat: boolean;
}

function updateAnimal(
  animal: CowardAnimalState,
  player: P2PlayerPosition,
  pen: P2Pen,
  deltaSeconds: number,
  entranceOpen: boolean,
): AnimalUpdateResult {
  animal.x = finiteOr(animal.x, pen.centerX);
  animal.z = finiteOr(animal.z, pen.centerZ);
  clampAnimalToWorld(animal, pen);
  animal.previousX = animal.x;
  animal.previousZ = animal.z;
  const distance = magnitude(animal.x - player.x, animal.z - player.z);
  const pressureBlocked = isPressureBlockedByPen(player, animal, pen);
  const effectiveDistance = pressureBlocked
    ? Number.POSITIVE_INFINITY
    : effectivePressureDistance(player, distance);
  animal.pressureBand = hystereticPressureBand(animal.pressureBand, effectiveDistance);

  if (animal.phase === "captured") {
    return { newlyCaptured: false, crossedEntranceThroat: false };
  }

  const seeingPlayer = animal.pressureBand !== "none";
  const activePressure = animal.pressureBand === "guidance"
    || animal.pressureBand === "urgent";
  if (animal.phase === "idle" && seeingPlayer) beginAnticipation(animal, player);

  if (animal.phase === "anticipating") {
    if (!seeingPlayer) {
      animal.phase = "idle";
      animal.phaseSeconds = 0;
      animal.pressureBand = "none";
      animal.fleeTriggerBand = null;
      return { newlyCaptured: false, crossedEntranceThroat: false };
    }
    animal.phaseSeconds = Math.min(
      P2_TUNING.preReactionSeconds,
      animal.phaseSeconds + deltaSeconds,
    );
    const escape = normalized(animal.x - player.x, animal.z - player.z);
    animal.escapeX = escape.x;
    animal.escapeZ = escape.z;
    // The attention band is deliberately a readable look-only reaction. It
    // does not make the animal flee until the player enters the 3.5m band.
    if (activePressure && animal.phaseSeconds >= P2_TUNING.preReactionSeconds) {
      animal.phase = "fleeing";
      animal.phaseSeconds = 0;
      animal.pressureReleaseSeconds = 0;
      animal.fleeTriggerBand = animal.pressureBand === "urgent"
        ? "urgent"
        : "guidance";
    }
    return { newlyCaptured: false, crossedEntranceThroat: false };
  }

  if (animal.phase === "fleeing") {
    animal.phaseSeconds += deltaSeconds;
    animal.fleeTriggerBand ??= animal.pressureBand === "urgent"
      ? "urgent"
      : "guidance";
    if (animal.pressureBand === "urgent") animal.fleeTriggerBand = "urgent";
    let away = { x: animal.escapeX, z: animal.escapeZ };
    if (activePressure) {
      away = normalized(animal.x - player.x, animal.z - player.z);
      animal.escapeX = away.x;
      animal.escapeZ = away.z;
      animal.pressureReleaseSeconds = 0;
    } else if (animal.fleeTriggerBand === "urgent") {
      animal.pressureReleaseSeconds += deltaSeconds;
    }
    const guidanceReleased = animal.fleeTriggerBand === "guidance"
      && animal.pressureBand === "none";
    const urgentReleased = animal.fleeTriggerBand === "urgent"
      && !activePressure
      && animal.pressureReleaseSeconds + GEOMETRY_EPSILON
        >= P2_TUNING.pressureReleaseSeconds;
    if (guidanceReleased || urgentReleased) {
      animal.phase = "idle";
      animal.phaseSeconds = 0;
      animal.pressureReleaseSeconds = 0;
      animal.fleeTriggerBand = null;
      animal.lastMoveX = 0;
      animal.lastMoveZ = 0;
      return { newlyCaptured: false, crossedEntranceThroat: false };
    }
    const speedMultiplier = animal.pressureBand === "urgent"
      ? P2_TUNING.urgentEscapeSpeedMultiplier
      : 1;
    moveAnimal(
      animal,
      away.x,
      away.z,
      P2_TUNING.walkSpeed * speedMultiplier,
      deltaSeconds,
    );
    enforcePenRails(animal, pen, entranceOpen);
    clampAnimalToWorld(animal, pen);
    animal.fullBodyInside = isFullBodyInsidePen(animal, pen);
    return {
      newlyCaptured: false,
      crossedEntranceThroat: crossedIntoEntranceThroat(animal, pen),
    };
  }

  if (animal.phase === "enteringPen") {
    animal.phaseSeconds += deltaSeconds;
    updateEntering(animal, pen, deltaSeconds);
    if (animal.fullBodyInside
      && animal.captureHoldSeconds + 1e-9 >= P2_TUNING.captureHoldSeconds) {
      animal.phase = "captured";
      animal.fleeTriggerBand = null;
      animal.phaseSeconds = Math.min(
        animal.phaseSeconds,
        P2_TUNING.enteringTimeoutSeconds,
      );
      return { newlyCaptured: true, crossedEntranceThroat: false };
    }
    // The bounded timeout prevents a future tuning change from leaving a
    // body forever in an entering state; it remains active and can be pushed
    // again rather than being silently counted as captured.
    if (animal.phaseSeconds >= P2_TUNING.enteringTimeoutSeconds
      && !animal.fullBodyInside) {
      animal.phase = "idle";
      animal.phaseSeconds = 0;
      animal.captureHoldSeconds = 0;
      animal.fleeTriggerBand = null;
    }
  }
  return { newlyCaptured: false, crossedEntranceThroat: false };
}

function entranceClearance(pen: P2Pen): number {
  return Math.max(0, pen.entranceHalfWidth - pen.animalRadius);
}

function crossingXAtZ(animal: CowardAnimalState, z: number): number | null {
  const deltaZ = animal.z - animal.previousZ;
  if (Math.abs(deltaZ) < GEOMETRY_EPSILON) return null;
  const progress = (z - animal.previousZ) / deltaZ;
  if (progress < -GEOMETRY_EPSILON || progress > 1 + GEOMETRY_EPSILON) return null;
  return animal.previousX + (animal.x - animal.previousX) * progress;
}

function fitsEntranceAtX(x: number, pen: P2Pen): boolean {
  return Math.abs(x - pen.centerX) <= entranceClearance(pen) + GEOMETRY_EPSILON;
}

function crossedIntoEntranceThroat(
  animal: CowardAnimalState,
  pen: P2Pen,
): boolean {
  const frontOutsideZ = pen.entranceZ + pen.animalRadius;
  if (animal.previousZ < frontOutsideZ - GEOMETRY_EPSILON
    || animal.z >= frontOutsideZ - GEOMETRY_EPSILON) return false;
  const crossingX = crossingXAtZ(animal, frontOutsideZ);
  return crossingX !== null && fitsEntranceAtX(crossingX, pen);
}

function isInEntranceThroat(
  animal: CowardAnimalState,
  pen: P2Pen,
): boolean {
  const frontOutsideZ = pen.entranceZ + pen.animalRadius;
  const frontInsideZ = pen.entranceZ - pen.animalRadius;
  return fitsEntranceAtX(animal.x, pen)
    && animal.z < frontOutsideZ - GEOMETRY_EPSILON
    && animal.z > frontInsideZ + GEOMETRY_EPSILON;
}

function stableAnimalOrder(
  first: CowardAnimalState,
  second: CowardAnimalState,
): number {
  if (first.id === second.id) return 0;
  return first.id < second.id ? -1 : 1;
}

function recoverAnimalOutsideEntrance(
  animal: CowardAnimalState,
  pen: P2Pen,
): void {
  const clearance = entranceClearance(pen);
  animal.x = clamp(
    animal.x,
    pen.centerX - clearance,
    pen.centerX + clearance,
  );
  animal.z = pen.entranceZ + pen.animalRadius + RAIL_SEPARATION;
  animal.fullBodyInside = false;
  animal.lastMoveX = 0;
  animal.lastMoveZ = 0;
  if (animal.phase === "enteringPen") {
    animal.phase = "idle";
    animal.phaseSeconds = 0;
    animal.captureHoldSeconds = 0;
    animal.pressureReleaseSeconds = 0;
    animal.fleeTriggerBand = null;
  }
}

function shouldReleaseEntranceOwner(
  owner: CowardAnimalState,
  pen: P2Pen,
): boolean {
  if (owner.phase === "captured" || owner.phase === "idle") return true;
  if (owner.phase !== "fleeing" && owner.phase !== "enteringPen") return true;
  return owner.phase === "fleeing"
    && owner.z > pen.entranceZ + pen.animalRadius + RAIL_SEPARATION;
}

/**
 * Resolves the P2 single-body entrance lock.
 *
 * A new lock may only be taken from the explicit self-movement sweep result
 * of the current update.  In particular, a body that is already in the throat
 * (or is pushed there by spacing) is not a candidate.  Calls made after
 * spacing intentionally omit `newCandidateIds`, so spacing can only trigger
 * recovery of an invalid non-owner and can never create ownership.
 */
function reconcileEntranceOwnership(
  state: P2SimulationState,
  newCandidateIds: readonly string[] = [],
): void {
  const stableAnimals = [...state.animals].sort(stableAnimalOrder);
  let owner = state.penReservedAnimalId === null
    ? null
    : stableAnimals.find((animal) => animal.id === state.penReservedAnimalId) ?? null;
  if (owner && shouldReleaseEntranceOwner(owner, state.pen)) owner = null;

  if (!owner && newCandidateIds.length > 0) {
    const candidates = new Set(newCandidateIds);
    owner = stableAnimals.find((animal) =>
      candidates.has(animal.id) && animal.phase === "fleeing") ?? null;
  }
  state.penReservedAnimalId = owner?.id ?? null;

  for (const animal of stableAnimals) {
    if (animal.phase === "captured" || animal.id === state.penReservedAnimalId) continue;
    const illegallyInside = isFullBodyInsidePen(animal, state.pen);
    const occupyingThroat = isInEntranceThroat(animal, state.pen);
    if (animal.phase === "enteringPen" || illegallyInside || occupyingThroat) {
      recoverAnimalOutsideEntrance(animal, state.pen);
    }
  }

  owner = state.penReservedAnimalId === null
    ? null
    : stableAnimals.find((animal) => animal.id === state.penReservedAnimalId) ?? null;
  if (owner?.phase === "fleeing" && enteredPenWithInwardMotion(owner, state.pen)) {
    owner.phase = "enteringPen";
    owner.phaseSeconds = 0;
    owner.captureHoldSeconds = 0;
    owner.pressureReleaseSeconds = 0;
    owner.fleeTriggerBand = null;
    owner.fullBodyInside = true;
  }
}

export interface P2StepResult {
  newlyCapturedIds: string[];
  capturedCount: number;
  completed: boolean;
}

function applySoftAnimalSpacing(state: P2SimulationState): void {
  const minimumDistance = P2_TUNING.minimumAnimalSeparation;
  // Three bodies need more than one pairwise pass when all positions coincide.
  // A small fixed iteration count keeps the result deterministic at 20Hz.
  for (let pass = 0; pass < 12; pass += 1) {
    let adjusted = false;
    for (let firstIndex = 0; firstIndex < state.animals.length; firstIndex += 1) {
      const first = state.animals[firstIndex];
      if (!first || first.phase === "captured") continue;
      for (let secondIndex = firstIndex + 1; secondIndex < state.animals.length; secondIndex += 1) {
        const second = state.animals[secondIndex];
        if (!second || second.phase === "captured") continue;
        const deltaX = second.x - first.x;
        const deltaZ = second.z - first.z;
        const distance = magnitude(deltaX, deltaZ);
        if (distance >= minimumDistance - 1e-4) continue;
        const direction = normalized(deltaX, deltaZ);
        const firstIsOwner = first.id === state.penReservedAnimalId;
        const secondIsOwner = second.id === state.penReservedAnimalId;
        const movableBodies = Number(first.phase !== "enteringPen" && !firstIsOwner)
          + Number(second.phase !== "enteringPen" && !secondIsOwner);
        if (movableBodies === 0) continue;
        const push = (minimumDistance - Math.max(distance, 1e-4)) / movableBodies;
        if (first.phase !== "enteringPen" && !firstIsOwner) {
          first.x -= direction.x * push;
          first.z -= direction.z * push;
        }
        if (second.phase !== "enteringPen" && !secondIsOwner) {
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

function placeCapturedAnimal(
  state: P2SimulationState,
  animal: CowardAnimalState,
): void {
  const animalIndex = Math.max(0, state.animals.indexOf(animal));
  const centerIndex = (state.animals.length - 1) / 2;
  const desiredX = state.pen.centerX
    + (animalIndex - centerIndex) * P2_TUNING.minimumAnimalSeparation * 1.15;
  const bounds = interiorBounds(state.pen);
  animal.x = clamp(desiredX, bounds.minX, bounds.maxX);
  animal.z = clamp(state.pen.centerZ, bounds.minZ, bounds.maxZ);
  animal.fullBodyInside = true;
  animal.lastMoveX = 0;
  animal.lastMoveZ = 0;
}

export function stepP2Simulation(
  state: P2SimulationState,
  player: P2PlayerPosition,
  deltaSeconds: number,
): P2StepResult {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return {
      newlyCapturedIds: [],
      capturedCount: state.capturedCount,
      completed: state.completed,
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
  const newlyCapturedIds: string[] = [];
  const newEntranceCandidateIds: string[] = [];
  reconcileEntranceOwnership(state);
  for (const animal of state.animals) {
    const entranceOpen = animal.phase === "fleeing"
      && (state.penReservedAnimalId === null
        || state.penReservedAnimalId === animal.id);
    const update = updateAnimal(animal, safePlayer, state.pen, safeDelta, entranceOpen);
    if (update.newlyCaptured) {
      placeCapturedAnimal(state, animal);
      newlyCapturedIds.push(animal.id);
    }
    if (update.crossedEntranceThroat) newEntranceCandidateIds.push(animal.id);
  }
  // Select the single new owner from self-movement candidates before any
  // spacing pass can alter their positions. Stable id order makes the result
  // independent of the caller's array order.
  reconcileEntranceOwnership(state, newEntranceCandidateIds);
  for (let constraintPass = 0; constraintPass < 3; constraintPass += 1) {
    applySoftAnimalSpacing(state);
    for (const animal of state.animals) {
      if (animal.phase !== "captured" && animal.phase !== "enteringPen") {
        const entranceOpen = animal.phase === "fleeing"
          && (state.penReservedAnimalId === null
            || state.penReservedAnimalId === animal.id);
        enforcePenRails(animal, state.pen, entranceOpen);
        clampAnimalToWorld(animal, state.pen);
        animal.fullBodyInside = isFullBodyInsidePen(animal, state.pen);
      }
    }
    reconcileEntranceOwnership(state);
  }
  state.capturedCount = state.animals.filter((animal) => animal.phase === "captured").length;
  state.completed = state.capturedCount === state.animals.length;
  return {
    newlyCapturedIds,
    capturedCount: state.capturedCount,
    completed: state.completed,
  };
}
