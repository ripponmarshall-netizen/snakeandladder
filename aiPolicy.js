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

  const leader = leadingRoleExcluding(state, role);
  const leadPos = leader ? state.positions[leader] : 0;

  if (difficulty === "hard") {
    // Guard against a snake we could land on next.
    if (has("shield") && snakeReachable(state.jumps, pos)) return "shield";
    // Steal the lead late when well behind.
    if (has("swap") && leader && leadPos - pos >= 15 && 100 - leadPos <= 12) return "swap";
    // Freeze a leader who's about to win.
    if (has("freeze") && leader && leadPos > pos && 100 - leadPos <= 12) return "freeze";
    // A free extra turn is almost always good (skip only right at the finish).
    if (has("extraRoll") && distToWin > 1) return "extraRoll";
    // Push hard early, but never risk wasting a double near the finish.
    if (has("doubleRoll") && distToWin > 12) return "doubleRoll";
    return null;
  }

  // medium
  if (has("shield") && snakeReachable(state.jumps, pos)) return "shield";
  if (has("extraRoll") && distToWin > 6) return "extraRoll";
  if (has("freeze") && leader && leadPos > pos && 100 - leadPos <= 10) return "freeze";
  if (has("doubleRoll") && distToWin > 25) return "doubleRoll";
  return null;
}
