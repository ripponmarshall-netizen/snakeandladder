/* Local (offline / vs-CPU / hot-seat) game engine. Pure: no DOM, no network —
   unit-tested like gameLogic.js. It owns the local match state and produces game
   rows in the EXACT shape app.js's render pipeline reads, so the entire existing
   animation/win pipeline is reused without changes. Power-ups, AI seats and 3-4
   players live here only; online "classic" mode never touches this module and so
   stays in lockstep with the server. */

import { resolveMoveWithPowerUps } from "./gameLogic.js";

export const ROLES = ["player1", "player2", "player3", "player4"];

/* Default per-seat token colours (seat 1..4). */
export const SEAT_COLORS = ["#3d8bff", "#ff5fa2", "#18c2a8", "#f5b430"];

export const POWER_UPS = {
  shield:     { id: "shield",     name: "Shield",      icon: "🛡️", desc: "Blocks the next snake you land on." },
  doubleRoll: { id: "doubleRoll", name: "Double Roll", icon: "🎲", desc: "Roll twice and move the total." },
  swap:       { id: "swap",       name: "Swap",        icon: "🔄", desc: "Swap places with the current leader." }
};

const POWER_IDS = Object.keys(POWER_UPS);
const INVENTORY_CAP = 2;
const DEFAULT_POWER_TILES = 8;

function rngOf(config) {
  return (config && config.rng) || Math.random;
}

/* Generate a set of power-up tiles, avoiding the start, the goal and any square
   that is the head/tail of a snake or ladder (so acquisition is unambiguous). */
export function generatePowerTiles(jumps, rng, count) {
  const random = rng || Math.random;
  const total = count || DEFAULT_POWER_TILES;
  const used = new Set([1, 100]);
  for (const k of Object.keys(jumps || {})) {
    used.add(Number(k));
    used.add(jumps[k]);
  }
  const tiles = {};
  let guard = 0;
  while (Object.keys(tiles).length < total && guard < 2000) {
    guard += 1;
    const sq = 2 + Math.floor(random() * 97); // 2..98
    if (used.has(sq) || tiles[sq]) continue;
    tiles[sq] = true;
  }
  return tiles;
}

/* Build a fresh local game. config:
   { boardId, jumps, seats:[{name,kind,difficulty,color,avatar}],
     powerUpsEnabled, turnTimer, rng } */
export function createLocalGame(config) {
  const cfg = config || {};
  const rng = rngOf(cfg);
  const seatsIn = cfg.seats && cfg.seats.length ? cfg.seats : [
    { name: "You", kind: "human" },
    { name: "Computer", kind: "cpu", difficulty: "medium" }
  ];

  const seats = seatsIn.slice(0, 4).map(function (s, i) {
    return {
      role: ROLES[i],
      idx: i + 1,
      name: s.name || ("Player " + (i + 1)),
      kind: s.kind || "human",
      difficulty: s.difficulty || "medium",
      color: s.color || SEAT_COLORS[i],
      avatar: s.avatar || null
    };
  });

  const positions = {};
  const inventory = {};
  const pending = {};
  seats.forEach(function (s) {
    positions[s.role] = 0;
    inventory[s.role] = [];
    pending[s.role] = {};
  });

  return {
    board_id: cfg.boardId,
    jumps: cfg.jumps || {},
    current_turn: seats[0].role,
    last_roll: null,
    winner: null,
    version: 1,
    positions: positions,
    seats: seats,
    inventory: inventory,
    pending: pending,
    powerTiles: cfg.powerUpsEnabled ? generatePowerTiles(cfg.jumps || {}, rng) : {},
    config: {
      playerCount: seats.length,
      powerUpsEnabled: !!cfg.powerUpsEnabled,
      turnTimer: cfg.turnTimer || 0
    },
    lastMoves: {}
  };
}

/* Adapter: produce the exact `currentGame` shape app.js reads. Power-up state is
   intentionally NOT included so the classic pipeline never sees it. */
export function toGameRow(state) {
  const row = {
    board_id: state.board_id,
    current_turn: state.current_turn,
    last_roll: state.last_roll,
    winner: state.winner,
    version: state.version
  };
  ROLES.forEach(function (role) {
    if (state.positions[role] !== undefined) {
      row[role + "_position"] = state.positions[role];
    }
  });
  if (row.player1_position === undefined) row.player1_position = 0;
  if (row.player2_position === undefined) row.player2_position = 0;
  return row;
}

export function isHumanTurn(state) {
  const seat = seatByRole(state, state.current_turn);
  return !state.winner && !!seat && seat.kind === "human";
}

export function seatByRole(state, role) {
  return state.seats.find(function (s) { return s.role === role; });
}

function nextRole(state) {
  const order = state.seats.map(function (s) { return s.role; });
  const idx = order.indexOf(state.current_turn);
  return order[(idx + 1) % order.length];
}

/* Highest-positioned seat other than `role` (ties resolve to the earliest seat). */
export function leadingRoleExcluding(state, role) {
  let best = null;
  let bestPos = -1;
  state.seats.forEach(function (s) {
    if (s.role === role) return;
    if (state.positions[s.role] > bestPos) {
      bestPos = state.positions[s.role];
      best = s.role;
    }
  });
  return best;
}

function consume(state, role, id) {
  const inv = state.inventory[role];
  const at = inv.indexOf(id);
  if (at >= 0) inv.splice(at, 1);
}

/* Grant a random power-up to a role (capped). Returns { granted: id|null }. */
export function acquirePowerUp(state, role, rng) {
  const random = rng || Math.random;
  const inv = state.inventory[role];
  if (inv.length >= INVENTORY_CAP) return { granted: null };
  const id = POWER_IDS[Math.floor(random() * POWER_IDS.length)];
  inv.push(id);
  return { granted: id };
}

/* Apply a single turn. `roll` (1..6) is injected so this stays deterministic for
   tests. `chosenPowerUp` is the id the current player armed (or null). Returns the
   mutated state plus an `events` list the UI uses to drive sound/log/FX. */
export function stepRoll(state, roll, chosenPowerUp, rng) {
  const random = rng || Math.random;
  const role = state.current_turn;
  const events = [];
  const fromPos = state.positions[role];
  const pending = state.pending[role] || {};
  state.pending[role] = pending;
  state.lastMoves = {};

  let effectiveRoll = roll;
  let usedSwap = false;

  if (chosenPowerUp && state.inventory[role].indexOf(chosenPowerUp) >= 0) {
    if (chosenPowerUp === "doubleRoll") {
      const second = 1 + Math.floor(random() * 6);
      effectiveRoll = roll + second;
      consume(state, role, "doubleRoll");
      events.push({ type: "powerup", id: "doubleRoll", role: role, rolls: [roll, second], total: effectiveRoll });
    } else if (chosenPowerUp === "shield") {
      pending.shield = true;
      consume(state, role, "shield");
      events.push({ type: "powerup", id: "shield", role: role });
    } else if (chosenPowerUp === "swap") {
      usedSwap = true;
      consume(state, role, "swap");
      events.push({ type: "powerup", id: "swap", role: role });
    }
  }

  state.last_roll = roll;

  const move = resolveMoveWithPowerUps(fromPos, effectiveRoll, state.jumps, { shield: pending.shield });

  if (move.shieldConsumed) {
    pending.shield = false;
    events.push({ type: "shieldBlock", role: role, at: move.landing });
  }

  if (move.bounced) {
    events.push({ type: "bounce", role: role, at: fromPos, roll: effectiveRoll });
  } else {
    state.positions[role] = move.newPos;
    state.lastMoves[role] = {
      landing: move.landing, newPos: move.newPos, jumpType: move.jumpType, bounced: false
    };
    events.push({
      type: "move", role: role, from: fromPos, landing: move.landing,
      to: move.newPos, jumpType: move.jumpType, roll: effectiveRoll
    });

    if (state.config.powerUpsEnabled && state.powerTiles[move.newPos] && move.newPos !== 100) {
      const granted = acquirePowerUp(state, role, random).granted;
      if (granted) events.push({ type: "acquire", role: role, id: granted, at: move.newPos });
    }
  }

  if (usedSwap && !move.bounced) {
    const leader = leadingRoleExcluding(state, role);
    if (leader && leader !== role) {
      const a = state.positions[role];
      const b = state.positions[leader];
      state.positions[role] = b;
      state.positions[leader] = a;
      state.lastMoves[role] = { relocate: true, from: a, to: b, newPos: b, jumpType: null, bounced: false };
      state.lastMoves[leader] = { relocate: true, from: b, to: a, newPos: a, jumpType: null, bounced: false };
      events.push({ type: "swap", role: role, with: leader });
    }
  }

  let winner = null;
  for (let i = 0; i < state.seats.length; i++) {
    const r = state.seats[i].role;
    if (state.positions[r] === 100) { winner = r; break; }
  }

  if (winner) {
    state.winner = winner;
    events.push({ type: "win", role: winner });
  } else {
    state.current_turn = nextRole(state);
  }

  state.version += 1;
  return { state: state, events: events };
}
