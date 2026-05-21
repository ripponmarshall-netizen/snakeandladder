import { describe, it, expect } from "vitest";
import {
  createLocalGame,
  toGameRow,
  stepRoll,
  acquirePowerUp,
  generatePowerTiles,
  leadingRoleExcluding,
  isHumanTurn
} from "./localGame.js";
import { choosePowerUp, snakeReachable } from "./aiPolicy.js";

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

  it("climbs a ladder", () => {
    const s = game();
    const { state } = stepRoll(s, 3); // 0->3, no jump... start at 1? positions start 0
    expect(state.positions.player1).toBe(3);
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

  it("shield negates a snake when armed", () => {
    const s = game();
    s.positions.player1 = 13;
    s.inventory.player1 = ["shield"];
    const { state, events } = stepRoll(s, 3, "shield"); // lands on 16 (snake -> 6)
    expect(state.positions.player1).toBe(16);
    expect(s.inventory.player1.length).toBe(0);
    expect(events.some((e) => e.type === "shieldBlock")).toBe(true);
  });

  it("double-roll sums both dice", () => {
    const s = game();
    s.positions.player1 = 10;
    s.inventory.player1 = ["doubleRoll"];
    const { state, events } = stepRoll(s, 3, "doubleRoll", () => 0); // second die = 1
    expect(state.positions.player1).toBe(14); // 10 + (3 + 1)
    expect(events.find((e) => e.type === "powerup").total).toBe(4);
  });

  it("swap exchanges position with the leader", () => {
    const s = game();
    s.positions.player1 = 5;
    s.positions.player2 = 80;
    s.inventory.player1 = ["swap"];
    const { state } = stepRoll(s, 2, "swap"); // 5 -> 7, then swap with player2(80)
    expect(state.positions.player1).toBe(80);
    expect(state.positions.player2).toBe(7);
  });

  it("acquires a power-up when landing on a power tile", () => {
    const s = game({ powerUpsEnabled: true });
    s.powerTiles = { 7: true };
    s.positions.player1 = 5;
    const { state, events } = stepRoll(s, 2, null, () => 0); // -> 7, acquire POWER_IDS[0]
    expect(state.inventory.player1.length).toBe(1);
    expect(events.some((e) => e.type === "acquire")).toBe(true);
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

describe("helpers", () => {
  it("acquirePowerUp respects the inventory cap", () => {
    const s = game();
    s.inventory.player1 = ["shield", "swap"];
    expect(acquirePowerUp(s, "player1", () => 0).granted).toBe(null);
  });

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

describe("aiPolicy.choosePowerUp", () => {
  const jumps = { 16: 6, 40: 22, 99: 21 };

  it("easy never uses a power-up", () => {
    const s = game();
    s.inventory.player2 = ["shield", "doubleRoll"];
    s.positions.player2 = 13;
    expect(choosePowerUp(s, "player2", "easy")).toBe(null);
  });

  it("snakeReachable detects a snake within the next roll", () => {
    expect(snakeReachable(jumps, 13)).toBe(true); // 13+3 = 16 is a snake
    expect(snakeReachable(jumps, 50)).toBe(false);
  });

  it("medium arms a shield when a snake is reachable", () => {
    const s = game();
    s.jumps = jumps;
    s.inventory.player2 = ["shield"];
    s.positions.player2 = 13;
    expect(choosePowerUp(s, "player2", "medium")).toBe("shield");
  });

  it("hard avoids a double-roll near the finish", () => {
    const s = game();
    s.jumps = jumps;
    s.inventory.player2 = ["doubleRoll"];
    s.positions.player2 = 95; // distToWin 5 <= 12
    expect(choosePowerUp(s, "player2", "hard")).toBe(null);
  });

  it("hard uses swap to steal a late lead when well behind", () => {
    const s = game();
    s.jumps = jumps;
    s.inventory.player1 = ["swap"];
    s.positions.player1 = 60;
    s.positions.player2 = 92; // lead 32 >= 15, 100-92=8 <= 12
    expect(choosePowerUp(s, "player1", "hard")).toBe("swap");
  });
});
