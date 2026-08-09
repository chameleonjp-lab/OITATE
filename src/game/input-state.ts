export type InputControl = "movement" | "camera" | "guidance" | "threat";

export type InputCancellationReason =
  | "pointercancel"
  | "lostpointercapture"
  | "visibility"
  | "orientation"
  | "signal-slide-out"
  | "blur"
  | "pagehide"
  | "manual-clear";

export interface PointerOwnershipSnapshot {
  movement: number | null;
  camera: number | null;
  guidance: number | null;
  threat: number | null;
}

const controls: readonly InputControl[] = [
  "movement",
  "camera",
  "guidance",
  "threat",
];

/**
 * Single-purpose ownership registry. Keeping this independent of DOM events
 * makes the one-finger-per-control rule straightforward to unit test.
 */
export class PointerOwnership {
  private readonly owners = new Map<InputControl, number>();
  private cancellationReason: InputCancellationReason | null = null;
  private rejectedClaimCount = 0;

  public claim(control: InputControl, pointerId: number): boolean {
    if (this.owners.has(control)) {
      this.rejectedClaimCount += 1;
      return false;
    }
    for (const [ownedControl, ownedPointer] of this.owners) {
      if (ownedPointer === pointerId && ownedControl !== control) {
        this.rejectedClaimCount += 1;
        return false;
      }
    }
    this.owners.set(control, pointerId);
    return true;
  }

  public release(control: InputControl, pointerId: number): boolean {
    if (this.owners.get(control) !== pointerId) return false;
    this.owners.delete(control);
    return true;
  }

  public cancel(reason: InputCancellationReason): void {
    this.cancellationReason = reason;
  }

  public clear(reason: InputCancellationReason): void {
    this.owners.clear();
    this.cancellationReason = reason;
  }

  public ownerOf(control: InputControl): number | null {
    return this.owners.get(control) ?? null;
  }

  public get lastCancellationReason(): InputCancellationReason | null {
    return this.cancellationReason;
  }

  public get rejectedClaims(): number {
    return this.rejectedClaimCount;
  }

  public snapshot(): PointerOwnershipSnapshot {
    return {
      movement: this.ownerOf("movement"),
      camera: this.ownerOf("camera"),
      guidance: this.ownerOf("guidance"),
      threat: this.ownerOf("threat"),
    };
  }

  public hasAny(): boolean {
    return controls.some((control) => this.owners.has(control));
  }
}
