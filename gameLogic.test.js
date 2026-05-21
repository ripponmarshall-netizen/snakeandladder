import { describe, it, expect } from "vitest";
import {
  getCellNumber,
  getBoardPosition,
  isHorizontalJump,
  cellToSVG,
  resolveMove,
  resolveMoveWithPowerUps,
  validateBoardSet
} from "./gameLogic.js";
import { boards } from "./boards.js";

describe("board geometry", () => {
  it("numbers the bottom-left as 1 and top-left as 100", () => {
    expect(getCellNumber(9, 0)).toBe(1);
    expect(getCellNumber(0, 0)).toBe(100);
  });

  it("snakes left-to-right on the bottom row, right-to-left on the next", () => {
    expect(getCellNumber(9, 9)).toBe(10); // bottom row, rightmost
    expect(getCellNumber(8, 9)).toBe(11); // row above, rightmost continues upward
    expect(getCellNumber(8, 0)).toBe(20); // row above, leftmost
  });

  it("covers every square exactly once across the 10x10 grid", () => {
    const seen = new Set();
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        seen.add(getCellNumber(row, col));
      }
    }
    expect(seen.size).toBe(100);
    for (let n = 1; n <= 100; n++) expect(seen.has(n)).toBe(true);
  });

  it("getBoardPosition is the inverse of getCellNumber", () => {
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const square = getCellNumber(row, col);
        const pos = getBoardPosition(square);
        expect(pos.rowFromBottom).toBe(9 - row);
        expect(pos.col).toBe(col);
      }
    }
  });

  it("maps squares to centre points inside the 0..100 viewBox", () => {
    const start = cellToSVG(1);
    expect(start).toEqual({ x: 5, y: 95 });
    const end = cellToSVG(100);
    expect(end).toEqual({ x: 5, y: 5 });
  });
});

describe("resolveMove", () => {
  const jumps = { 4: 14, 16: 6, 99: 21 }; // ladder, snake, snake

  it("advances normally when no jump and no overshoot", () => {
    expect(resolveMove(10, 3, jumps)).toEqual({
      landing: 13, newPos: 13, jumpType: null, winner: false, bounced: false
    });
  });

  it("climbs a ladder", () => {
    expect(resolveMove(1, 3, jumps)).toEqual({
      landing: 4, newPos: 14, jumpType: "ladder", winner: false, bounced: false
    });
  });

  it("slides down a snake", () => {
    expect(resolveMove(13, 3, jumps)).toEqual({
      landing: 16, newPos: 6, jumpType: "snake", winner: false, bounced: false
    });
  });

  it("bounces (stays put) when the roll overshoots 100", () => {
    expect(resolveMove(98, 5, jumps)).toEqual({
      landing: 98, newPos: 98, jumpType: null, winner: false, bounced: true
    });
  });

  it("wins only by landing exactly on 100", () => {
    expect(resolveMove(97, 3, jumps)).toEqual({
      landing: 100, newPos: 100, jumpType: null, winner: true, bounced: false
    });
    expect(resolveMove(95, 6, jumps).bounced).toBe(true); // 101 overshoots
  });

  it("accepts numeric keys against string-keyed jump maps (object literal keys are strings)", () => {
    const literal = { 4: 14 };
    expect(resolveMove(1, 3, literal).newPos).toBe(14);
  });
});

describe("resolveMoveWithPowerUps", () => {
  const jumps = { 4: 14, 16: 6, 99: 21 }; // ladder, snake, snake

  it("negates a snake when shielded (stays on the landing square)", () => {
    const move = resolveMoveWithPowerUps(13, 3, jumps, { shield: true });
    expect(move.newPos).toBe(16);
    expect(move.jumpType).toBe(null);
    expect(move.shieldConsumed).toBe(true);
  });

  it("is a no-op when there is no snake to block", () => {
    const move = resolveMoveWithPowerUps(10, 3, jumps, { shield: true });
    expect(move.newPos).toBe(13);
    expect(move.shieldConsumed).toBe(false);
  });

  it("still climbs ladders normally with a shield held", () => {
    const move = resolveMoveWithPowerUps(1, 3, jumps, { shield: true });
    expect(move.newPos).toBe(14);
    expect(move.jumpType).toBe("ladder");
  });

  it("is shape-compatible with resolveMove when no effects apply", () => {
    const move = resolveMoveWithPowerUps(10, 3, jumps, {});
    expect(move).toEqual({
      landing: 13, newPos: 13, jumpType: null, winner: false, bounced: false, shieldConsumed: false
    });
  });
});

describe("validateBoardSet", () => {
  it("accepts the shipped boards", () => {
    expect(() => validateBoardSet(boards)).not.toThrow();
  });

  it("rejects out-of-range jumps", () => {
    expect(() => validateBoardSet([{ id: "x", jumps: { 0: 5 } }])).toThrow(/out of range/);
    expect(() => validateBoardSet([{ id: "x", jumps: { 5: 101 } }])).toThrow(/out of range/);
  });

  it("rejects self jumps", () => {
    expect(() => validateBoardSet([{ id: "x", jumps: { 5: 5 } }])).toThrow(/self jump/);
  });

  it("rejects horizontal jumps (same row)", () => {
    // 2 and 9 are on the same bottom row -> horizontal, not allowed
    expect(() => validateBoardSet([{ id: "x", jumps: { 2: 9 } }])).toThrow(/horizontal/);
  });
});
