/* CPU decision policy for local mode. Snakes & Ladders is pure chance, so the
   only real decisions — and therefore the only place "difficulty" is meaningful —
   are which power-up to arm before a roll. Pure and unit-testable: it reads the
   local game state and returns a power-up id to arm (or null to just roll). */

import { leadingRoleExcluding } from "./localGame.js";

/* Is a snake reachable on the next roll (1..6) from `pos`? */
export function snakeReachable(jumps, pos) {
  for (let d = 1; d <= 6; d++) {
    const sq = pos + d;
    if (sq > 100) break;
    const dest = jumps[sq];
    if (dest !== undefined && dest < sq) return true;
  }
  return false;
}

export function choosePowerUp(state, role, difficulty) {
  const inv = state.inventory[role] || [];
  if (!inv.length || difficulty === "easy") return null;

  const has = function (id) { return inv.indexOf(id) >= 0; };
  const pos = state.positions[role];
  const distToWin = 100 - pos;

  if (difficulty === "hard") {
    // Steal the lead late when well behind.
    const leader = leadingRoleExcluding(state, role);
    if (has("swap") && leader) {
      const lead = state.positions[leader];
      if (lead - pos >= 15 && 100 - lead <= 12) return "swap";
    }
    // Guard against a snake we could land on next.
    if (has("shield") && snakeReachable(state.jumps, pos)) return "shield";
    // Push hard early, but never risk wasting a double near the finish.
    if (has("doubleRoll") && distToWin > 12) return "doubleRoll";
    return null;
  }

  // medium
  if (has("shield") && snakeReachable(state.jumps, pos)) return "shield";
  if (has("doubleRoll") && distToWin > 25) return "doubleRoll";
  return null;
}
