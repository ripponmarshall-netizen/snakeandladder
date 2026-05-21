import { boards } from "./boards.js";
import { supabase, ensureSignedIn, getCurrentUser } from "./supabase.js";
import { getCellNumber, cellToSVG, resolveMove, validateBoardSet } from "./gameLogic.js";
import * as localGame from "./localGame.js";
import * as aiPolicy from "./aiPolicy.js";
import * as theme from "./theme.js";
import * as stats from "./stats.js";
import * as dice3d from "./dice3d.js";
import * as sfx from "./sound.js";
import * as haptics from "./haptics.js";
import * as confetti from "./confetti.js";

/* ── DOM refs ── */

const boardEl = document.getElementById("board");
const authStatusEl = document.getElementById("authStatus");
const playerNameInput = document.getElementById("playerName");
const roomCodeInput = document.getElementById("roomCodeInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const onlineMaxPlayersEl = document.getElementById("onlineMaxPlayers");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const refreshRoomBtn = document.getElementById("refreshRoomBtn");
const rollDiceBtn = document.getElementById("rollDiceBtn");
const logEl = document.getElementById("log");

const lobbyEl = document.getElementById("lobby");
const gameScreenEl = document.getElementById("gameScreen");
const roomCodeDisplayEl = document.getElementById("roomCodeDisplay");
const boardNameEl = document.getElementById("boardName");

const turnBannerEl = document.getElementById("turnBanner");
const turnTextEl = document.getElementById("turnText");

const diceEl = document.getElementById("dice");
const diceCharEl = document.getElementById("diceChar");
const lastActionEl = document.getElementById("lastAction");

const actionToastEl = document.getElementById("actionToast");
const toastTextEl = document.getElementById("toastText");

const winOverlayEl = document.getElementById("winOverlay");
const winTitleEl = document.getElementById("winTitle");
const winMessageEl = document.getElementById("winMessage");
const rematchBtn = document.getElementById("rematchBtn");
const leaveBtn = document.getElementById("leaveBtn");
const copyCodeBtn = document.getElementById("copyCodeBtn");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");
const muteBtn = document.getElementById("muteBtn");

const diceCubeEl = document.getElementById("diceCube");
const playerStripEl = document.getElementById("playerStrip");
const localStripEl = document.getElementById("localStrip");
const turnTimerEl = document.getElementById("turnTimer");
const turnTimerBarEl = document.getElementById("turnTimerBar");
const emoteBarEl = document.getElementById("emoteBar");
const powerTrayEl = document.getElementById("powerTray");

const avatarPickEl = document.getElementById("avatarPick");
const diceSkinPickEl = document.getElementById("diceSkinPick");
const localPlayBtn = document.getElementById("localPlayBtn");
const themeBtn = document.getElementById("themeBtn");
const themeBtnGame = document.getElementById("themeBtnGame");
const statsBtn = document.getElementById("statsBtn");

const localSetupEl = document.getElementById("localSetup");
const lsPlayersEl = document.getElementById("lsPlayers");
const lsSeatsEl = document.getElementById("lsSeats");
const lsBoardEl = document.getElementById("lsBoard");
const lsPowerUpsEl = document.getElementById("lsPowerUps");
const lsTimerEl = document.getElementById("lsTimer");
const lsStartBtn = document.getElementById("lsStartBtn");
const lsCancelBtn = document.getElementById("lsCancelBtn");

const statsOverlayEl = document.getElementById("statsOverlay");
const statsBodyEl = document.getElementById("statsBody");
const statsCloseBtn = document.getElementById("statsCloseBtn");
const statsClearBtn = document.getElementById("statsClearBtn");

/* ── State ── */

let currentUser = null;
let currentRoom = null;
let currentMembership = null;
let currentGame = null;
let currentPlayers = [];
let realtimeChannel = null;
let toastTimer = null;
let prevPositions = {};
let animateMoves = false;
let presenceState = {};
let opponentOnline = false;
let winCelebrated = false;

/* ── Mode + local game state ── */
let gameMode = "online"; // "online" | "local"
let localState = null;
let armedPowerUp = null;
let busyAnimating = false;
let pendingAnims = 0;
let myAvatar = { color: null, emoji: null };
let turnTimerHandle = null;
let diceRolling = false;
let pendingVictory = null; // winner seat whose victory-run is animating (overlay deferred)

const AI_THINK_MS = 850;
const DEFAULT_SEAT_COLORS = ["#3d8bff", "#ff5fa2", "#18c2a8", "#f5b430"];
const AVATAR_EMOJIS = ["🐱", "🐶", "🦊", "🐼", "🚀", "⭐"];
const EMOTES = ["👍", "😂", "😮", "🎉", "😭", "🔥"];
const DICE_SKINS = [
  { id: "classic", name: "Classic" },
  { id: "gold", name: "Gold" },
  { id: "neon", name: "Neon" },
  { id: "wood", name: "Wood" }
];
let myDiceSkin = "classic";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function raf() {
  return new Promise(function (r) { requestAnimationFrame(r); });
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

const DICE_FACES = ["", "\u2680", "\u2681", "\u2682", "\u2683", "\u2684", "\u2685"];

/* Board geometry (getCellNumber, cellToSVG), jump resolution (resolveMove), and
   validation (validateBoardSet) live in gameLogic.js — imported above — so they
   are unit-tested and mirror the server-side roll_dice() RPC. */

/* ── SVG overlay ── */

/* ── [SNAKE VISUALS] Enhanced SVG snake with layered texture and depth ── */

function drawSnake(svg, start, end, NS) {
  /* Path calculation — UNCHANGED from original */
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const px = -dy / dist;
  const py = dx / dist;
  const segments = 4;
  const amp = Math.min(3.5, dist * 0.1);

  let d = "M " + start.x.toFixed(1) + " " + start.y.toFixed(1);
  for (let i = 0; i < segments; i++) {
    const t1 = (i + 0.5) / segments;
    const t2 = (i + 1) / segments;
    const sign = i % 2 === 0 ? 1 : -1;
    const cpx = start.x + dx * t1 + px * amp * sign;
    const cpy = start.y + dy * t1 + py * amp * sign;
    const ex = start.x + dx * t2;
    const ey = start.y + dy * t2;
    d += " Q " + cpx.toFixed(1) + " " + cpy.toFixed(1) + " " + ex.toFixed(1) + " " + ey.toFixed(1);
  }
  /* --- End unchanged path calculation --- */

  /* [SNAKE TEXTURE] Layered body group — bolder, palette-driven */
  const g = document.createElementNS(NS, "g");

  /* Soft shadow — adds depth behind the body */
  const shadow = document.createElementNS(NS, "path");
  shadow.setAttribute("d", d);
  shadow.setAttribute("style", "stroke: var(--ink)");
  shadow.setAttribute("stroke-width", "3.4");
  shadow.setAttribute("fill", "none");
  shadow.setAttribute("opacity", "0.1");
  shadow.setAttribute("stroke-linecap", "round");
  g.appendChild(shadow);

  /* Main body stroke */
  const body = document.createElementNS(NS, "path");
  body.setAttribute("d", d);
  body.setAttribute("style", "stroke: var(--red)");
  body.setAttribute("stroke-width", "2.6");
  body.setAttribute("fill", "none");
  body.setAttribute("opacity", "0.9");
  body.setAttribute("stroke-linecap", "round");
  g.appendChild(body);

  /* Scale pattern — dashed overlay for patterning */
  const scales = document.createElementNS(NS, "path");
  scales.setAttribute("d", d);
  scales.setAttribute("stroke", "#fff");
  scales.setAttribute("stroke-width", "1.0");
  scales.setAttribute("fill", "none");
  scales.setAttribute("opacity", "0.35");
  scales.setAttribute("stroke-linecap", "round");
  scales.setAttribute("stroke-dasharray", "1.2 2.8");
  g.appendChild(scales);

  /* Highlight — lighter contour line */
  const hl = document.createElementNS(NS, "path");
  hl.setAttribute("d", d);
  hl.setAttribute("stroke", "#ffd1d6");
  hl.setAttribute("stroke-width", "0.6");
  hl.setAttribute("fill", "none");
  hl.setAttribute("opacity", "0.5");
  hl.setAttribute("stroke-linecap", "round");
  g.appendChild(hl);

  svg.appendChild(g);

  /* [SNAKE HEAD] bold head with shadow, highlight, and a little eye */
  const headG = document.createElementNS(NS, "g");

  const headShadow = document.createElementNS(NS, "circle");
  headShadow.setAttribute("cx", (start.x + 0.3).toFixed(1));
  headShadow.setAttribute("cy", (start.y + 0.3).toFixed(1));
  headShadow.setAttribute("r", "2.3");
  headShadow.setAttribute("style", "fill: var(--ink)");
  headShadow.setAttribute("opacity", "0.15");
  headG.appendChild(headShadow);

  const head = document.createElementNS(NS, "circle");
  head.setAttribute("cx", start.x.toFixed(1));
  head.setAttribute("cy", start.y.toFixed(1));
  head.setAttribute("r", "2.1");
  head.setAttribute("style", "fill: var(--red)");
  head.setAttribute("opacity", "0.95");
  headG.appendChild(head);

  /* Eye — white sclera + dark pupil for character */
  const eye = document.createElementNS(NS, "circle");
  eye.setAttribute("cx", (start.x - 0.5).toFixed(1));
  eye.setAttribute("cy", (start.y - 0.6).toFixed(1));
  eye.setAttribute("r", "0.7");
  eye.setAttribute("fill", "#fff");
  headG.appendChild(eye);

  const pupil = document.createElementNS(NS, "circle");
  pupil.setAttribute("cx", (start.x - 0.4).toFixed(1));
  pupil.setAttribute("cy", (start.y - 0.5).toFixed(1));
  pupil.setAttribute("r", "0.32");
  pupil.setAttribute("style", "fill: var(--ink)");
  headG.appendChild(pupil);

  svg.appendChild(headG);

  /* Tail taper */
  const tail = document.createElementNS(NS, "circle");
  tail.setAttribute("cx", end.x.toFixed(1));
  tail.setAttribute("cy", end.y.toFixed(1));
  tail.setAttribute("r", "0.9");
  tail.setAttribute("style", "fill: var(--red)");
  tail.setAttribute("opacity", "0.6");
  svg.appendChild(tail);
}

function drawLadder(svg, start, end, NS) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const px = -dy / dist;
  const py = dx / dist;
  const off = 1.4;

  const g = document.createElementNS(NS, "g");
  g.setAttribute("opacity", "0.9");

  for (let s = -1; s <= 1; s += 2) {
    const rail = document.createElementNS(NS, "line");
    rail.setAttribute("x1", (start.x + px * off * s).toFixed(1));
    rail.setAttribute("y1", (start.y + py * off * s).toFixed(1));
    rail.setAttribute("x2", (end.x + px * off * s).toFixed(1));
    rail.setAttribute("y2", (end.y + py * off * s).toFixed(1));
    rail.setAttribute("style", "stroke: var(--teal)");
    rail.setAttribute("stroke-width", "1.3");
    rail.setAttribute("stroke-linecap", "round");
    g.appendChild(rail);

    /* Highlight line for a rounded 3D rail look */
    const railHL = document.createElementNS(NS, "line");
    railHL.setAttribute("x1", (start.x + px * off * s - 0.3).toFixed(1));
    railHL.setAttribute("y1", (start.y + py * off * s - 0.3).toFixed(1));
    railHL.setAttribute("x2", (end.x + px * off * s - 0.3).toFixed(1));
    railHL.setAttribute("y2", (end.y + py * off * s - 0.3).toFixed(1));
    railHL.setAttribute("stroke", "#bdf5e8");
    railHL.setAttribute("stroke-width", "0.5");
    railHL.setAttribute("stroke-linecap", "round");
    railHL.setAttribute("opacity", "0.8");
    g.appendChild(railHL);
  }

  const rungs = Math.max(2, Math.round(dist / 7));
  for (let i = 1; i < rungs; i++) {
    const t = i / rungs;
    const rx = start.x + dx * t;
    const ry = start.y + dy * t;
    const rung = document.createElementNS(NS, "line");
    rung.setAttribute("x1", (rx + px * off).toFixed(1));
    rung.setAttribute("y1", (ry + py * off).toFixed(1));
    rung.setAttribute("x2", (rx - px * off).toFixed(1));
    rung.setAttribute("y2", (ry - py * off).toFixed(1));
    rung.setAttribute("style", "stroke: var(--teal)");
    rung.setAttribute("stroke-width", "1.0");
    rung.setAttribute("stroke-linecap", "round");
    g.appendChild(rung);
  }

  svg.appendChild(g);
}

function renderOverlay() {
  const existing = boardEl.querySelector(".board-overlay");
  if (existing) existing.remove();

  const board = findBoardById(currentGame?.board_id ?? boards[0].id);
  const jumps = board.jumps;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "board-overlay");
  svg.setAttribute("viewBox", "0 0 100 100");

  for (const [fromStr, to] of Object.entries(jumps)) {
    const from = Number(fromStr);
    const isLadder = to > from;
    const s = cellToSVG(from);
    const e = cellToSVG(to);

    if (isLadder) {
      drawLadder(svg, s, e, NS);
    } else {
      drawSnake(svg, s, e, NS);
    }
  }

  boardEl.appendChild(svg);
}

/* ── Utilities ── */

function logMessage(message) {
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = message;
  logEl.prepend(entry);
}

/* Dice rolls, room codes, and board selection are generated server-side
   (roll_dice / create_room RPCs), so no client-side RNG is needed. */

function findBoardById(boardId) {
  return boards.find(function (b) { return b.id === boardId; }) ?? boards[0];
}

function setButtonsDisabled(disabled) {
  createRoomBtn.disabled = disabled;
  joinRoomBtn.disabled = disabled;
  refreshRoomBtn.disabled = disabled;
}

/* ── UI helpers ── */

function showGameScreen() {
  lobbyEl.classList.add("hidden");
  gameScreenEl.classList.remove("hidden");
}

function showToast(msg) {
  if (toastTimer) clearTimeout(toastTimer);
  toastTextEl.textContent = msg;
  actionToastEl.classList.remove("hidden");
  toastTimer = setTimeout(function () {
    actionToastEl.classList.add("hidden");
  }, 3500);
}

/* Non-blocking error feedback. In the lobby there is no toast, so surface the
   message on the status line; in-game use the toast. */
function showLobbyError(msg) {
  authStatusEl.textContent = msg;
  authStatusEl.classList.add("error");
}

function notifyError(msg) {
  if (!gameScreenEl.classList.contains("hidden")) {
    showToast(msg);
  } else {
    showLobbyError(msg);
  }
}

/* Pull a human-readable message out of a Supabase/PostgREST error. RAISE
   EXCEPTION text from the RPCs (e.g. "Not your turn") arrives in .message. */
function errorMessage(error, fallback) {
  if (!error) return fallback || "Something went wrong.";
  return error.message || error.hint || error.details || fallback || "Something went wrong.";
}

/* Update the displayed dice value: the 3D cube face plus the screen-reader glyph
   (the glyph also becomes the visible fallback under prefers-reduced-motion). */
function setDiceFace(value) {
  diceCharEl.textContent = value ? String(value) : "?";
  dice3d.setFace(value || 1);
}

/* Animate a roll — the 3D cube spins and settles on `value`. Under reduced motion
   the cube is hidden via CSS and the numeric glyph is shown instead. */
function animateDice(value) {
  diceEl.classList.remove("rolling");
  void diceEl.offsetWidth;
  diceEl.classList.add("rolling");
  diceCharEl.textContent = value ? String(value) : "?";

  if (reducedMotion()) {
    dice3d.setFace(value || 1);
    return;
  }
  sfx.playRoll();
  diceRolling = true;
  dice3d.roll(value || 1);
  setTimeout(function () { diceRolling = false; }, 700);
}

/* Quick rattle for immediate feedback while the server resolves the roll; the
   real tumble takes over once the authoritative value arrives. */
function shakeDice() {
  diceEl.classList.remove("rolling");
  void diceEl.offsetWidth;
  diceEl.classList.add("rolling");
}

/* ═══════════════════════════════════════════════════════
   [PIECE HOP ANIMATION] Token movement system
   Handles tile-to-tile hops, ladder climbs, snake descents.
   Pure visual layer — zero game logic changes.
   ═══════════════════════════════════════════════════════ */

let activeGhost = null;

/* Get a square's pixel position relative to .board-frame */
function getSquareTokenPos(square) {
  const cell = boardEl.querySelector("[data-square='" + square + "']");
  if (!cell) return null;
  const frameEl = boardEl.closest(".board-frame");
  if (!frameEl) return null;
  const cr = cell.getBoundingClientRect();
  const fr = frameEl.getBoundingClientRect();
  const size = activeGhost ? (activeGhost.offsetWidth || 14) : 14;
  return {
    left: cr.left - fr.left + (cr.width - size) / 2,
    top: cr.top - fr.top + (cr.height - size) / 2
  };
}

/* Animate a hop with a subtle vertical arc (physical, not springy) */
function hopTo(el, targetLeft, targetTop, duration) {
  return new Promise(function (resolve) {
    const startLeft = parseFloat(el.style.left) || 0;
    const startTop = parseFloat(el.style.top) || 0;
    const dLeft = targetLeft - startLeft;
    const dTop = targetTop - startTop;
    const startTime = performance.now();

    function frame(now) {
      const t = Math.min((now - startTime) / duration, 1);
      /* Cubic ease-out for controlled deceleration */
      const ease = 1 - Math.pow(1 - t, 3);
      /* Parabolic arc: peaks at midpoint, ~11px height for a livelier hop */
      const lift = Math.sin(t * Math.PI);
      const arc = -11 * lift;
      /* Squash-and-stretch: stretched at apex, squashed on the ground */
      const sx = 1 - 0.12 * lift;
      const sy = 1 + 0.16 * lift;

      el.style.left = (startLeft + dLeft * ease) + "px";
      el.style.top = (startTop + dTop * ease + arc) + "px";
      el.style.transform = "scale(" + sx.toFixed(3) + "," + sy.toFixed(3) + ")";

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        el.style.left = targetLeft + "px";
        el.style.top = targetTop + "px";
        el.style.transform = "scale(1)";
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

/* [LADDER/SNAKE TRAVERSAL] Smooth slide with a scale pulse. `wobble` adds a
   lateral sway for the slithery snake descent. */
function slideTo(el, targetLeft, targetTop, duration, wobble) {
  return new Promise(function (resolve) {
    const startLeft = parseFloat(el.style.left) || 0;
    const startTop = parseFloat(el.style.top) || 0;
    const dLeft = targetLeft - startLeft;
    const dTop = targetTop - startTop;
    const sway = wobble ? 9 : 0;
    const startTime = performance.now();

    function frame(now) {
      const t = Math.min((now - startTime) / duration, 1);
      /* Quartic ease-out: fast start, smooth settle */
      const ease = 1 - Math.pow(1 - t, 4);
      /* Gentle scale pulse during traversal */
      const scale = 1 + 0.16 * Math.sin(t * Math.PI);
      /* Lateral sway fades out as the slide settles */
      const wob = sway * Math.sin(t * Math.PI * 3) * (1 - t);

      el.style.left = (startLeft + dLeft * ease + wob) + "px";
      el.style.top = (startTop + dTop * ease) + "px";
      el.style.transform = "scale(" + scale.toFixed(3) + ")";

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        el.style.left = targetLeft + "px";
        el.style.top = targetTop + "px";
        el.style.transform = "scale(1)";
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

function hideRealToken(square, idx) {
  const cell = boardEl.querySelector("[data-square='" + square + "']");
  if (!cell) return;
  const token = cell.querySelector(".token.seat-" + idx);
  if (token) token.style.opacity = "0";
}

function showRealToken(square, idx) {
  const cell = boardEl.querySelector("[data-square='" + square + "']");
  if (!cell) return;
  const token = cell.querySelector(".token.seat-" + idx);
  if (token) {
    token.style.opacity = "1";
    /* Re-trigger landing bounce for satisfying arrival */
    token.classList.remove("bounce");
    void token.offsetWidth;
    token.classList.add("bounce");
  }
}

/* [SCREEN SHAKE] A short jolt on the board frame, e.g. when a snake bites. */
function triggerShake() {
  if (reducedMotion()) return;
  const frame = boardEl.closest(".board-frame");
  if (!frame) return;
  frame.classList.remove("shake");
  void frame.offsetWidth;
  frame.classList.add("shake");
}

/* [PARTICLE TRAIL] A small puff at the ghost token's current screen position. */
function emitTrail(ghost, color) {
  const r = ghost.getBoundingClientRect();
  confetti.trail(r.left + r.width / 2, r.top + r.height / 2, color);
}

function makeGhost(frameEl, seat) {
  const ghost = document.createElement("div");
  ghost.className = "ghost-token seat-" + seat.idx;
  ghost.style.setProperty("--tok", seat.color || DEFAULT_SEAT_COLORS[seat.idx - 1]);
  if (seat.emoji) {
    ghost.classList.add("token-emoji");
    ghost.textContent = seat.emoji;
  }
  frameEl.appendChild(ghost);
  return ghost;
}

/* Animate a token from `fromSquare` to `toSquare`. `move` is the resolved move
   (resolveMove-shaped, optionally { relocate:true } for a power-up swap). */
async function animateTokenMove(fromSquare, toSquare, seat, move) {
  const idx = seat.idx;
  const winnerRole = currentGame?.winner;
  const isWinningMove = winnerRole === seat.role && toSquare === 100 && !move.bounced;

  if (reducedMotion()) {
    showRealToken(toSquare, idx);
    if (isWinningMove) revealWin(seat);
    return;
  }
  if (winnerRole && !isWinningMove) { showRealToken(toSquare, idx); return; }

  if (activeGhost) { activeGhost.remove(); activeGhost = null; }

  const frameEl = boardEl.closest(".board-frame");
  if (!frameEl) { showRealToken(toSquare, idx); if (isWinningMove) revealWin(seat); return; }

  const ghost = makeGhost(frameEl, seat);
  activeGhost = ghost;

  const startPos = getSquareTokenPos(fromSquare);
  if (!startPos) {
    ghost.remove();
    activeGhost = null;
    showRealToken(toSquare, idx);
    if (isWinningMove) revealWin(seat);
    return;
  }
  ghost.style.left = startPos.left + "px";
  ghost.style.top = startPos.top + "px";

  await raf();
  if (activeGhost !== ghost) { if (isWinningMove) revealWin(seat); return; }

  /* [VICTORY RUN] Dramatic slow-motion dash to 100, then a big splash. */
  if (isWinningMove) {
    await animateVictoryRun(fromSquare, ghost, seat);
    if (activeGhost === ghost) { ghost.remove(); activeGhost = null; }
    showRealToken(toSquare, idx);
    revealWin(seat);
    return;
  }

  /* [SWAP] Direct slide to the destination — no tile-by-tile hops. */
  if (move.relocate) {
    const tgt = getSquareTokenPos(toSquare);
    if (tgt) await slideTo(ghost, tgt.left, tgt.top, 460, false);
    if (activeGhost === ghost) { ghost.remove(); activeGhost = null; }
    showRealToken(toSquare, idx);
    return;
  }

  /* [BOUNCE-BACK] Overshot 100 — dash to the wall, bonk, rebound to start. */
  if (move.bounced) {
    await animateBounce(fromSquare, ghost, seat);
    if (activeGhost === ghost) { ghost.remove(); activeGhost = null; }
    showRealToken(toSquare, idx);
    return;
  }

  const rawLanding = move.landing;
  const hasJump = move.jumpType !== null;
  const isLadder = move.jumpType === "ladder";

  /* Phase 1: Hop tile-by-tile to the landing square */
  for (let sq = fromSquare + 1; sq <= rawLanding; sq++) {
    const target = getSquareTokenPos(sq);
    if (!target || activeGhost !== ghost) break;
    await hopTo(ghost, target.left, target.top, 220);
    sfx.playHop();
    emitTrail(ghost, seat.color || DEFAULT_SEAT_COLORS[idx - 1]);
  }

  if (!hasJump) haptics.land();

  /* Phase 2: [LADDER TRAVERSAL / SNAKE DESCENT] */
  if (hasJump && activeGhost === ghost) {
    await sleep(80);
    if (activeGhost !== ghost) return;

    ghost.classList.add(isLadder ? "climb-glow" : "descend-glow");
    const jumpTarget = getSquareTokenPos(toSquare);

    if (isLadder) {
      sfx.playLadder(); haptics.ladder();
      /* Stepped climb: hop rung-by-rung up the ladder line. */
      const startL = parseFloat(ghost.style.left) || 0;
      const startT = parseFloat(ghost.style.top) || 0;
      if (jumpTarget) {
        const dist = Math.hypot(jumpTarget.left - startL, jumpTarget.top - startT);
        const steps = Math.max(3, Math.min(7, Math.round(dist / 42)));
        for (let i = 1; i <= steps; i++) {
          if (activeGhost !== ghost) break;
          const t = i / steps;
          await hopTo(ghost, startL + (jumpTarget.left - startL) * t, startT + (jumpTarget.top - startT) * t, 150);
        }
      }
      const cell = boardEl.querySelector("[data-square='" + toSquare + "']");
      if (cell) {
        const r = cell.getBoundingClientRect();
        confetti.sparkle(r.left + r.width / 2, r.top + r.height / 2);
      }
    } else {
      /* Snake: a quick chomp at the head before the slithery slide down. */
      sfx.playSnake(); haptics.snake();
      chompAt(rawLanding);
      triggerShake();
      await sleep(150);
      if (activeGhost === ghost && jumpTarget) {
        await slideTo(ghost, jumpTarget.left, jumpTarget.top, 380, true);
      }
    }
  }

  if (activeGhost === ghost) { ghost.remove(); activeGhost = null; }
  showRealToken(toSquare, idx);
}

/* [VICTORY RUN] Slow-motion dash up the final stretch to 100 with a building
   glow trail, then a big splash, screen flash and shake on arrival. Runs on
   every client (winner and spectators) so opponents can watch and react before
   the overlay appears. `ghost` is the already-positioned ghost token. */
async function animateVictoryRun(fromSquare, ghost, seat) {
  const color = seat.color || DEFAULT_SEAT_COLORS[seat.idx - 1];
  document.body.classList.add("victory-slowmo");
  sfx.playVictoryRun();

  /* Defensive cap (current boards always win by an exact dice landing 94..99,
     so this is short; guards against any future ladder-to-100). */
  const runStart = Math.max(fromSquare, 100 - 12);
  if (runStart !== fromSquare) {
    const sp = getSquareTokenPos(runStart);
    if (sp) { ghost.style.left = sp.left + "px"; ghost.style.top = sp.top + "px"; }
  }

  const total = Math.max(1, 100 - runStart);
  let step = 0;
  for (let sq = runStart + 1; sq <= 100; sq++) {
    const target = getSquareTokenPos(sq);
    if (!target || activeGhost !== ghost) break;
    step += 1;
    const frac = step / total;
    const dur = 260 + Math.round(360 * frac); // slow down approaching the finish
    if (sq === 100) await sleep(220);         // anticipation hover before the last hop
    await hopTo(ghost, target.left, target.top, dur);
    sfx.playHop();
    emitTrail(ghost, color);
    emitTrail(ghost, color);
  }

  const cell = boardEl.querySelector("[data-square='100']");
  if (cell) {
    const r = cell.getBoundingClientRect();
    confetti.splash(r.left + r.width / 2, r.top + r.height / 2, color);
    spawnVictoryRing(r.left + r.width / 2, r.top + r.height / 2, color);
  }
  flashScreen();
  triggerShake();
  haptics.win();
  document.body.classList.remove("victory-slowmo");
}

/* [BOUNCE-BACK] Overshot 100 — dash to the wall, bonk, and rebound to start. */
async function animateBounce(fromSquare, ghost, seat) {
  for (let sq = fromSquare + 1; sq <= 100; sq++) {
    const target = getSquareTokenPos(sq);
    if (!target || activeGhost !== ghost) break;
    await hopTo(ghost, target.left, target.top, 150);
    sfx.playHop();
  }
  if (activeGhost !== ghost) return;
  sfx.playBonk();
  haptics.snake();
  triggerShake();
  ghost.classList.add("descend-glow");
  await sleep(120);
  const back = getSquareTokenPos(fromSquare);
  if (back && activeGhost === ghost) await slideTo(ghost, back.left, back.top, 380, true);
  ghost.classList.remove("descend-glow");
}

/* [SNAKE BITE] A brief chomp flash at the snake's head (the landing square). */
function chompAt(square) {
  if (reducedMotion()) return;
  const cell = boardEl.querySelector("[data-square='" + square + "']");
  if (!cell) return;
  const chomp = document.createElement("div");
  chomp.className = "snake-chomp";
  cell.appendChild(chomp);
  setTimeout(function () { chomp.remove(); }, 460);
}

/* [SPLASH] Expanding shockwave ring at the finish, layered over the particles. */
function spawnVictoryRing(x, y, color) {
  if (reducedMotion()) return;
  const ring = document.createElement("div");
  ring.className = "victory-ring";
  ring.style.left = x + "px";
  ring.style.top = y + "px";
  ring.style.setProperty("--ring", color || "var(--gold)");
  document.body.appendChild(ring);
  setTimeout(function () { ring.remove(); }, 900);
}

/* [SPLASH] Brief full-screen flash on the winning landing. */
function flashScreen() {
  if (reducedMotion()) return;
  const flash = document.createElement("div");
  flash.className = "victory-flash";
  document.body.appendChild(flash);
  setTimeout(function () { flash.remove(); }, 520);
}

/* Reveal the (deferred) win overlay once the victory run has finished. */
function revealWin(seat) {
  pendingVictory = null;
  winOverlayEl.classList.remove("hidden");
  celebrateWinOnce(seat);
}

/* ═══════════════════ END ANIMATION SYSTEM ═══════════════════ */

/* ── Seats: a unified per-player view both modes render from ── */

/* Max seats for the current online room (2..4); defaults to 2 before a room loads. */
function onlineMaxPlayers() {
  return Math.min(Math.max((currentRoom && currentRoom.max_players) || 2, 2), 4);
}

function avatarColorFor(role, idx) {
  if (gameMode === "online" && currentMembership && role === currentMembership.role && myAvatar.color) {
    return myAvatar.color;
  }
  return DEFAULT_SEAT_COLORS[idx - 1];
}

function avatarEmojiFor(role) {
  if (gameMode === "online" && currentMembership && role === currentMembership.role) {
    return myAvatar.emoji || null;
  }
  return null;
}

function getSeats() {
  if (gameMode === "local" && localState) {
    return localState.seats.map(function (s) {
      return {
        role: s.role,
        idx: s.idx,
        position: localState.positions[s.role],
        color: s.color || DEFAULT_SEAT_COLORS[s.idx - 1],
        emoji: s.avatar || null,
        name: s.name,
        kind: s.kind
      };
    });
  }

  const out = [];
  const max = onlineMaxPlayers();
  for (let i = 1; i <= max; i++) {
    const role = "player" + i;
    const p = currentPlayers.find(function (pp) { return pp.role === role; });
    out.push({
      role: role, idx: i,
      position: currentGame ? (currentGame[role + "_position"] || 0) : 0,
      color: avatarColorFor(role, i), emoji: avatarEmojiFor(role),
      name: p ? p.player_name : "Waiting…", kind: "human",
      present: !!p
    });
  }
  return out;
}

function moveForSeat(seat, fromPos) {
  if (gameMode === "local" && localState && localState.lastMoves[seat.role]) {
    return localState.lastMoves[seat.role];
  }
  const board = findBoardById(currentGame ? currentGame.board_id : boards[0].id);
  return resolveMove(fromPos, currentGame ? (currentGame.last_roll || 0) : 0, board.jumps);
}

function applyDotAvatar(dotEl, seat) {
  if (!dotEl || !seat) return;
  dotEl.style.setProperty("--tok", seat.color || DEFAULT_SEAT_COLORS[seat.idx - 1]);
  if (seat.emoji) {
    dotEl.classList.add("token-emoji");
    dotEl.textContent = seat.emoji;
  } else {
    dotEl.classList.remove("token-emoji");
    dotEl.textContent = "";
  }
}

function seatName(role) {
  if (!localState) return role;
  const s = localState.seats.find(function (x) { return x.role === role; });
  return s ? s.name : role;
}

function fireSeatAnimation(fromSquare, toSquare, seat, move) {
  busyAnimating = true;
  pendingAnims += 1;
  animateTokenMove(fromSquare, toSquare, seat, move).finally(function () {
    pendingAnims -= 1;
    if (pendingAnims <= 0) {
      pendingAnims = 0;
      busyAnimating = false;
      if (gameMode === "local") afterLocalTurn();
    }
  });
}

/* ── Rendering ── */

function renderBoard() {
  boardEl.innerHTML = "";

  const board = findBoardById(currentGame?.board_id ?? boards[0].id);
  const jumps = board.jumps;
  const seats = getSeats();
  const powerTiles = (gameMode === "local" && localState && localState.config.powerUpsEnabled)
    ? localState.powerTiles : {};

  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const number = getCellNumber(row, col);
      const cell = document.createElement("div");
      cell.className = "cell";
      /* [PIECE HOP] data-square enables animation position lookup */
      cell.setAttribute("data-square", number);

      if ((row + col) % 2 === 1) cell.classList.add("cell-alt");

      if (number === 1) cell.classList.add("cell-start");
      if (number === 100) cell.classList.add("cell-end");

      const dest = jumps[number];
      if (dest) {
        cell.classList.add(dest > number ? "has-ladder" : "has-snake");
      }

      if (powerTiles[number]) cell.classList.add("has-power");

      const numEl = document.createElement("div");
      numEl.className = "cell-num";
      numEl.textContent = number;
      cell.appendChild(numEl);

      if (number === 1) {
        const tag = document.createElement("div");
        tag.className = "cell-tag";
        tag.textContent = "GO";
        cell.appendChild(tag);
      }

      if (number === 100) {
        const tag = document.createElement("div");
        tag.className = "cell-tag";
        tag.textContent = "WIN";
        cell.appendChild(tag);
      }

      if (dest) {
        const jl = document.createElement("div");
        jl.className = "jump-lbl " + (dest > number ? "ladder" : "snake");
        jl.textContent = (dest > number ? "\u2191" : "\u2193") + dest;
        cell.appendChild(jl);
      }

      if (powerTiles[number]) {
        const star = document.createElement("div");
        star.className = "power-star";
        star.textContent = "\u2605";
        cell.appendChild(star);
      }

      const here = seats.filter(function (s) { return s.position === number; });
      if (here.length) {
        const wrap = document.createElement("div");
        wrap.className = "tokens";
        here.forEach(function (s) {
          const tk = document.createElement("div");
          tk.className = "token seat-" + s.idx;
          tk.style.setProperty("--tok", s.color);
          if (s.emoji) {
            tk.classList.add("token-emoji");
            tk.textContent = s.emoji;
          }
          if (animateMoves && (prevPositions[s.role] || 0) !== s.position) {
            tk.classList.add("bounce");
          }
          if (currentGame && !currentGame.winner && currentGame.current_turn === s.role) {
            tk.classList.add("turn-glow");
          }
          if (gameMode === "local" && localState && localState.pending[s.role] && localState.pending[s.role].shield) {
            tk.classList.add("shielded");
          }
          wrap.appendChild(tk);
        });
        cell.appendChild(wrap);
      }

      boardEl.appendChild(cell);
    }
  }

  seats.forEach(function (s) { prevPositions[s.role] = s.position; });
  animateMoves = false;

  renderOverlay();
}

function updateUI() {
  const seats = getSeats();
  const shouldAnimate = animateMoves;
  const prev = Object.assign({}, prevPositions);

  renderBoard();

  /* Hide destination tokens that are about to be animated by a ghost. */
  if (shouldAnimate) {
    seats.forEach(function (s) {
      const oldPos = prev[s.role] || 0;
      if (oldPos !== s.position && oldPos > 0 && s.position > 0) hideRealToken(s.position, s.idx);
    });
  }

  boardNameEl.textContent = currentGame ? findBoardById(currentGame.board_id).name : "—";
  roomCodeDisplayEl.textContent = gameMode === "local" ? "LOCAL" : (currentRoom?.code ?? "------");

  if (currentGame?.last_roll) {
    diceCharEl.textContent = String(currentGame.last_roll);
    if (!diceRolling) dice3d.setFace(currentGame.last_roll);
    lastActionEl.textContent = "Rolled " + currentGame.last_roll;
  }

  /* A winning move that will animate: hold the overlay back until the victory
     run finishes (revealWin reopens it). Guarded so re-entrant updateUI calls
     during the run don't reset or prematurely reveal it. */
  if (!pendingVictory && !winCelebrated && shouldAnimate && !reducedMotion()) {
    const winnerRole = currentGame?.winner;
    if (winnerRole) {
      const ws = seats.find(function (s) { return s.role === winnerRole; });
      const oldPos = prev[winnerRole] || 0;
      if (ws && ws.position === 100 && oldPos > 0 && oldPos !== 100) pendingVictory = ws;
    }
  }

  if (gameMode === "local") updateLocalUI(seats);
  else updateOnlineUI(seats);

  if (shouldAnimate) {
    seats.forEach(function (s) {
      const oldPos = prev[s.role] || 0;
      if (oldPos !== s.position && oldPos > 0 && s.position > 0) {
        fireSeatAnimation(oldPos, s.position, s, moveForSeat(s, oldPos));
      }
    });
  }
}

/* Fire win celebration FX once and record the result. */
function celebrateWinOnce(winnerSeat) {
  if (winCelebrated) return;
  winCelebrated = true;
  clearTurnTimer();
  confetti.burst();
  sfx.playWin();
  haptics.win();
  recordResult(winnerSeat);
}

function recordResult(winnerSeat) {
  const board = currentGame ? findBoardById(currentGame.board_id).name : "—";
  if (gameMode === "local") {
    const youRole = localState.seats[0].role;
    const result = winnerSeat.role === youRole ? "win" : "loss";
    const opp = localState.seats
      .filter(function (s) { return s.role !== youRole; })
      .map(function (s) { return s.name; })
      .join(", ");
    stats.recordMatch({ mode: "local", result: result, opponent: opp, board: board });
  } else {
    const result = winnerSeat.role === currentMembership?.role ? "win" : "loss";
    const oppP = currentPlayers.find(function (p) { return p.role !== currentMembership?.role; });
    stats.recordMatch({ mode: "online", result: result, opponent: oppP ? oppP.player_name : "Opponent", board: board });
  }
}

function updateOnlineUI(seats) {
  playerStripEl.classList.remove("hidden");
  localStripEl.classList.add("hidden");
  copyCodeBtn.style.display = "";
  refreshRoomBtn.style.display = "";
  emoteBarEl.classList.remove("hidden");
  powerTrayEl.classList.add("hidden");
  turnTimerEl.classList.add("hidden");

  renderStrip(playerStripEl, seats, {
    currentTurn: currentGame?.current_turn,
    winner: currentGame?.winner,
    online: true
  });

  const max = onlineMaxPlayers();
  const roomFull = currentPlayers.length >= max;
  const isMyTurn =
    currentGame &&
    !currentGame.winner &&
    roomFull &&
    currentMembership?.role === currentGame.current_turn;

  turnBannerEl.classList.remove("state-go", "state-wait", "state-win");

  if (currentGame?.winner) {
    const wp = currentPlayers.find(function (p) { return p.role === currentGame.winner; });
    const winnerName = wp?.player_name ?? currentGame.winner;
    const winnerPos = currentGame[currentGame.winner + "_position"];
    turnTextEl.textContent = winnerName + " wins!";
    turnBannerEl.classList.add("state-win");
    winTitleEl.textContent = currentGame.winner === currentMembership?.role ? "Victory!" : "Game Over";
    winMessageEl.textContent = winnerPos === 100
      ? winnerName + " reached square 100!"
      : winnerName + " wins — last player standing.";
    if (!pendingVictory) {
      winOverlayEl.classList.remove("hidden");
      celebrateWinOnce({ role: currentGame.winner, name: winnerName });
    }
  } else {
    winOverlayEl.classList.add("hidden");
    if (!roomFull) {
      turnTextEl.textContent = "Waiting for players (" + currentPlayers.length + "/" + max + ")…";
      turnBannerEl.classList.add("state-wait");
    } else if (isMyTurn) {
      turnTextEl.textContent = "Your turn — roll the dice!";
      turnBannerEl.classList.add("state-go");
    } else {
      const opp = currentPlayers.find(function (p) { return p.role === currentGame?.current_turn; });
      turnTextEl.textContent = "Waiting for " + (opp?.player_name ?? "opponent") + "…";
      turnBannerEl.classList.add("state-wait");
    }
  }

  if (rollDiceBtn) {
    const canRoll = !!isMyTurn;
    rollDiceBtn.disabled = !canRoll;
    rollDiceBtn.classList.toggle("pulse", canRoll);
    if (currentGame?.winner) rollDiceBtn.textContent = "Game Over";
    else if (canRoll) rollDiceBtn.textContent = "Roll";
    else rollDiceBtn.textContent = "Waiting…";
  }

  diceEl.classList.toggle("your-turn", !!isMyTurn);
}

function updateLocalUI(seats) {
  playerStripEl.classList.add("hidden");
  localStripEl.classList.remove("hidden");
  copyCodeBtn.style.display = "none";
  refreshRoomBtn.style.display = "none";
  emoteBarEl.classList.remove("hidden");

  renderStrip(localStripEl, seats, {
    currentTurn: localState.current_turn,
    winner: localState.winner,
    online: false
  });

  const winner = localState.winner;
  const curRole = localState.current_turn;
  const curSeat = localState.seats.find(function (s) { return s.role === curRole; });
  const humanTurn = localGame.isHumanTurn(localState);

  turnBannerEl.classList.remove("state-go", "state-wait", "state-win");

  if (winner) {
    const ws = localState.seats.find(function (s) { return s.role === winner; });
    turnTextEl.textContent = ws.name + " wins!";
    turnBannerEl.classList.add("state-win");
    winTitleEl.textContent = ws.kind === "cpu" ? "Defeat" : "Victory!";
    winMessageEl.textContent = ws.name + " reached square 100!";
    if (!pendingVictory) {
      winOverlayEl.classList.remove("hidden");
      celebrateWinOnce(ws);
    }
  } else {
    winOverlayEl.classList.add("hidden");
    if (humanTurn) {
      turnTextEl.textContent = seats.length > 2 ? (curSeat.name + " — roll the dice!") : "Your turn — roll the dice!";
      turnBannerEl.classList.add("state-go");
    } else {
      turnTextEl.textContent = curSeat.name + " is rolling…";
      turnBannerEl.classList.add("state-wait");
    }
  }

  rollDiceBtn.disabled = !humanTurn || !!winner;
  rollDiceBtn.classList.toggle("pulse", humanTurn && !winner);
  rollDiceBtn.textContent = winner ? "Game Over" : (humanTurn ? "Roll" : "Waiting…");
  diceEl.classList.toggle("your-turn", humanTurn && !winner);

  renderPowerTray();
}

/* Shared player-strip renderer for both modes. Each card carries data-role so
   emotes/presence can target it without per-seat element refs. opts:
   { currentTurn, winner, online }. */
function renderStrip(targetEl, seats, opts) {
  const o = opts || {};
  targetEl.innerHTML = "";
  seats.forEach(function (s) {
    const isActive = o.currentTurn === s.role && !o.winner;
    const waiting = o.online && s.present === false;

    const card = document.createElement("div");
    card.className = "p-card" + (isActive ? " active spotlight" : "") + (waiting ? " waiting" : "");
    card.setAttribute("data-role", s.role);

    const dot = document.createElement("div");
    dot.className = "p-dot";
    applyDotAvatar(dot, s);

    const info = document.createElement("div");
    info.className = "p-info";
    const name = document.createElement("span");
    name.className = "p-name";
    name.textContent = s.name + (s.kind === "cpu" ? " (CPU)" : "");
    const pos = document.createElement("span");
    pos.className = "p-pos";
    pos.textContent = s.position > 0 ? "Sq " + s.position : (waiting ? "—" : "Start");
    info.appendChild(name);
    info.appendChild(pos);

    card.appendChild(dot);
    card.appendChild(info);

    if (o.online) {
      const onl = document.createElement("span");
      onl.className = "p-online";
      onl.setAttribute("data-role", s.role);
      card.appendChild(onl);
    }

    targetEl.appendChild(card);
  });
}

function renderPowerTray() {
  if (!localState || !localState.config.powerUpsEnabled) {
    powerTrayEl.classList.add("hidden");
    return;
  }
  powerTrayEl.classList.remove("hidden");
  powerTrayEl.innerHTML = "";

  const humanTurn = localGame.isHumanTurn(localState);
  const role = localState.current_turn;
  const inv = humanTurn ? (localState.inventory[role] || []) : [];

  if (!humanTurn || !inv.length) {
    const empty = document.createElement("div");
    empty.className = "power-tray-empty";
    empty.textContent = humanTurn ? "No power-ups yet" : "";
    powerTrayEl.appendChild(empty);
    return;
  }

  inv.forEach(function (id) {
    const meta = localGame.POWER_UPS[id];
    const chip = document.createElement("button");
    chip.className = "power-chip" + (armedPowerUp === id ? " armed" : "");
    chip.title = meta.desc;
    const icon = document.createElement("span");
    icon.className = "pc-icon";
    icon.textContent = meta.icon;
    const label = document.createElement("span");
    label.textContent = meta.name;
    chip.appendChild(icon);
    chip.appendChild(label);
    chip.addEventListener("click", function () {
      armedPowerUp = (armedPowerUp === id) ? null : id;
      renderPowerTray();
    });
    powerTrayEl.appendChild(chip);
  });
}

/* ── Room creation ── */

async function createRoom() {
  const playerName = playerNameInput.value.trim();
  if (!playerName) { notifyError("Enter a player name first."); return; }
  if (!currentUser?.id) { notifyError("Still connecting — try again in a moment."); return; }

  const maxPlayers = parseInt(onlineMaxPlayersEl?.value, 10) || 2;

  setButtonsDisabled(true);
  try {
    /* Atomic server-side create: room + player1 + game, unique code, random board. */
    const { data, error } = await supabase.rpc("create_room", {
      p_player_name: playerName,
      p_max_players: maxPlayers
    });
    if (error) { notifyError(errorMessage(error, "Could not create a room.")); return; }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.room_code) { notifyError("Room creation returned no data."); return; }

    logMessage("Created room " + row.room_code + " (" + maxPlayers + "P) as " + row.assigned_role + ".");
    showToast("Room " + row.room_code + " — share to fill " + maxPlayers + " seats!");
    showGameScreen();
    await loadRoomState(row.room_code);
  } finally {
    setButtonsDisabled(false);
  }
}

/* ── Join room ── */

async function joinRoom() {
  const playerName = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!playerName) { notifyError("Enter a player name first."); return; }
  if (!code) { notifyError("Enter a room code."); return; }
  if (!currentUser?.id) { notifyError("Still connecting — try again in a moment."); return; }

  setButtonsDisabled(true);
  try {
    /* Server-side join: assigns the role, fills the second seat, flips status,
       and is idempotent if you're already a member (rejoin). */
    const { data, error } = await supabase.rpc("join_room_by_code", {
      room_code: code,
      player_name_input: playerName
    });
    if (error) { notifyError(errorMessage(error, "Could not join room.")); return; }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.room_id) { notifyError("No room found with code " + code + "."); return; }

    const joinedCode = row.room_code_out ?? code;
    logMessage("Joined room " + joinedCode + " as " + row.assigned_role + ".");
    showToast("Joined as " + row.assigned_role);
    showGameScreen();
    await loadRoomState(joinedCode);
  } finally {
    setButtonsDisabled(false);
  }
}

/* ── Dice roll ── */

async function rollDice() {
  if (gameMode === "local") { rollLocal(); return; }

  if (!currentRoom || !currentGame || !currentMembership) {
    notifyError("Game not ready yet. Try Refresh.");
    return;
  }

  /* Disable immediately and shake the dice for instant feedback while the
     server resolves the roll. The server is the only authority over the move. */
  rollDiceBtn.disabled = true;
  rollDiceBtn.classList.remove("pulse");
  shakeDice();
  haptics.roll();

  const role = currentMembership.role;
  const posKey = role + "_position";
  const fromPos = currentGame[posKey] ?? 0;

  try {
    const { data, error } = await supabase.rpc("roll_dice", { p_room_id: currentRoom.id });
    if (error) { notifyError(errorMessage(error, "Roll failed.")); return; }

    const game = Array.isArray(data) ? data[0] : data;
    if (!game) { notifyError("Roll returned no data."); return; }

    /* The RPC return value is authoritative \u2014 apply it directly. The realtime
       broadcast of this same row arrives shortly after and is deduped by version. */
    const board = findBoardById(game.board_id);
    const move = resolveMove(fromPos, game.last_roll, board.jumps);
    describeMove(game.last_roll, fromPos, move);

    animateDice(game.last_roll);
    currentGame = game;
    animateMoves = true;

    if (game.winner === role) logMessage("You reached square 100 \u2014 you win!");
  } finally {
    updateUI();
  }
}

/* Friendly log + toast line for a resolved move (display only). */
function describeMove(roll, fromPos, move) {
  let msg;
  if (move.bounced) {
    msg = "Rolled " + roll + " \u2014 need exactly " + (100 - fromPos) + " to win. Stay at " + fromPos + ".";
  } else if (move.jumpType === "ladder") {
    msg = "Rolled " + roll + ". Ladder! " + move.landing + " \u2192 " + move.newPos;
  } else if (move.jumpType === "snake") {
    msg = "Rolled " + roll + ". Snake! " + move.landing + " \u2192 " + move.newPos;
  } else {
    msg = "Rolled " + roll + ". Moved " + fromPos + " \u2192 " + move.newPos;
  }
  logMessage(msg);
  showToast(msg);
}

/* \u2500\u2500 Rematch / leave / forfeit \u2500\u2500 */

async function requestRematch() {
  if (gameMode === "local") { restartLocalGame(); return; }

  if (!currentRoom) return;
  rematchBtn.disabled = true;
  try {
    const { data, error } = await supabase.rpc("rematch", { p_room_id: currentRoom.id });
    if (error) { notifyError(errorMessage(error, "Could not start a rematch.")); return; }
    const game = Array.isArray(data) ? data[0] : data;
    if (game) {
      currentGame = game;
      prevPositions = {};
      animateMoves = false;
      winCelebrated = false;
      pendingVictory = null;
      confetti.clear();
      winOverlayEl.classList.add("hidden");
      setDiceFace(0);
      lastActionEl.textContent = "Roll to start";
      logMessage("Rematch \u2014 new game on " + findBoardById(game.board_id).name + "!");
      updateUI();
    }
  } finally {
    rematchBtn.disabled = false;
  }
}

function leaveToLobby() {
  clearTurnTimer();
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  gameMode = "online";
  localState = null;
  armedPowerUp = null;
  currentRoom = null;
  currentMembership = null;
  currentGame = null;
  currentPlayers = [];
  prevPositions = {};
  animateMoves = false;
  winCelebrated = false;
  pendingVictory = null;
  confetti.clear();
  presenceState = {};
  setDiceFace(0);
  lastActionEl.textContent = "Roll to start";
  rollDiceBtn.textContent = "Roll";
  logEl.innerHTML = "";
  winOverlayEl.classList.add("hidden");
  gameScreenEl.classList.add("hidden");
  playerStripEl.classList.remove("hidden");
  localStripEl.classList.add("hidden");
  powerTrayEl.classList.add("hidden");
  copyCodeBtn.style.display = "";
  refreshRoomBtn.style.display = "";
  lobbyEl.classList.remove("hidden");
}

/* Leaving an in-progress game forfeits it (online: the opponent wins). */
async function leaveRoom() {
  if (gameMode === "local") {
    if (localState && !localState.winner) {
      const ok = window.confirm("Leave the game?");
      if (!ok) return;
    }
    leaveToLobby();
    return;
  }

  const inProgress = currentGame && !currentGame.winner && currentPlayers.length >= onlineMaxPlayers();
  if (inProgress) {
    const msg = currentPlayers.length > 2
      ? "Leave the game? You'll drop out of the match."
      : "Leave the game? Your opponent will be awarded the win.";
    const ok = window.confirm(msg);
    if (!ok) return;
    const { error } = await supabase.rpc("forfeit", { p_room_id: currentRoom.id });
    if (error) notifyError(errorMessage(error, "Could not leave cleanly."));
  }
  leaveToLobby();
}

/* ══════════════════ LOCAL MODE (offline / vs CPU / hot-seat) ══════════════════ */

function syncFromLocal() {
  currentGame = localGame.toGameRow(localState);
}

function rollLocal() {
  if (!localState || !localGame.isHumanTurn(localState) || busyAnimating) return;
  const roll = 1 + Math.floor(Math.random() * 6);
  applyLocalRoll(roll, armedPowerUp);
}

function applyLocalRoll(roll, chosen) {
  clearTurnTimer();
  rollDiceBtn.disabled = true;
  rollDiceBtn.classList.remove("pulse");
  shakeDice();
  haptics.roll();

  const result = localGame.stepRoll(localState, roll, chosen, Math.random);
  localState = result.state;
  armedPowerUp = null;

  describeLocalEvents(result.events);
  animateDice(localState.last_roll);
  syncFromLocal();
  animateMoves = true;
  updateUI();

  if (!busyAnimating) afterLocalTurn();
}

function sparkleAtSquare(square) {
  const cell = boardEl.querySelector("[data-square='" + square + "']");
  if (!cell) return;
  const r = cell.getBoundingClientRect();
  confetti.sparkle(r.left + r.width / 2, r.top + r.height / 2);
}

/* Briefly glow the dice (e.g. on a Double Roll). */
function pulseDiceGlow() {
  if (reducedMotion()) return;
  diceEl.classList.remove("power-glow");
  void diceEl.offsetWidth;
  diceEl.classList.add("power-glow");
  setTimeout(function () { diceEl.classList.remove("power-glow"); }, 900);
}

function describeLocalEvents(events) {
  events.forEach(function (e) {
    if (e.type === "powerup") {
      sfx.playPowerUse();
      if (e.id === "doubleRoll") {
        logMessage(seatName(e.role) + " used Double Roll: " + e.rolls[0] + " + " + e.rolls[1] + " = " + e.total + ".");
        showToast("Double Roll — moved " + e.total + "!");
        pulseDiceGlow();
        showEmote(e.role, "🎲");
      } else if (e.id === "shield") {
        logMessage(seatName(e.role) + " armed a Shield.");
        showEmote(e.role, "🛡️");
      } else if (e.id === "swap") {
        logMessage(seatName(e.role) + " used Swap.");
        showEmote(e.role, "🔄");
      }
    } else if (e.type === "shieldBlock") {
      showToast("Shield blocked the snake!");
      logMessage("Shield blocked a snake at " + e.at + ".");
      sparkleAtSquare(e.at);
      showEmote(e.role, "🛡️");
    } else if (e.type === "acquire") {
      sfx.playPowerGain();
      const meta = localGame.POWER_UPS[e.id];
      logMessage(seatName(e.role) + " picked up " + (meta ? meta.name : e.id) + "!");
      showToast("Power-up: " + (meta ? meta.name : e.id));
      sparkleAtSquare(e.at);
    } else if (e.type === "move") {
      let msg;
      if (e.jumpType === "ladder") msg = seatName(e.role) + " climbed " + e.landing + " → " + e.to + "!";
      else if (e.jumpType === "snake") msg = seatName(e.role) + " hit a snake " + e.landing + " → " + e.to + ".";
      else msg = seatName(e.role) + " moved to " + e.to + ".";
      logMessage(msg);
    } else if (e.type === "bounce") {
      logMessage(seatName(e.role) + " rolled " + e.roll + " — needs exact, stays put.");
    } else if (e.type === "swap") {
      showToast(seatName(e.role) + " swapped with " + seatName(e.with) + "!");
    } else if (e.type === "win") {
      logMessage(seatName(e.role) + " reached square 100!");
    }
  });
}

function afterLocalTurn() {
  if (gameMode !== "local" || !localState) return;
  if (localState.winner) return;
  startTurnTimer();
  scheduleAIIfNeeded();
}

function scheduleAIIfNeeded() {
  if (gameMode !== "local" || !localState || localState.winner) return;
  const seat = localState.seats.find(function (s) { return s.role === localState.current_turn; });
  if (!seat || seat.kind !== "cpu") return;
  clearTurnTimer();
  const role = seat.role;
  setTimeout(function () {
    if (gameMode !== "local" || !localState || localState.winner) return;
    if (localState.current_turn !== role || busyAnimating) return;
    const chosen = aiPolicy.choosePowerUp(localState, role, seat.difficulty);
    const roll = 1 + Math.floor(Math.random() * 6);
    applyLocalRoll(roll, chosen);
  }, AI_THINK_MS);
}

function clearTurnTimer() {
  if (turnTimerHandle) {
    cancelAnimationFrame(turnTimerHandle);
    turnTimerHandle = null;
  }
  turnTimerEl.classList.add("hidden");
}

function startTurnTimer() {
  clearTurnTimer();
  if (gameMode !== "local" || !localState || localState.winner) return;
  const secs = localState.config.turnTimer;
  if (!secs || !localGame.isHumanTurn(localState)) return;

  const role = localState.current_turn;
  const end = performance.now() + secs * 1000;
  turnTimerEl.classList.remove("hidden");
  turnTimerBarEl.style.transition = "none";

  function tick() {
    if (gameMode !== "local" || !localState || localState.winner || localState.current_turn !== role) {
      clearTurnTimer();
      return;
    }
    const remain = end - performance.now();
    const frac = Math.max(0, remain / (secs * 1000));
    turnTimerBarEl.style.transform = "scaleX(" + frac + ")";
    turnTimerBarEl.classList.toggle("low", frac < 0.33);
    if (remain <= 0) {
      clearTurnTimer();
      rollLocal();
      return;
    }
    turnTimerHandle = requestAnimationFrame(tick);
  }
  turnTimerHandle = requestAnimationFrame(tick);
}

function defaultSeatName(i) {
  if (i === 0) return "You";
  if (i === 1) return "Computer";
  return "Player " + (i + 1);
}

function buildSeatRows() {
  const count = parseInt(lsPlayersEl.value, 10) || 2;
  lsSeatsEl.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "ls-seat";

    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 16;
    name.className = "ls-name";
    name.dataset.seat = String(i);
    name.value = i === 0 ? (playerNameInput.value.trim() || "You") : defaultSeatName(i);
    row.appendChild(name);

    if (i === 0) {
      const tag = document.createElement("span");
      tag.className = "ls-you";
      tag.textContent = "(you)";
      row.appendChild(tag);
    } else {
      const kind = document.createElement("select");
      kind.className = "ls-kind";
      kind.dataset.seat = String(i);
      kind.innerHTML = '<option value="cpu">CPU</option><option value="human">Human</option>';
      const diff = document.createElement("select");
      diff.className = "ls-diff";
      diff.dataset.seat = String(i);
      diff.innerHTML = '<option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option>';
      kind.addEventListener("change", function () {
        diff.style.display = kind.value === "cpu" ? "" : "none";
      });
      row.appendChild(kind);
      row.appendChild(diff);
    }
    lsSeatsEl.appendChild(row);
  }
}

function populateBoardSelect() {
  lsBoardEl.innerHTML = '<option value="random">Random</option>';
  boards.forEach(function (b) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name;
    lsBoardEl.appendChild(opt);
  });
}

function openLocalSetup() {
  populateBoardSelect();
  buildSeatRows();
  localSetupEl.classList.remove("hidden");
}

function readSeatConfig() {
  const count = parseInt(lsPlayersEl.value, 10) || 2;
  const seats = [];
  for (let i = 0; i < count; i++) {
    const nameEl = lsSeatsEl.querySelector('.ls-name[data-seat="' + i + '"]');
    const name = (nameEl && nameEl.value.trim()) || defaultSeatName(i);
    if (i === 0) {
      seats.push({ name: name, kind: "human", color: myAvatar.color || undefined, avatar: myAvatar.emoji || undefined });
    } else {
      const kindEl = lsSeatsEl.querySelector('.ls-kind[data-seat="' + i + '"]');
      const diffEl = lsSeatsEl.querySelector('.ls-diff[data-seat="' + i + '"]');
      seats.push({ name: name, kind: kindEl ? kindEl.value : "cpu", difficulty: diffEl ? diffEl.value : "medium" });
    }
  }
  return seats;
}

function startLocalGame() {
  const seats = readSeatConfig();
  let boardId = lsBoardEl.value;
  if (boardId === "random") boardId = boards[(Math.random() * boards.length) | 0].id;
  const board = findBoardById(boardId);

  gameMode = "local";
  localState = localGame.createLocalGame({
    boardId: boardId,
    jumps: board.jumps,
    seats: seats,
    powerUpsEnabled: lsPowerUpsEl.checked,
    turnTimer: parseInt(lsTimerEl.value, 10) || 0,
    rng: Math.random
  });

  armedPowerUp = null;
  prevPositions = {};
  localState.seats.forEach(function (s) { prevPositions[s.role] = 0; });
  animateMoves = false;
  winCelebrated = false;
  confetti.clear();
  setDiceFace(0);
  lastActionEl.textContent = "Roll to start";
  logEl.innerHTML = "";
  winOverlayEl.classList.add("hidden");

  syncFromLocal();
  localSetupEl.classList.add("hidden");
  showGameScreen();
  logMessage("Local game started on " + board.name + ".");
  updateUI();
  startTurnTimer();
  scheduleAIIfNeeded();
}

function restartLocalGame() {
  if (!localState) return;
  const board = findBoardById(localState.board_id);
  localState = localGame.createLocalGame({
    boardId: localState.board_id,
    jumps: localState.jumps,
    seats: localState.seats.map(function (s) {
      return { name: s.name, kind: s.kind, difficulty: s.difficulty, color: s.color, avatar: s.avatar };
    }),
    powerUpsEnabled: localState.config.powerUpsEnabled,
    turnTimer: localState.config.turnTimer,
    rng: Math.random
  });

  armedPowerUp = null;
  prevPositions = {};
  localState.seats.forEach(function (s) { prevPositions[s.role] = 0; });
  animateMoves = false;
  winCelebrated = false;
  confetti.clear();
  setDiceFace(0);
  lastActionEl.textContent = "Roll to start";
  winOverlayEl.classList.add("hidden");
  logMessage("New game on " + board.name + "!");

  syncFromLocal();
  updateUI();
  startTurnTimer();
  scheduleAIIfNeeded();
}

/* ── Emotes / reactions ── */

function buildEmoteBar() {
  emoteBarEl.innerHTML = "";
  EMOTES.forEach(function (emoji) {
    const btn = document.createElement("button");
    btn.className = "emote-btn";
    btn.type = "button";
    btn.textContent = emoji;
    btn.setAttribute("aria-label", "Send " + emoji);
    btn.addEventListener("click", function () { sendEmote(emoji); });
    emoteBarEl.appendChild(btn);
  });
}

function sendEmote(emoji) {
  if (gameMode === "local") {
    showEmote(localState ? localState.current_turn : "player1", emoji);
    return;
  }
  const myRole = currentMembership?.role;
  if (myRole) showEmote(myRole, emoji);
  if (realtimeChannel) {
    realtimeChannel.send({ type: "broadcast", event: "emote", payload: { role: myRole, emoji: emoji } });
  }
}

function showEmote(role, emoji) {
  const stripEl = gameMode === "local" ? localStripEl : playerStripEl;
  const cardEl = stripEl.querySelector('[data-role="' + role + '"]');
  if (!cardEl) return;
  const r = cardEl.getBoundingClientRect();
  const bubble = document.createElement("div");
  bubble.className = "emote-bubble";
  bubble.textContent = emoji;
  bubble.style.left = (r.left + r.width / 2 - 14) + "px";
  bubble.style.top = (r.top - 6) + "px";
  document.body.appendChild(bubble);
  setTimeout(function () { bubble.remove(); }, 1700);
}

/* ── Avatar picker ── */

function loadAvatar() {
  try {
    const raw = localStorage.getItem("snl_avatar");
    if (raw) myAvatar = JSON.parse(raw);
  } catch {
    myAvatar = { color: null, emoji: null };
  }
}

function saveAvatar() {
  try {
    localStorage.setItem("snl_avatar", JSON.stringify(myAvatar));
  } catch {
    /* private mode — keep in memory */
  }
}

function buildAvatarPicker() {
  avatarPickEl.innerHTML = "";

  DEFAULT_SEAT_COLORS.forEach(function (color) {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "avatar-opt swatch";
    opt.style.setProperty("--tok", color);
    opt.dataset.color = color;
    if (myAvatar.color === color && !myAvatar.emoji) opt.classList.add("selected");
    opt.addEventListener("click", function () {
      myAvatar = { color: color, emoji: null };
      saveAvatar();
      refreshAvatarSelection();
    });
    avatarPickEl.appendChild(opt);
  });

  AVATAR_EMOJIS.forEach(function (emoji) {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "avatar-opt";
    opt.textContent = emoji;
    opt.dataset.emoji = emoji;
    if (myAvatar.emoji === emoji) opt.classList.add("selected");
    opt.addEventListener("click", function () {
      myAvatar = { color: myAvatar.color || DEFAULT_SEAT_COLORS[0], emoji: emoji };
      saveAvatar();
      refreshAvatarSelection();
    });
    avatarPickEl.appendChild(opt);
  });
}

function refreshAvatarSelection() {
  Array.prototype.forEach.call(avatarPickEl.children, function (el) {
    const isColor = el.dataset.color && !myAvatar.emoji && myAvatar.color === el.dataset.color;
    const isEmoji = el.dataset.emoji && myAvatar.emoji === el.dataset.emoji;
    el.classList.toggle("selected", !!(isColor || isEmoji));
  });
}

/* ── Dice skin picker (cosmetic, local-only) ── */

function loadDiceSkin() {
  try {
    const raw = localStorage.getItem("snl_dice");
    if (raw && DICE_SKINS.some(function (s) { return s.id === raw; })) myDiceSkin = raw;
  } catch {
    myDiceSkin = "classic";
  }
}

function applyDiceSkin(id) {
  myDiceSkin = id;
  DICE_SKINS.forEach(function (s) { diceEl.classList.remove("dice-skin-" + s.id); });
  diceEl.classList.add("dice-skin-" + id);
  try { localStorage.setItem("snl_dice", id); } catch { /* private mode */ }
}

function buildDiceSkinPicker() {
  if (!diceSkinPickEl) return;
  diceSkinPickEl.innerHTML = "";
  DICE_SKINS.forEach(function (skin) {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "dice-skin-opt dice-skin-" + skin.id + (myDiceSkin === skin.id ? " selected" : "");
    opt.dataset.skin = skin.id;
    opt.title = skin.name;
    opt.setAttribute("aria-label", skin.name + " dice");
    const pip = document.createElement("span");
    pip.className = "dsp-pip";
    opt.appendChild(pip);
    opt.addEventListener("click", function () {
      applyDiceSkin(skin.id);
      refreshDiceSkinSelection();
    });
    diceSkinPickEl.appendChild(opt);
  });
}

function refreshDiceSkinSelection() {
  if (!diceSkinPickEl) return;
  Array.prototype.forEach.call(diceSkinPickEl.children, function (el) {
    el.classList.toggle("selected", el.dataset.skin === myDiceSkin);
  });
}

/* ── Theme ── */

function updateThemeButtons() {
  const t = theme.getTheme();
  const meta = theme.THEMES.find(function (x) { return x.id === t; });
  if (themeBtn) themeBtn.textContent = "Theme: " + (meta ? meta.name : t);
}

function cycleTheme() {
  theme.applyTheme(theme.nextTheme(theme.getTheme()));
  updateThemeButtons();
}

/* ── Stats overlay ── */

function openStats() {
  const s = stats.getStats();
  statsBodyEl.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "stats-grid";
  [
    ["Played", s.played],
    ["Won", s.won],
    ["Win rate", s.winRate + "%"],
    ["Streak", (s.streak > 0 ? "+" : "") + s.streak]
  ].forEach(function (pair) {
    const cell = document.createElement("div");
    cell.className = "stat-cell";
    const num = document.createElement("div");
    num.className = "stat-num";
    num.textContent = pair[1];
    const lbl = document.createElement("div");
    lbl.className = "stat-lbl";
    lbl.textContent = pair[0];
    cell.appendChild(num);
    cell.appendChild(lbl);
    grid.appendChild(cell);
  });
  statsBodyEl.appendChild(grid);

  const recent = document.createElement("div");
  recent.className = "stats-recent";
  if (!s.recent.length) {
    recent.textContent = "No games played yet.";
  } else {
    s.recent.forEach(function (m) {
      const row = document.createElement("div");
      row.className = "stats-recent-row";
      const left = document.createElement("span");
      left.textContent = (m.mode === "local" ? "vs " : "online vs ") + m.opponent;
      const right = document.createElement("span");
      right.className = m.result === "win" ? "res-win" : "res-loss";
      right.textContent = m.result === "win" ? "Win" : "Loss";
      row.appendChild(left);
      row.appendChild(right);
      recent.appendChild(row);
    });
  }
  statsBodyEl.appendChild(recent);

  statsOverlayEl.classList.remove("hidden");
}

/* ── Realtime subscriptions ── */

function subscribeToRoom(roomId) {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = supabase
    .channel("room-" + roomId, {
      config: { presence: { key: currentMembership?.id || currentUser?.id || roomId } }
    })
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "games",
        filter: "room_id=eq." + roomId
      },
      handleGameChange
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "room_players",
        filter: "room_id=eq." + roomId
      },
      function (payload) {
        if (payload.new) {
          const exists = currentPlayers.find(function (p) { return p.id === payload.new.id; });
          if (!exists) {
            currentPlayers.push(payload.new);
            logMessage(payload.new.player_name + " joined as " + payload.new.role + ".");
            showToast(payload.new.player_name + " joined!");
            updateUI();
          }
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "room_players",
        filter: "room_id=eq." + roomId
      },
      function (payload) {
        if (!payload.new) return;
        const i = currentPlayers.findIndex(function (p) { return p.id === payload.new.id; });
        if (i >= 0) currentPlayers[i] = payload.new;
        if (payload.new.forfeited) {
          logMessage((payload.new.player_name || payload.new.role) + " left the game.");
        }
        updateUI();
      }
    )
    .on("presence", { event: "sync" }, handlePresenceSync)
    .on("broadcast", { event: "emote" }, function (payload) {
      const data = payload && payload.payload ? payload.payload : null;
      if (data && data.role && data.role !== currentMembership?.role) {
        showEmote(data.role, data.emoji);
      }
    })
    .subscribe(function (status) {
      if (status === "SUBSCRIBED") {
        logMessage("Realtime connected.");
        realtimeChannel.track({
          user_id: currentUser?.id,
          role: currentMembership?.role,
          name: currentMembership?.player_name
        });
      }
    });
}

/* Apply an incoming game row. Deduped by `version` so a player's own roll (which
   we already applied from the RPC return value) doesn't double-process. */
function handleGameChange(payload) {
  const incoming = payload.new;
  if (!incoming) return;

  if (currentGame && incoming.version != null && currentGame.version != null &&
      incoming.version <= currentGame.version) {
    return; // echo of state we already have
  }

  const prev = currentGame;
  const moverRole = prev ? prev.current_turn : null;
  const isRematch = prev && prev.winner && !incoming.winner;
  const positionsChanged = !prev ||
    incoming.player1_position !== prev.player1_position ||
    incoming.player2_position !== prev.player2_position ||
    incoming.player3_position !== prev.player3_position ||
    incoming.player4_position !== prev.player4_position;
  const isRoll = !isRematch && incoming.last_roll != null &&
    (positionsChanged || (prev && incoming.last_roll !== prev.last_roll && !incoming.winner));

  currentGame = incoming;

  if (isRematch) {
    prevPositions = {};
    animateMoves = false;
    winCelebrated = false;
    pendingVictory = null;
    confetti.clear();
    setDiceFace(0);
    lastActionEl.textContent = "Roll to start";
    winOverlayEl.classList.add("hidden");
    logMessage("Rematch — new game on " + findBoardById(incoming.board_id).name + "!");
    updateUI();
    return;
  }

  if (incoming.last_roll && (!prev || incoming.last_roll !== prev.last_roll)) {
    animateDice(incoming.last_roll);
  }

  if (isRoll) {
    const mover = currentPlayers.find(function (p) { return p.role === moverRole; });
    logMessage((mover?.player_name ?? "Opponent") + " rolled " + incoming.last_roll + ".");
  } else if (incoming.winner) {
    const w = currentPlayers.find(function (p) { return p.role === incoming.winner; });
    logMessage((w?.player_name ?? incoming.winner) + " wins the game.");
  }

  animateMoves = true;
  updateUI();
}

/* ── Presence (online/offline indicators) ── */

function handlePresenceSync() {
  if (!realtimeChannel) return;
  presenceState = realtimeChannel.presenceState();

  const onlineRoles = new Set();
  Object.values(presenceState).forEach(function (entries) {
    entries.forEach(function (e) { if (e.role) onlineRoles.add(e.role); });
  });

  const myRole = currentMembership?.role;
  let othersOnline = false;
  onlineRoles.forEach(function (r) { if (r !== myRole) othersOnline = true; });

  if (currentPlayers.length >= 2 && opponentOnline && !othersOnline) {
    showToast("A player disconnected");
  }
  opponentOnline = othersOnline;
  updatePresenceIndicators(onlineRoles);
}

function updatePresenceIndicators(onlineRoles) {
  playerStripEl.querySelectorAll(".p-online").forEach(function (el) {
    el.classList.toggle("online", onlineRoles.has(el.getAttribute("data-role")));
  });
}

/* ── Load room state ── */

async function loadRoomState(roomCode) {
  const { data: room, error: roomError } = await supabase
    .from("rooms").select("*").eq("code", roomCode).maybeSingle();
  if (roomError) throw new Error("Room load failed: " + roomError.message);
  if (!room) throw new Error("Room not found.");

  const { data: game, error: gameError } = await supabase
    .from("games").select("*").eq("room_id", room.id).maybeSingle();
  if (gameError) throw new Error("Game load failed: " + gameError.message);

  if (!game) {
    console.warn("No game found for room " + roomCode + " (room_id: " + room.id + "). Check RLS SELECT policy on the games table.");
    logMessage("Warning: game data not found. Check Supabase RLS policies on the games table.");
  }

  const { data: players, error: playersError } = await supabase
    .from("room_players").select("*").eq("room_id", room.id);
  if (playersError) throw new Error("Players load failed: " + playersError.message);
  const safePlayers = Array.isArray(players) ? players : [];

  currentRoom = room;
  currentGame = game ?? null;
  currentPlayers = safePlayers;
  currentMembership =
    safePlayers.find(function (p) { return p.user_id === currentUser.id; }) ??
    currentMembership;

  /* Sync positions so tokens don't bounce on load/rejoin */
  prevPositions = {
    player1: currentGame?.player1_position ?? 0,
    player2: currentGame?.player2_position ?? 0,
    player3: currentGame?.player3_position ?? 0,
    player4: currentGame?.player4_position ?? 0
  };

  /* If the game is already won on load (rejoin/refresh), don't replay the
     celebration — treat it as already shown. */
  winCelebrated = !!currentGame?.winner;

  /* Reset presence baseline; the channel re-tracks on (re)subscribe. */
  presenceState = {};
  opponentOnline = false;

  subscribeToRoom(room.id);
  logMessage("Loaded room " + room.code + ".");
  updateUI();
}

/* ── Boot ── */

async function boot() {
  /* Visual layer first, so offline / local play works even if Supabase is down. */
  theme.initTheme();
  updateThemeButtons();
  dice3d.mount(diceCubeEl);
  setDiceFace(0);
  loadAvatar();
  buildAvatarPicker();
  loadDiceSkin();
  applyDiceSkin(myDiceSkin);
  buildDiceSkinPicker();
  buildEmoteBar();

  try {
    validateBoardSet(boards);
    await ensureSignedIn();
    currentUser = await getCurrentUser();
    if (!currentUser?.id) throw new Error("Anonymous sign-in succeeded but no user was returned.");

    authStatusEl.classList.remove("error");
    authStatusEl.textContent = "Connected \u2022 " + currentUser.id.slice(0, 8) + "\u2026";
    logMessage("Supabase session ready.");
    updateUI();
  } catch (error) {
    console.error(error);
    authStatusEl.classList.add("error");
    authStatusEl.textContent = "Connection failed \u2014 check Supabase config.";
    logMessage("Boot error: " + error.message);
  }
}

/* ── Event listeners ── */

createRoomBtn.addEventListener("click", async function () {
  try { await createRoom(); } catch (e) { console.error(e); logMessage("Error: " + e.message); notifyError(e.message); }
});

joinRoomBtn.addEventListener("click", async function () {
  try { await joinRoom(); } catch (e) { console.error(e); logMessage("Error: " + e.message); notifyError(e.message); }
});

refreshRoomBtn.addEventListener("click", async function () {
  try {
    const code = currentRoom?.code || roomCodeInput.value.trim().toUpperCase();
    if (!code) { notifyError("No room code available."); return; }
    await loadRoomState(code);
  } catch (e) { console.error(e); logMessage("Error: " + e.message); notifyError(e.message); }
});

rollDiceBtn.addEventListener("click", async function () {
  sfx.unlock();
  try { await rollDice(); } catch (e) { console.error(e); logMessage("Error: " + e.message); notifyError(e.message); }
});

/* ── Sound mute toggle ── */

function updateMuteButton() {
  const muted = sfx.isMuted();
  muteBtn.textContent = muted ? "🔇" : "🔊";
  muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
}

muteBtn.addEventListener("click", function () {
  sfx.unlock();
  sfx.toggleMute();
  updateMuteButton();
  if (!sfx.isMuted()) sfx.playHop(); // tiny audible confirmation
});

updateMuteButton();

/* Unlock the AudioContext on the first user gesture (autoplay policy). */
document.addEventListener("pointerdown", function unlockOnce() {
  sfx.unlock();
  document.removeEventListener("pointerdown", unlockOnce);
}, { once: true });

copyCodeBtn.addEventListener("click", function () {
  const code = currentRoom?.code;
  if (!code) return;
  navigator.clipboard.writeText(code).then(function () {
    showToast("Room code copied!");
  }).catch(function () {
    showToast(code);
  });
});

rematchBtn.addEventListener("click", async function () {
  try { await requestRematch(); } catch (e) { console.error(e); notifyError(e.message); }
});

leaveBtn.addEventListener("click", function () {
  leaveToLobby();
});

leaveRoomBtn.addEventListener("click", async function () {
  try { await leaveRoom(); } catch (e) { console.error(e); notifyError(e.message); leaveToLobby(); }
});

/* ── Local mode, theme, stats controls ── */

localPlayBtn.addEventListener("click", function () {
  sfx.unlock();
  openLocalSetup();
});

lsPlayersEl.addEventListener("change", buildSeatRows);
lsStartBtn.addEventListener("click", function () {
  try { startLocalGame(); } catch (e) { console.error(e); notifyError(e.message); }
});
lsCancelBtn.addEventListener("click", function () {
  localSetupEl.classList.add("hidden");
});

themeBtn.addEventListener("click", cycleTheme);
themeBtnGame.addEventListener("click", cycleTheme);

statsBtn.addEventListener("click", openStats);
statsCloseBtn.addEventListener("click", function () {
  statsOverlayEl.classList.add("hidden");
});
statsClearBtn.addEventListener("click", function () {
  stats.clearStats();
  openStats();
});

boot();
