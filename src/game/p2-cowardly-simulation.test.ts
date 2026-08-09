import { describe, expect, it } from "vitest";

import {
  DEFAULT_P2_PEN,
  P2_TUNING,
  constrainCircleAgainstPenRails,
  createP2Simulation,
  getPressureBand,
  isFullBodyInsidePen,
  isPressureBlockedByPen,
  stepP2Simulation,
} from "./p2-cowardly-simulation";

describe("P2 cowardly animal prototype", () => {
  it("uses the three readable pressure bands", () => {
    expect(getPressureBand({ x: 0, z: 0 }, { x: 0, z: 5.6 })).toBe("none");
    expect(getPressureBand({ x: 0, z: 0 }, { x: 0, z: 5.5 })).toBe("attention");
    expect(getPressureBand({ x: 0, z: 0 }, { x: 0, z: 3.5 })).toBe("guidance");
    expect(getPressureBand({ x: 0, z: 0 }, { x: 0, z: 1.5 })).toBe("urgent");
  });

  it("raises effective pressure while the player is running", () => {
    expect(getPressureBand({ x: 0, z: 0, isRunning: false }, { x: 0, z: 4.5 })).toBe("attention");
    expect(getPressureBand({ x: 0, z: 0, isRunning: true }, { x: 0, z: 4.5 })).toBe("guidance");
    expect(getPressureBand({ x: 0, z: 0, isRunning: false }, { x: 0, z: 2 })).toBe("guidance");
    expect(getPressureBand({ x: 0, z: 0, isRunning: true }, { x: 0, z: 2 })).toBe("urgent");
  });

  it("moves faster in the urgent band without reusing the running-pressure rule", () => {
    const displacementAt = (distance: number): number => {
      const state = createP2Simulation();
      const animal = state.animals[0];
      if (!animal) throw new Error("missing test animal");
      for (const other of state.animals.slice(1)) other.phase = "captured";
      animal.x = 10;
      animal.z = 0;
      animal.phase = "fleeing";
      stepP2Simulation(state, { x: 10, z: distance, isRunning: false }, 0.05);
      return Math.abs(animal.z);
    };

    expect(displacementAt(1)).toBeGreaterThan(displacementAt(2.4));
  });

  it("shows a pre-reaction without moving in the attention band", () => {
    const state = createP2Simulation();
    const animal = state.animals[1];
    if (!animal) throw new Error("missing test animal");
    const start = { x: animal.x, z: animal.z };

    stepP2Simulation(state, { x: animal.x, z: animal.z + 5 }, 0.05);
    expect(animal.phase).toBe("anticipating");
    expect(animal.pressureBand).toBe("attention");
    expect(animal.x).toBe(start.x);
    expect(animal.z).toBe(start.z);
    expect(animal.escapeZ).toBeLessThan(0);
  });

  it("follows the opposite direction only after entering the guidance band", () => {
    const state = createP2Simulation();
    const animal = state.animals[1];
    if (!animal) throw new Error("missing test animal");
    const player = { x: animal.x, z: animal.z + 3.4, isRunning: false };

    stepP2Simulation(state, player, 0.25);
    stepP2Simulation(state, player, 0.25);
    stepP2Simulation(state, player, 0.05);
    expect(animal.phase).toBe("fleeing");
    const before = { x: animal.x, z: animal.z };
    stepP2Simulation(state, player, 0.05);
    expect(animal.z).toBeLessThan(before.z);
    expect(animal.lastMoveZ).toBeLessThan(0);
  });

  it("requires complete-body entry and the 0.35 second hold", () => {
    const inside = {
      x: DEFAULT_P2_PEN.centerX,
      z: DEFAULT_P2_PEN.centerZ,
    };
    const edge = {
      x: DEFAULT_P2_PEN.centerX + DEFAULT_P2_PEN.halfWidth,
      z: DEFAULT_P2_PEN.centerZ,
    };
    expect(isFullBodyInsidePen(inside, DEFAULT_P2_PEN)).toBe(true);
    expect(isFullBodyInsidePen(edge, DEFAULT_P2_PEN)).toBe(false);

    const state = createP2Simulation();
    const animal = state.animals[0];
    if (!animal) throw new Error("missing test animal");
    animal.x = inside.x;
    animal.z = inside.z;
    animal.lastMoveZ = -1;
    animal.phase = "enteringPen";
    state.penReservedAnimalId = animal.id;

    stepP2Simulation(state, { x: 0, z: 6 }, 0.25);
    expect(animal.phase).toBe("enteringPen");
    stepP2Simulation(state, { x: 0, z: 6 }, 0.1);
    expect(animal.phase).toBe("captured");
    expect(state.capturedCount).toBe(1);
  });

  it("finishes only after all three are captured and keeps entrance ownership stable", () => {
    const state = createP2Simulation();
    const first = state.animals[0];
    const second = state.animals[1];
    if (!first || !second) throw new Error("missing test animals");
    for (const animal of [first, second]) {
      animal.x = state.pen.centerX;
      animal.z = state.pen.centerZ;
      animal.lastMoveZ = -1;
      animal.phase = "enteringPen";
    }
    // An entering body must already have acquired its lock from the prior
    // self-movement sweep; a phase/current-position injection alone is not a
    // new ownership candidate.
    state.penReservedAnimalId = first.id;
    stepP2Simulation(state, { x: 0, z: 6 }, 0.05);
    expect(state.penReservedAnimalId).toBe(first.id);
    expect(second.phase).not.toBe("enteringPen");
    expect(state.completed).toBe(false);
  });

  it("keeps a following animal outside while the entrance is reserved", () => {
    const state = createP2Simulation();
    const first = state.animals[0];
    const second = state.animals[1];
    if (!first || !second) throw new Error("missing test animals");
    first.x = state.pen.centerX;
    first.z = state.pen.centerZ;
    first.phase = "enteringPen";
    first.lastMoveZ = -1;
    state.penReservedAnimalId = first.id;

    const frontOutsideZ = state.pen.entranceZ + state.pen.animalRadius;
    second.x = state.pen.centerX;
    second.z = frontOutsideZ + 0.01;
    second.phase = "fleeing";
    stepP2Simulation(state, { x: second.x, z: second.z + 2.4 }, 0.05);

    expect(state.penReservedAnimalId).toBe(first.id);
    expect(second.phase).toBe("fleeing");
    expect(second.z).toBeGreaterThan(frontOutsideZ);
  });

  it("does not leak NaN or leave the world bounds after degenerate input", () => {
    const state = createP2Simulation();
    const animal = state.animals[0];
    if (!animal) throw new Error("missing test animal");
    animal.x = Number.NaN;
    animal.z = Number.POSITIVE_INFINITY;
    stepP2Simulation(state, { x: Number.NaN, z: Number.POSITIVE_INFINITY }, 0.05);
    expect(Number.isFinite(animal.x)).toBe(true);
    expect(Number.isFinite(animal.z)).toBe(true);
    expect(animal.x).toBeGreaterThanOrEqual(P2_TUNING.animalWorldMin);
    expect(animal.x).toBeLessThanOrEqual(P2_TUNING.animalWorldMax);
    expect(animal.z).toBeGreaterThanOrEqual(P2_TUNING.animalWorldMin);
    expect(animal.z).toBeLessThanOrEqual(P2_TUNING.animalWorldMax);
  });

  it("resolves three coincident active bodies to the minimum separation", () => {
    const state = createP2Simulation();
    for (const animal of state.animals) {
      animal.x = 8;
      animal.z = 8;
    }
    stepP2Simulation(state, { x: -16, z: -16 }, 0.05);

    for (let firstIndex = 0; firstIndex < state.animals.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < state.animals.length; secondIndex += 1) {
        const first = state.animals[firstIndex];
        const second = state.animals[secondIndex];
        if (!first || !second) throw new Error("missing test animals");
        expect(Math.hypot(second.x - first.x, second.z - first.z)).toBeGreaterThanOrEqual(
          P2_TUNING.minimumAnimalSeparation - 1e-3,
        );
      }
    }
  });

  it("can repeatedly position the player behind one animal until it is captured", () => {
    const state = createP2Simulation();
    const animal = state.animals[1];
    if (!animal) throw new Error("missing test animal");
    for (let tick = 0; tick < 220 && animal.phase !== "captured"; tick += 1) {
      stepP2Simulation(
        state,
        { x: animal.x, z: animal.z + 2.4, isRunning: false },
        0.05,
      );
    }
    expect(animal.phase).toBe("captured");
    expect(animal.fullBodyInside).toBe(true);
  });

  it("blocks a closed front rail while leaving the entrance passable", () => {
    const state = createP2Simulation();
    const animal = state.animals[0];
    if (!animal) throw new Error("missing test animal");
    const frontOutsideZ = state.pen.entranceZ + state.pen.animalRadius;
    animal.x = state.pen.centerX + state.pen.entranceHalfWidth + 0.4;
    animal.z = frontOutsideZ + 0.01;
    animal.phase = "fleeing";

    stepP2Simulation(state, { x: animal.x, z: animal.z + 2.4 }, 0.05);
    expect(animal.z).toBeGreaterThan(frontOutsideZ);

    animal.x = state.pen.centerX;
    for (let tick = 0; tick < 40; tick += 1) {
      stepP2Simulation(state, { x: animal.x, z: animal.z + 2.4 }, 0.05);
    }
    expect(animal.phase).toBe("captured");
  });

  it("sweeps against finite pen rails without treating them as infinite walls", () => {
    const pen = DEFAULT_P2_PEN;
    const radius = pen.animalRadius;
    const outsideRails = constrainCircleAgainstPenRails(
      { x: 10, z: pen.entranceZ + 1 },
      { x: 10, z: pen.centerZ - pen.halfDepth - 1 },
      pen,
      radius,
    );
    expect(outsideRails.x).toBeCloseTo(10);
    expect(outsideRails.z).toBeCloseTo(pen.centerZ - pen.halfDepth - 1);

    const diagonal = constrainCircleAgainstPenRails(
      { x: pen.centerX - 3, z: pen.entranceZ + 1 },
      { x: pen.centerX, z: pen.entranceZ - 1 },
      pen,
      radius,
    );
    expect(diagonal.z).toBeGreaterThanOrEqual(pen.entranceZ + radius - 1e-3);
  });

  it("passes only through the opening and uses the same circle constraint for the player", () => {
    const pen = DEFAULT_P2_PEN;
    const radius = 0.52;
    const throughOpening = constrainCircleAgainstPenRails(
      { x: pen.centerX, z: pen.entranceZ + 1 },
      { x: pen.centerX, z: pen.entranceZ - 1 },
      pen,
      radius,
    );
    expect(throughOpening.z).toBeCloseTo(pen.entranceZ - 1);

    const throughSide = constrainCircleAgainstPenRails(
      { x: pen.centerX + pen.halfWidth + 1, z: pen.centerZ },
      { x: pen.centerX + pen.halfWidth - 1, z: pen.centerZ },
      pen,
      radius,
    );
    expect(throughSide.x).toBeGreaterThanOrEqual(
      pen.centerX + pen.halfWidth + radius - 1e-3,
    );

    const closedThroat = constrainCircleAgainstPenRails(
      { x: pen.centerX, z: pen.entranceZ },
      { x: pen.centerX, z: pen.entranceZ - 0.4 },
      pen,
      radius,
      false,
    );
    expect(closedThroat.z).toBeGreaterThan(pen.entranceZ + radius);
  });

  it("sweeps the body-aware portal continuously for the diagonal regression and its mirror", () => {
    const pen = DEFAULT_P2_PEN;
    const radius = pen.animalRadius;
    const previous = { x: -1.3, z: -5.17 };
    const current = { x: -1.044, z: -5.626 };
    const result = constrainCircleAgainstPenRails(previous, current, pen, radius);
    const mirrored = constrainCircleAgainstPenRails(
      { x: -previous.x, z: previous.z },
      { x: -current.x, z: current.z },
      pen,
      radius,
    );
    const outsideFaceZ = pen.entranceZ + radius;
    expect(result.z).toBeGreaterThanOrEqual(outsideFaceZ - 1e-3);
    expect(mirrored.z).toBeGreaterThanOrEqual(outsideFaceZ - 1e-3);

    const clearance = pen.entranceHalfWidth - radius;
    const outsideStartZ = outsideFaceZ + 0.2;
    const insideTargetZ = pen.entranceZ - radius - 0.4;
    for (const deltaSeconds of [0.05, 0.25]) {
      for (const side of [-1, 1]) {
        const inside = constrainCircleAgainstPenRails(
          { x: pen.centerX + side * (clearance - 1e-3), z: outsideStartZ },
          {
            x: pen.centerX + side * (clearance - 1e-3),
            z: insideTargetZ - deltaSeconds,
          },
          pen,
          radius,
        );
        expect(inside.z).toBeLessThan(pen.entranceZ - radius);

        const outside = constrainCircleAgainstPenRails(
          { x: pen.centerX + side * (clearance + 1e-3), z: outsideStartZ },
          {
            x: pen.centerX + side * (clearance + 1e-3),
            z: insideTargetZ - deltaSeconds,
          },
          pen,
          radius,
        );
        expect(outside.z).toBeGreaterThanOrEqual(outsideFaceZ - 1e-3);
      }
    }

    for (const deltaSeconds of [0.05, 0.25]) {
      for (const side of [-1, 1]) {
        const insideToOutside = constrainCircleAgainstPenRails(
          { x: pen.centerX + side * (clearance + 1e-3), z: insideTargetZ },
          {
            x: pen.centerX + side * (clearance + 1e-3),
            z: outsideStartZ + deltaSeconds,
          },
          pen,
          radius,
        );
        expect(insideToOutside.z).toBeLessThanOrEqual(
          pen.entranceZ - radius + 1e-3,
        );
      }
    }
  });

  it("keeps a valid normal entry and repeated small sweeps equivalent to the portal rule", () => {
    const pen = DEFAULT_P2_PEN;
    const radius = pen.animalRadius;
    const clearance = pen.entranceHalfWidth - radius;
    const direct = constrainCircleAgainstPenRails(
      { x: pen.centerX, z: pen.entranceZ + 0.8 },
      { x: pen.centerX, z: pen.entranceZ - 1.4 },
      pen,
      radius,
    );
    expect(direct.z).toBeCloseTo(pen.entranceZ - 1.4, 6);
    expect(Math.abs(direct.x - pen.centerX)).toBeLessThanOrEqual(clearance);

    let previous = { x: pen.centerX - 0.4, z: pen.entranceZ + 0.8 };
    const target = { x: pen.centerX + 0.4, z: pen.entranceZ - 1.4 };
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const progress = (iteration + 1) / 4;
      const targetStep = {
        x: previous.x + (target.x - previous.x) * progress,
        z: previous.z + (target.z - previous.z) * progress,
      };
      const constrained = constrainCircleAgainstPenRails(previous, targetStep, pen, radius);
      expect(constrained.x).toBeGreaterThanOrEqual(pen.centerX - pen.halfWidth - radius - 1e-6);
      expect(constrained.x).toBeLessThanOrEqual(pen.centerX + pen.halfWidth + radius + 1e-6);
      previous = constrained;
    }
    expect(previous.z).toBeLessThan(pen.entranceZ - radius);
  });

  it("does not turn a repeated outside-face collision into entering or captured", () => {
    const state = createP2Simulation();
    const animal = state.animals[0];
    if (!animal) throw new Error("missing test animal");
    for (const other of state.animals.slice(1)) other.phase = "captured";
    const radius = state.pen.animalRadius;
    const clearance = state.pen.entranceHalfWidth - radius;
    const outsideFaceZ = state.pen.entranceZ + radius;
    animal.x = state.pen.centerX + clearance + 0.1;
    animal.z = outsideFaceZ + 0.1;
    animal.phase = "fleeing";
    animal.fleeTriggerBand = "guidance";

    for (let tick = 0; tick < 40; tick += 1) {
      stepP2Simulation(
        state,
        { x: animal.x, z: outsideFaceZ + 2.4, isRunning: false },
        0.05,
      );
      expect(animal.phase).not.toBe("enteringPen");
      expect(animal.phase).not.toBe("captured");
      expect(animal.z).toBeGreaterThanOrEqual(outsideFaceZ - 1e-3);
    }
    expect(state.penReservedAnimalId).toBe(null);
    expect(state.capturedCount).toBe(2);
    expect(state.completed).toBe(false);
  });

  it("blocks pressure only when a finite rail segment intersects the center line", () => {
    const pen = DEFAULT_P2_PEN;
    expect(isPressureBlockedByPen(
      { x: 3, z: pen.entranceZ + 2 },
      { x: 3, z: pen.entranceZ - 2 },
      pen,
    )).toBe(true);
    expect(isPressureBlockedByPen(
      { x: 0, z: pen.entranceZ + 2 },
      { x: 0, z: pen.entranceZ - 2 },
      pen,
    )).toBe(false);
    expect(isPressureBlockedByPen(
      { x: -pen.entranceHalfWidth, z: pen.entranceZ + 2 },
      { x: -pen.entranceHalfWidth, z: pen.entranceZ - 2 },
      pen,
    )).toBe(true);
    expect(isPressureBlockedByPen(
      { x: 10, z: pen.entranceZ + 2 },
      { x: 10, z: pen.centerZ - pen.halfDepth - 2 },
      pen,
    )).toBe(false);
  });

  it("fleeing movement is exactly away from the player", () => {
    const state = createP2Simulation();
    const animal = state.animals[0];
    if (!animal) throw new Error("missing test animal");
    for (const other of state.animals.slice(1)) other.phase = "captured";
    animal.x = 10;
    animal.z = 0;
    animal.phase = "fleeing";
    animal.fleeTriggerBand = "guidance";

    stepP2Simulation(state, { x: 9, z: 0, isRunning: false }, 0.05);
    expect(animal.lastMoveX).toBeCloseTo(1);
    expect(animal.lastMoveZ).toBeCloseTo(0);
    expect(animal.z).toBeCloseTo(0);
  });

  it("uses distinct guidance and urgent flee release rules", () => {
    const guidanceState = createP2Simulation();
    const guidanceAnimal = guidanceState.animals[0];
    if (!guidanceAnimal) throw new Error("missing guidance animal");
    for (const other of guidanceState.animals.slice(1)) other.phase = "captured";
    guidanceAnimal.x = 10;
    guidanceAnimal.z = 0;
    guidanceAnimal.phase = "fleeing";
    guidanceAnimal.fleeTriggerBand = "guidance";
    stepP2Simulation(guidanceState, { x: 10, z: 5, isRunning: false }, 0.25);
    expect(guidanceAnimal.phase).toBe("fleeing");
    stepP2Simulation(guidanceState, { x: 10, z: 8, isRunning: false }, 0.05);
    expect(guidanceAnimal.phase).toBe("idle");

    const urgentState = createP2Simulation();
    const urgentAnimal = urgentState.animals[0];
    if (!urgentAnimal) throw new Error("missing urgent animal");
    for (const other of urgentState.animals.slice(1)) other.phase = "captured";
    urgentAnimal.x = 10;
    urgentAnimal.z = 0;
    urgentAnimal.phase = "fleeing";
    urgentAnimal.fleeTriggerBand = "guidance";
    stepP2Simulation(urgentState, { x: 10, z: 1, isRunning: false }, 0.05);
    expect(urgentAnimal.fleeTriggerBand).toBe("urgent");
    for (let elapsed = 0; elapsed < 0.75; elapsed += 0.25) {
      stepP2Simulation(urgentState, { x: 10, z: 8, isRunning: false }, 0.25);
    }
    expect(urgentAnimal.phase).toBe("fleeing");
    stepP2Simulation(urgentState, { x: 10, z: 8, isRunning: false }, 0.25);
    expect(urgentAnimal.phase).toBe("idle");
  });

  it("reserves simultaneous throat entry by stable id and holds followers outside", () => {
    const state = createP2Simulation();
    const first = state.animals[0];
    const second = state.animals[1];
    const third = state.animals[2];
    if (!first || !second || !third) throw new Error("missing test animals");
    third.phase = "captured";
    const frontOutsideZ = state.pen.entranceZ + state.pen.animalRadius;
    for (const [index, animal] of [first, second].entries()) {
      animal.x = index === 0 ? -0.4 : 0.4;
      animal.z = frontOutsideZ + 0.04;
      animal.phase = "fleeing";
      animal.fleeTriggerBand = "guidance";
    }

    stepP2Simulation(state, { x: 0, z: frontOutsideZ + 2.4 }, 0.05);
    expect(state.penReservedAnimalId).toBe(first.id);
    expect(second.z).toBeGreaterThanOrEqual(frontOutsideZ);
    expect(second.fullBodyInside).toBe(false);
  });

  it("rechecks a spacing displacement at the entrance and forbids unowned active entry", () => {
    const state = createP2Simulation();
    const owner = state.animals[0];
    const firstFollower = state.animals[1];
    const secondFollower = state.animals[2];
    if (!owner || !firstFollower || !secondFollower) throw new Error("missing test animals");
    owner.x = state.pen.centerX;
    owner.z = state.pen.centerZ;
    owner.phase = "enteringPen";
    state.penReservedAnimalId = owner.id;
    const frontOutsideZ = state.pen.entranceZ + state.pen.animalRadius;
    for (const [index, animal] of [firstFollower, secondFollower].entries()) {
      animal.x = 0;
      animal.z = frontOutsideZ + 0.02 + index * 0.01;
      animal.phase = "fleeing";
      animal.fleeTriggerBand = "urgent";
    }

    stepP2Simulation(state, { x: 0, z: 12, isRunning: false }, 0.05);
    expect(firstFollower.z).toBeGreaterThanOrEqual(frontOutsideZ);
    expect(secondFollower.z).toBeGreaterThanOrEqual(frontOutsideZ);
    expect(firstFollower.fullBodyInside).toBe(false);
    expect(secondFollower.fullBodyInside).toBe(false);

    firstFollower.x = state.pen.centerX;
    firstFollower.z = state.pen.centerZ;
    firstFollower.phase = "fleeing";
    firstFollower.fullBodyInside = true;
    stepP2Simulation(state, { x: 0, z: 12, isRunning: false }, 0.05);
    expect(firstFollower.fullBodyInside).toBe(false);
    expect(firstFollower.z).toBeGreaterThan(state.pen.entranceZ);
  });

  it("does not reserve an entrance from current throat position or spacing alone", () => {
    const state = createP2Simulation();
    const first = state.animals[0];
    const second = state.animals[1];
    const third = state.animals[2];
    if (!first || !second || !third) throw new Error("missing test animals");
    third.phase = "captured";
    const frontOutsideZ = state.pen.entranceZ + state.pen.animalRadius;

    // Existing current-position data is not a new sweep candidate.
    first.x = state.pen.centerX;
    first.z = (frontOutsideZ + state.pen.entranceZ - state.pen.animalRadius) / 2;
    first.phase = "fleeing";
    first.fleeTriggerBand = "guidance";
    stepP2Simulation(state, { x: 0, z: 16.5 }, 0.05);
    expect(state.penReservedAnimalId).toBe(null);
    expect(first.z).toBeGreaterThanOrEqual(frontOutsideZ);

    // A spacing pass may move a body into the throat, but cannot grant it a
    // lock after the self-movement sweep has already completed.
    first.phase = "idle";
    second.phase = "idle";
    first.x = second.x = state.pen.centerX;
    first.z = second.z = frontOutsideZ + 0.01;
    state.penReservedAnimalId = null;
    stepP2Simulation(state, { x: 16.5, z: 16.5 }, 0.05);
    expect(state.penReservedAnimalId).toBe(null);
    expect(first.z).toBeGreaterThanOrEqual(frontOutsideZ);
    expect(second.z).toBeGreaterThanOrEqual(frontOutsideZ);
  });

  it("chooses one stable self-sweep candidate and never lets spacing push its owner", () => {
    const state = createP2Simulation();
    const first = state.animals[0];
    const second = state.animals[1];
    const third = state.animals[2];
    if (!first || !second || !third) throw new Error("missing test animals");
    third.phase = "captured";
    const frontOutsideZ = state.pen.entranceZ + state.pen.animalRadius;
    for (const [index, animal] of [first, second].entries()) {
      animal.x = index === 0 ? -0.4 : 0.4;
      animal.z = frontOutsideZ + 0.04;
      animal.phase = "fleeing";
      animal.fleeTriggerBand = "guidance";
    }

    stepP2Simulation(state, { x: 0, z: frontOutsideZ + 2.4 }, 0.05);
    expect(state.penReservedAnimalId).toBe(first.id);
    expect(first.z).toBeLessThan(frontOutsideZ);
    expect(second.z).toBeGreaterThanOrEqual(frontOutsideZ);

    const ownerPosition = { x: first.x, z: first.z };
    const control = structuredClone(state);
    const controlOwner = control.animals[0];
    const controlFollower = control.animals[1];
    if (!controlOwner || !controlFollower) throw new Error("missing control animals");
    controlFollower.x = 8;
    controlFollower.z = 8;
    stepP2Simulation(control, { x: 0, z: frontOutsideZ + 2.4 }, 0.05);
    second.x = first.x;
    second.z = first.z;
    stepP2Simulation(state, { x: 0, z: frontOutsideZ + 2.4 }, 0.05);
    expect(state.penReservedAnimalId).toBe(first.id);
    expect(first.x).toBeCloseTo(controlOwner.x, 8);
    expect(first.z).toBeCloseTo(controlOwner.z, 8);
    expect(first.z).toBeLessThanOrEqual(ownerPosition.z);
    expect(second.fullBodyInside).toBe(false);
    expect(second.z).toBeGreaterThanOrEqual(frontOutsideZ);
  });

  it("keeps a captured animal visible and stationary in the pen state", () => {
    const state = createP2Simulation();
    const animal = state.animals[0];
    if (!animal) throw new Error("missing test animal");
    animal.phase = "captured";
    animal.x = state.pen.centerX - 0.6;
    animal.z = state.pen.centerZ;
    animal.fullBodyInside = true;
    const position = { x: animal.x, z: animal.z };
    stepP2Simulation(state, { x: 0, z: 0 }, 0.25);
    expect(animal.phase).toBe("captured");
    expect(animal.x).toBe(position.x);
    expect(animal.z).toBe(position.z);
    expect(state.capturedCount).toBe(1);
  });

  it("freezes every captured-animal field on a positive-delta update", () => {
    const state = createP2Simulation();
    const captured = state.animals[0];
    if (!captured) throw new Error("missing captured animal");
    captured.phase = "captured";
    captured.x = state.pen.centerX - 0.6;
    captured.z = state.pen.centerZ;
    captured.previousX = captured.x - 0.25;
    captured.previousZ = captured.z + 0.25;
    captured.phaseSeconds = 7.25;
    captured.captureHoldSeconds = 0.9;
    captured.fullBodyInside = true;
    captured.escapeX = 0.75;
    captured.escapeZ = -0.66;
    captured.lastMoveX = 0.4;
    captured.lastMoveZ = -0.9;
    captured.pressureReleaseSeconds = 0.8;
    captured.pressureBand = "urgent";
    captured.fleeTriggerBand = "urgent";
    const before = structuredClone(captured);

    stepP2Simulation(
      state,
      { x: captured.x, z: captured.z, speed: 4, isRunning: true },
      0.25,
    );

    expect(captured).toEqual(before);
    expect(state.capturedCount).toBe(1);
    expect(state.completed).toBe(false);
  });

  it("treats every non-positive or non-finite delta as a complete state no-op", () => {
    const state = createP2Simulation();
    const owner = state.animals[0];
    const overlapping = state.animals[1];
    const captured = state.animals[2];
    if (!owner || !overlapping || !captured) throw new Error("missing test animals");
    owner.phase = "anticipating";
    owner.phaseSeconds = P2_TUNING.preReactionSeconds;
    owner.x = state.pen.centerX;
    owner.z = state.pen.entranceZ + state.pen.animalRadius + 0.01;
    overlapping.x = owner.x;
    overlapping.z = owner.z;
    overlapping.phase = "fleeing";
    overlapping.fleeTriggerBand = "urgent";
    captured.phase = "captured";
    captured.fullBodyInside = true;
    state.penReservedAnimalId = owner.id;
    state.elapsedSeconds = 12.34;
    state.capturedCount = 1;
    state.completed = false;

    for (const deltaSeconds of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const before = structuredClone(state);
      const result = stepP2Simulation(state, { x: -16.5, z: 16.5 }, deltaSeconds);
      expect(state).toEqual(before);
      expect(result).toEqual({
        newlyCapturedIds: [],
        capturedCount: before.capturedCount,
        completed: before.completed,
      });
    }
  });

  it("can guide all three animals through the single entrance using only player position", () => {
    const state = createP2Simulation();

    for (let tick = 0; tick < 1_200 && !state.completed; tick += 1) {
      const target = state.animals.find((animal) => animal.phase !== "captured");
      if (!target) break;
      const outsideOffset = target.x < -0.35 ? -1 : target.x > 0.35 ? 1 : 0;
      stepP2Simulation(
        state,
        {
          x: target.x + outsideOffset,
          z: target.z + 2.1,
          isRunning: false,
        },
        0.05,
      );
    }

    expect(state.completed).toBe(true);
    expect(state.capturedCount).toBe(3);
    expect(state.animals.every((animal) => animal.phase === "captured")).toBe(true);
    const [first, second, third] = state.animals;
    if (!first || !second || !third) throw new Error("missing captured animals");
    expect(second.x - first.x).toBeGreaterThanOrEqual(
      P2_TUNING.minimumAnimalSeparation,
    );
    expect(third.x - second.x).toBeGreaterThanOrEqual(
      P2_TUNING.minimumAnimalSeparation,
    );
  });

  it("completes the independent 20Hz constrained-player reproduction within 90 seconds", () => {
    const state = createP2Simulation();
    let player = { x: 0, z: 4.5 };
    const tickSeconds = 0.05;
    const maximumPlayerStep = 0.11;

    for (let tick = 0; tick < 90 / tickSeconds && !state.completed; tick += 1) {
      const target = state.animals.find((animal) => animal.phase !== "captured");
      if (!target) break;
      const desired = {
        x: target.x + (target.x < -0.35 ? -1 : target.x > 0.35 ? 1 : 0),
        z: target.z + 2.6,
      };
      const deltaX = desired.x - player.x;
      const deltaZ = desired.z - player.z;
      const distance = Math.hypot(deltaX, deltaZ);
      const step = Math.min(maximumPlayerStep, distance);
      const next = distance > 1e-8
        ? {
          x: player.x + deltaX / distance * step,
          z: player.z + deltaZ / distance * step,
        }
        : player;
      player = constrainCircleAgainstPenRails(
        player,
        next,
        state.pen,
        0.52,
      );
      stepP2Simulation(
        state,
        {
          ...player,
          speed: step / tickSeconds,
          isRunning: false,
        },
        tickSeconds,
      );
    }

    expect(state.completed).toBe(true);
    expect(state.capturedCount).toBe(3);
  });

  it("keeps a compact group of at least two bodies within 0.75m of its centroid", () => {
    const state = createP2Simulation();
    const first = state.animals[0];
    const second = state.animals[1];
    const third = state.animals[2];
    if (!first || !second || !third) throw new Error("missing test animals");
    third.phase = "captured";
    first.x = 7.3;
    first.z = 8;
    second.x = 8.7;
    second.z = 8;

    stepP2Simulation(state, { x: -10, z: -10 }, 0.05);
    const group = state.animals.filter((animal) => animal.phase !== "captured");
    const centroid = {
      x: group.reduce((sum, animal) => sum + animal.x, 0) / group.length,
      z: group.reduce((sum, animal) => sum + animal.z, 0) / group.length,
    };
    expect(group.length).toBeGreaterThanOrEqual(2);
    for (const animal of group) {
      expect(Math.hypot(animal.x - centroid.x, animal.z - centroid.z))
        .toBeLessThanOrEqual(0.75);
    }
  });

  it("keeps animal centers inside the radius-inset world on every edge and corner", () => {
    const radius = DEFAULT_P2_PEN.animalRadius;
    const centerMin = P2_TUNING.animalWorldMin + radius;
    const centerMax = P2_TUNING.animalWorldMax - radius;
    const playerMin = P2_TUNING.animalWorldMin;
    const playerMax = P2_TUNING.animalWorldMax;
    const cases = [
      { x: centerMin, z: 0, player: { x: playerMin, z: 0 } },
      { x: centerMax, z: 0, player: { x: playerMax, z: 0 } },
      { x: 0, z: centerMin, player: { x: 0, z: playerMin } },
      { x: 0, z: centerMax, player: { x: 0, z: playerMax } },
      { x: centerMin, z: centerMin, player: { x: playerMin, z: playerMin } },
      { x: centerMin, z: centerMax, player: { x: playerMin, z: playerMax } },
      { x: centerMax, z: centerMin, player: { x: playerMax, z: playerMin } },
      { x: centerMax, z: centerMax, player: { x: playerMax, z: playerMax } },
    ];

    for (const deltaSeconds of [0.05, 0.25]) {
      for (const testCase of cases) {
        const state = createP2Simulation();
        const animal = state.animals[0];
        if (!animal) throw new Error("missing test animal");
        for (const other of state.animals.slice(1)) other.phase = "captured";
        animal.x = testCase.x;
        animal.z = testCase.z;
        animal.phase = "fleeing";
        animal.fleeTriggerBand = "guidance";

        stepP2Simulation(state, testCase.player, deltaSeconds);

        expect(animal.x).toBeGreaterThanOrEqual(centerMin - 1e-9);
        expect(animal.x).toBeLessThanOrEqual(centerMax + 1e-9);
        expect(animal.z).toBeGreaterThanOrEqual(centerMin - 1e-9);
        expect(animal.z).toBeLessThanOrEqual(centerMax + 1e-9);
        if (testCase.x === centerMin) expect(animal.x).toBeGreaterThan(testCase.x);
        if (testCase.x === centerMax) expect(animal.x).toBeLessThan(testCase.x);
        if (testCase.z === centerMin) expect(animal.z).toBeGreaterThan(testCase.z);
        if (testCase.z === centerMax) expect(animal.z).toBeLessThan(testCase.z);
      }
    }
  });

  it("uses the same inset bounds for spacing and invalid-position recovery", () => {
    const radius = DEFAULT_P2_PEN.animalRadius;
    const centerMin = P2_TUNING.animalWorldMin + radius;
    const centerMax = P2_TUNING.animalWorldMax - radius;
    const state = createP2Simulation();
    for (const animal of state.animals) {
      animal.x = Number.NaN;
      animal.z = Number.POSITIVE_INFINITY;
    }
    stepP2Simulation(state, { x: -16.5, z: -16.5 }, 0.25);
    for (const animal of state.animals) {
      expect(animal.x).toBeGreaterThanOrEqual(centerMin);
      expect(animal.x).toBeLessThanOrEqual(centerMax);
      expect(animal.z).toBeGreaterThanOrEqual(centerMin);
      expect(animal.z).toBeLessThanOrEqual(centerMax);
      expect(Number.isFinite(animal.x)).toBe(true);
      expect(Number.isFinite(animal.z)).toBe(true);
    }

    const spacing = createP2Simulation();
    const corner = { x: centerMax, z: centerMax };
    for (const animal of spacing.animals) {
      animal.x = corner.x;
      animal.z = corner.z;
    }
    stepP2Simulation(spacing, { x: 0, z: 0 }, 0.05);
    for (const animal of spacing.animals) {
      expect(animal.x).toBeGreaterThanOrEqual(centerMin - 1e-9);
      expect(animal.x).toBeLessThanOrEqual(centerMax + 1e-9);
      expect(animal.z).toBeGreaterThanOrEqual(centerMin - 1e-9);
      expect(animal.z).toBeLessThanOrEqual(centerMax + 1e-9);
    }
    for (let firstIndex = 0; firstIndex < spacing.animals.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < spacing.animals.length; secondIndex += 1) {
        const first = spacing.animals[firstIndex];
        const second = spacing.animals[secondIndex];
        if (!first || !second) throw new Error("missing spaced animals");
        expect(Math.hypot(second.x - first.x, second.z - first.z)).toBeGreaterThanOrEqual(
          P2_TUNING.minimumAnimalSeparation - 1e-3,
        );
      }
    }
  });

});
