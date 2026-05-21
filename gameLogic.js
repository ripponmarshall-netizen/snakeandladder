/* Pure game logic — no DOM, no network. Shared by the app (app.js) and the
   unit tests, and a 1:1 mirror of the server-side roll_dice() SQL so the two
   stay in lockstep. Keep this module dependency-free. */

/* Board geometry — squares are numbered 1..100 in boustrophedon (serpentine)
   order, bottom-left to top, alternating direction each row. */

export function getCellNumber(rowFromTop, col) {
  const rowFromBottom = 9 - rowFromTop;
  const rowStart = rowFromBottom * 10 + 1;
  return rowFromBottom % 2 === 0 ? rowStart + col : rowStart + (9 - col);
}

export function getBoardPosition(square) {
  const zeroBased = square - 1;
  const rowFromBottom = Math.floor(zeroBased / 10);
  const colInRow = zeroBased % 10;
  const col = rowFromBottom % 2 === 0 ? colInRow : 9 - colInRow;
  return { rowFromBottom, col };
}

export function isHorizontalJump(from, to) {
  return getBoardPosition(from).rowFromBottom === getBoardPosition(to).rowFromBottom;
}

/* Centre point of a square in the 0..100 SVG viewBox coordinate space. */
export function cellToSVG(square) {
  const pos = getBoardPosition(square);
  const rowFromTop = 9 - pos.rowFromBottom;
  return { x: (pos.col + 0.5) * 10, y: (rowFromTop + 0.5) * 10 };
}

/* Resolve a single move. MUST match the server roll_dice() logic exactly.
   - Overshooting 100 bounces (the player stays put).
   - Otherwise a snake/ladder at the landing square teleports the player.
   Returns `landing` (pre-jump square) so the UI can animate the hop then the
   slide separately. */
export function resolveMove(pos, roll, jumps) {
  const raw = pos + roll;

  if (raw > 100) {
    return { landing: pos, newPos: pos, jumpType: null, winner: false, bounced: true };
  }

  const dest = jumps[raw];
  if (dest !== undefined) {
    return {
      landing: raw,
      newPos: dest,
      jumpType: dest > raw ? "ladder" : "snake",
      winner: dest === 100,
      bounced: false
    };
  }

  return { landing: raw, newPos: raw, jumpType: null, winner: raw === 100, bounced: false };
}

/* Resolve a move with power-up effects applied. Wraps resolveMove so the base
   rules stay identical (and online untouched). `roll` is the FINAL amount — the
   double-roll power-up sums the two dice in localGame before calling here.
   - effects.shield: negate the next snake (stay on the landing square).
   Returns a resolveMove-compatible object plus a `shieldConsumed` flag. */
export function resolveMoveWithPowerUps(pos, roll, jumps, effects) {
  const base = resolveMove(pos, roll, jumps);
  const fx = effects || {};

  if (fx.shield && base.jumpType === "snake") {
    return {
      landing: base.landing,
      newPos: base.landing,
      jumpType: null,
      winner: base.landing === 100,
      bounced: false,
      shieldConsumed: true
    };
  }

  return {
    landing: base.landing,
    newPos: base.newPos,
    jumpType: base.jumpType,
    winner: base.winner,
    bounced: base.bounced,
    shieldConsumed: false
  };
}

/* Validate a set of boards. Throws on the first invalid jump. Pure: the caller
   passes the boards in so this module stays dependency-free. */
export function validateBoardSet(boards) {
  for (const board of boards) {
    for (const [fromRaw, to] of Object.entries(board.jumps)) {
      const from = Number(fromRaw);
      if (from < 1 || from > 100 || to < 1 || to > 100) {
        throw new Error("Board " + board.id + ": jump out of range " + from + " -> " + to);
      }
      if (from === to) {
        throw new Error("Board " + board.id + ": self jump " + from + " -> " + to);
      }
      if (isHorizontalJump(from, to)) {
        throw new Error("Board " + board.id + ": horizontal jump " + from + " -> " + to + " is not allowed");
      }
    }
  }
}
