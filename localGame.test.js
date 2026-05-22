import { describe, it, expect } from "vitest";
import {
  createLocalGame,
  toGameRow,
  stepRoll,
  generatePowerTiles,
  generateMysteryTiles,
  leadingRoleExcluding,
  isHumanTurn,
  POWER_UPS
} from "./localGame.js";

function game(extra) {
  return createLocalGame(Object.assign({
    boardId: "test",
    jumps: { 4: 14, 16: 6, 99: 21 },
    seats: [
      { name: "You", kind: "human" },
      { name: "CPU", kind: "cpu", difficulty: "medium" }
    ]
  }, extra || {}));
}

/* Deterministic rng that always returns v (used to force a tile/power outcome). */
function rngVal(v) {
  return function () { return v; };
}

const POWER_IDS = Object.keys(POWER_UPS); // [shield, doubleRoll, swap, extraRoll, freeze]

describe("toGameRow", () => {
  it("emits the currentGame shape with no power-up leakage", () => {
    const s = game();
    const row = toGameRow(s);
    expect(row.player1_position).toBe(0);
    expect(row.player2_position).toBe(0);
    expect(row.current_turn).toBe("player1");
    expect(row.winner).toBe(null);
    expect("inventory" in row).toBe(false);
    expect("powerTiles" in row).toBe(false);
    expect("seats" in row).toBe(false);
  });

  it("includes extra positions for 3-4 players", () => {
    const s = game({ seats: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }] });
    const row = toGameRow(s);
    expect(row.player3_position).toBe(0);
    expect(row.player4_position).toBe(0);
  });
});

describe("stepRoll", () => {
  it("advances normally and rotates the turn + version", () => {
    const s = game();
    const { state, events } = stepRoll(s, 3);
    expect(state.positions.player1).toBe(3);
    expect(state.current_turn).toBe("player2");
    expect(state.version).toBe(2);
    expect(events.find((e) => e.type === "move").to).toBe(3);
  });

  it("detects a winner on exactly 100 and does not rotate", () => {
    const s = game();
    s.positions.player1 = 97;
    const { state, events } = stepRoll(s, 3);
    expect(state.positions.player1).toBe(100);
    expect(state.winner).toBe("player1");
    expect(state.current_turn).toBe("player1");
    expect(events.some((e) => e.type === "win")).toBe(true);
  });

  it("a standing shield blocks the next snake, then clears", () => {
    const s = game();
    s.positions.player1 = 13;
    s.pending.player1 = { shield: true }; // gained earlier from a hidden tile
    const { state, events } = stepRoll(s, 3); // 13 -> 16 (snake -> 6), shield negates it
    expect(state.positions.player1).toBe(16);
    expect(s.pending.player1.shield).toBe(false);
    expect(events.some((e) => e.type === "shieldBlock")).toBe(true);
  });

  it("rotates through 3-4 players", () => {
    const s = game({ seats: [{ name: "A" }, { name: "B" }, { name: "C" }] });
    expect(stepRoll(s, 1).state.current_turn).toBe("player2");
    expect(stepRoll(s, 1).state.current_turn).toBe("player3");
    expect(stepRoll(s, 1).state.current_turn).toBe("player1");
  });

  it("bounces (stays put) on overshoot", () => {
    const s = game();
    s.positions.player1 = 98;
    const { state, events } = stepRoll(s, 5);
    expect(state.positions.player1).toBe(98);
    expect(events.some((e) => e.type === "bounce")).toBe(true);
  });
});

describe("instant power-up tiles", () => {
  it("applies a power-up instantly on landing (no inventory) + flags a reveal", () => {
    const s = game({ powerUpsEnabled: true });
    s.powerTiles = { 7: true };
    s.mysteryTiles = {};
    s.positions.player1 = 5;
    const { state, events } = stepRoll(s, 2, rngVal(0)); // -> 7, POWER_IDS[0] = shield
    expect("inventory" in state).toBe(false);
    const pu = events.find((e) => e.type === "powerup");
    expect(pu).toBeTruthy();
    expect(pu.id).toBe("shield");
    expect(pu.instant).toBe(true);
    // Shield is a standing protection set on the role.
    expect(state.pending.player1.shield).toBe(true);
    // The move carries a reveal descriptor for the UI.
    expect(state.lastMoves.player1.reveal).toEqual({ kind: "power", id: "shield" });
  });

  it("a Double Roll tile grants an extra turn", () => {
    const s = game({ powerUpsEnabled: true });
    s.powerTiles = { 7: true };
    s.mysteryTiles = {};
    s.positions.player1 = 5;
    const { state, events } = stepRoll(s, 2, rngVal(0.25)); // POWER_IDS[1] = doubleRoll
    expect(events.find((e) => e.type === "powerup").id).toBe("doubleRoll");
    expect(state.current_turn).toBe("player1"); // kept the turn
  });

  it("an Extra Roll tile grants an extra turn", () => {
    const s = game({ powerUpsEnabled: true });
    s.powerTiles = { 7: true };
    s.mysteryTiles = {};
    s.positions.player1 = 5;
    const { state } = stepRoll(s, 2, rngVal(0.7)); // POWER_IDS[3] = extraRoll
    expect(state.current_turn).toBe("player1");
  });

  it("a Swap tile exchanges position with the leader immediately", () => {
    const s = game();
    s.config.powerUpsEnabled = true;
    s.powerTiles = { 7: true };
    s.mysteryTiles = {};
    s.positions.player1 = 5;
    s.positions.player2 = 80;
    const { state, events } = stepRoll(s, 2, rngVal(0.5)); // -> 7, POWER_IDS[2] = swap
    expect(state.positions.player1).toBe(80);
    expect(state.positions.player2).toBe(7);
    const pu = events.find((e) => e.type === "powerup");
    expect(pu.id).toBe("swap");
    expect(pu.with).toBe("player2");
    // The swapped-in opponent gets a delayed relocate for the UI.
    expect(state.lastMoves.player2.relocate).toBe(true);
    expect(state.lastMoves.player2.delay).toBeGreaterThan(0);
  });

  it("a Freeze tile skips the leader's next turn (and clears the flag)", () => {
    const s = game({ seats: [{ name: "A" }, { name: "B" }, { name: "C" }] });
    s.config.powerUpsEnabled = true;
    s.powerTiles = { 7: true };
    s.mysteryTiles = {};
    s.positions.player1 = 5;
    s.positions.player2 = 50; // leader, and the next seat — so it's skipped right away
    const { state, events } = stepRoll(s, 2, rngVal(0.9)); // POWER_IDS[4] = freeze
    expect(events.find((e) => e.type === "powerup").id).toBe("freeze");
    expect(events.some((e) => e.type === "frozenSkip" && e.role === "player2")).toBe(true);
    expect(state.frozen.player2).toBe(false);
    expect(state.current_turn).toBe("player3");
  });
});

describe("mystery tiles", () => {
  it("mystery 'advance' moves the player forward", () => {
    const s = game({ powerUpsEnabled: true });
    s.powerTiles = {};
    s.mysteryTiles = { 7: true };
    s.positions.player1 = 5;
    const { state, events } = stepRoll(s, 2, rngVal(0)); // land 7, idx 0 = advance +4
    expect(state.positions.player1).toBe(11);
    expect(events.find((e) => e.type === "mystery").outcome.kind).toBe("advance");
    expect(state.lastMoves.player1.reveal.kind).toBe("mystery");
  });

  it("mystery 'extra' grants another turn", () => {
    const s = game({ powerUpsEnabled: true });
    s.powerTiles = {};
    s.mysteryTiles = { 7: true };
    s.positions.player1 = 5;
    const { state, events } = stepRoll(s, 2, rngVal(0.9)); // idx 3 = extra
    expect(events.find((e) => e.type === "mystery").outcome.kind).toBe("extra");
    expect(state.current_turn).toBe("player1");
  });

  it("mystery 'grant' applies an instant power + reveals it as that power", () => {
    const s = game({ powerUpsEnabled: true });
    s.powerTiles = {};
    s.mysteryTiles = { 7: true };
    s.positions.player1 = 5;
    const { state, events } = stepRoll(s, 2, rngVal(0.5)); // idx 2 = grant
    // grant fed the same rng -> POWER_IDS[2] = swap; no other seat ahead so no move.
    expect(events.some((e) => e.type === "powerup")).toBe(true);
    expect(state.lastMoves.player1.reveal).toEqual({ kind: "power", id: "swap" });
    expect("inventory" in state).toBe(false);
  });

  it("generateMysteryTiles avoids endpoints, jumps and power tiles", () => {
    const tiles = generateMysteryTiles({ 4: 14, 16: 6 }, () => 0.3, 3, { 50: true });
    expect(tiles[1]).toBeUndefined();
    expect(tiles[100]).toBeUndefined();
    expect(tiles[4]).toBeUndefined();
    expect(tiles[16]).toBeUndefined();
    expect(tiles[50]).toBeUndefined();
  });
});

describe("helpers", () => {
  it("generatePowerTiles avoids 1, 100 and jump squares", () => {
    const jumps = { 4: 14, 16: 6 };
    const tiles = generatePowerTiles(jumps, () => 0.5, 5);
    expect(tiles[1]).toBeUndefined();
    expect(tiles[100]).toBeUndefined();
    expect(tiles[4]).toBeUndefined();
    expect(tiles[16]).toBeUndefined();
  });

  it("leadingRoleExcluding finds the furthest other seat", () => {
    const s = game({ seats: [{ name: "A" }, { name: "B" }, { name: "C" }] });
    s.positions = { player1: 10, player2: 50, player3: 30 };
    expect(leadingRoleExcluding(s, "player1")).toBe("player2");
    expect(leadingRoleExcluding(s, "player2")).toBe("player3");
  });

  it("isHumanTurn reflects the active seat kind", () => {
    const s = game();
    expect(isHumanTurn(s)).toBe(true);
    s.current_turn = "player2";
    expect(isHumanTurn(s)).toBe(false);
  });
});
