import { describe, expect, it } from "vitest";
import { computeMidpointAt, resolveDrop } from "./albumShelfDrag";

describe("computeMidpointAt", () => {
  it("returns 1 for an empty list", () => {
    expect(computeMidpointAt([], 0)).toBe(1);
  });

  it("returns first/2 when inserting at the top", () => {
    expect(
      computeMidpointAt(
        [
          { id: "a", position: 1 },
          { id: "b", position: 2 },
        ],
        0,
      ),
    ).toBe(0.5);
  });

  it("returns last+1 when inserting at the bottom", () => {
    expect(
      computeMidpointAt(
        [
          { id: "a", position: 1 },
          { id: "b", position: 2 },
        ],
        2,
      ),
    ).toBe(3);
  });

  it("returns midpoint between adjacent items when inserting in the middle", () => {
    expect(
      computeMidpointAt(
        [
          { id: "a", position: 1 },
          { id: "b", position: 2 },
          { id: "c", position: 3 },
        ],
        1,
      ),
    ).toBe(1.5);
  });

  it("respects fractional positions", () => {
    expect(
      computeMidpointAt(
        [
          { id: "a", position: 1 },
          { id: "b", position: 1.5 },
        ],
        1,
      ),
    ).toBe(1.25);
  });
});

describe("resolveDrop", () => {
  const ordered = [
    { id: "ord-1", position: 1 },
    { id: "ord-2", position: 2 },
    { id: "ord-3", position: 3 },
  ];

  it("promotes a detected row dropped at the top of ordered", () => {
    const r = resolveDrop({
      ordered,
      detectedCount: 2,
      draggedId: "det-x",
      dropSlot: 0,
    });
    expect(r).toEqual({ kind: "ordered", nextPosition: 0.5 });
  });

  it("promotes a detected row dropped between ordered rows (midpoint)", () => {
    // Slot 1 = between ord-1 and ord-2 → midpoint of 1 and 2 = 1.5.
    const r = resolveDrop({
      ordered,
      detectedCount: 1,
      draggedId: "det-x",
      dropSlot: 1,
    });
    expect(r).toEqual({ kind: "ordered", nextPosition: 1.5 });
  });

  it("promotes a detected row dropped at the bottom of ordered (last + 1)", () => {
    // Slot 3 = after the last ordered row.
    const r = resolveDrop({
      ordered,
      detectedCount: 0,
      draggedId: "det-x",
      dropSlot: 3,
    });
    expect(r).toEqual({ kind: "ordered", nextPosition: 4 });
  });

  it("demotes an ordered row dropped onto the detected header slot", () => {
    // Slot 3 = position of detected header (right after the 3 ordered rows).
    const r = resolveDrop({
      ordered,
      detectedCount: 2,
      draggedId: "ord-2",
      dropSlot: 3,
    });
    expect(r).toEqual({ kind: "detected", nextPosition: null });
  });

  it("demotes an ordered row dropped inside the detected section", () => {
    // Slot 5 = between two detected rows.
    const r = resolveDrop({
      ordered,
      detectedCount: 3,
      draggedId: "ord-1",
      dropSlot: 5,
    });
    expect(r).toEqual({ kind: "detected", nextPosition: null });
  });

  it("returns noop when a detected row is dropped inside the detected section", () => {
    // Already detected, dropping in detected = no-op.
    const r = resolveDrop({
      ordered,
      detectedCount: 3,
      draggedId: "det-y",
      dropSlot: 5,
    });
    expect(r).toEqual({ kind: "noop" });
  });

  it("reorders within ordered: moving ord-3 to the top", () => {
    // Drop slot 0 → top of ordered. Without ord-3, ordered is [ord-1, ord-2].
    // Top insert → 0.5.
    const r = resolveDrop({
      ordered,
      detectedCount: 0,
      draggedId: "ord-3",
      dropSlot: 0,
    });
    expect(r).toEqual({ kind: "ordered", nextPosition: 0.5 });
  });

  it("reorders within ordered: moving ord-1 down past ord-2", () => {
    // Slot 2 = between ord-2 and ord-3 in pre-drag coords. Removing ord-1
    // shifts the slot up to 1 in post-removal coords. Post-removal ordered
    // is [ord-2, ord-3]; midpoint at index 1 = (2+3)/2 = 2.5.
    const r = resolveDrop({
      ordered,
      detectedCount: 0,
      draggedId: "ord-1",
      dropSlot: 2,
    });
    expect(r).toEqual({ kind: "ordered", nextPosition: 2.5 });
  });

  it("returns noop when an ordered row is dropped exactly at its current slot", () => {
    // ord-2 at slot 2 means "drop in the gap before ord-3", which after
    // removing ord-2 is the bottom of [ord-1, ord-3] → slot 1 in post-removal.
    // That gives midpoint of (1+3)/2 = 2 = ord-2's current position → noop.
    const r = resolveDrop({
      ordered,
      detectedCount: 0,
      draggedId: "ord-2",
      dropSlot: 2,
    });
    expect(r).toEqual({ kind: "noop" });
  });

  it("clamps over-large drop slots to the end of the list", () => {
    // Slot 999 should land at the bottom of the ordered band (no detected).
    const r = resolveDrop({
      ordered,
      detectedCount: 0,
      draggedId: "det-x",
      dropSlot: 999,
    });
    expect(r).toEqual({ kind: "ordered", nextPosition: 4 });
  });

  it("returns noop on an empty-ordered shelf when a detected row is dropped above the detected header", () => {
    // Layout has no "ordered band" to drop into; user is expected to use the
    // row menu's "Move to ordered" action. Drag remains a no-op.
    const r = resolveDrop({
      ordered: [],
      detectedCount: 3,
      draggedId: "det-x",
      dropSlot: 0,
    });
    expect(r).toEqual({ kind: "noop" });
  });
});
