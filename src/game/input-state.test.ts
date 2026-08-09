import { describe, expect, it } from "vitest";

import { PointerOwnership } from "./input-state";

describe("P1 pointer ownership", () => {
  it("never lets one pointer own two controls", () => {
    const ownership = new PointerOwnership();
    expect(ownership.claim("movement", 11)).toBe(true);
    expect(ownership.claim("camera", 11)).toBe(false);
    expect(ownership.ownerOf("movement")).toBe(11);
    expect(ownership.ownerOf("camera")).toBeNull();
    expect(ownership.rejectedClaims).toBe(1);
  });

  it("never replaces an active control owner", () => {
    const ownership = new PointerOwnership();
    expect(ownership.claim("camera", 21)).toBe(true);
    expect(ownership.claim("camera", 22)).toBe(false);
    expect(ownership.ownerOf("camera")).toBe(21);
  });

  it("releases only the matching owner", () => {
    const ownership = new PointerOwnership();
    ownership.claim("guidance", 31);
    expect(ownership.release("guidance", 32)).toBe(false);
    expect(ownership.release("guidance", 31)).toBe(true);
    expect(ownership.ownerOf("guidance")).toBeNull();
  });

  it("clears every pressed control idempotently", () => {
    const ownership = new PointerOwnership();
    ownership.claim("movement", 1);
    ownership.claim("camera", 2);
    ownership.claim("threat", 3);
    ownership.clear("orientation");
    ownership.clear("orientation");
    expect(ownership.hasAny()).toBe(false);
    expect(ownership.lastCancellationReason).toBe("orientation");
    expect(ownership.snapshot()).toEqual({
      movement: null,
      camera: null,
      guidance: null,
      threat: null,
    });
  });
});
