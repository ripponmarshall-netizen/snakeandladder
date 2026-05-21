import { boards } from "./boards.js";
import { supabase, ensureSignedIn, getCurrentUser } from "./supabase.js";
import { getCellNumber, cellToSVG, resolveMove, validateBoardSet } from "./gameLogic.js";

/* ── DOM refs ── */

const boardEl = document.getElementById("board");
const authStatusEl = document.getElementById("authStatus");
const playerNameInput = document.getElementById("playerName");
const roomCodeInput = document.getElementById("roomCodeInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const refreshRoomBtn = document.getElementById("refreshRoomBtn");
const rollDiceBtn = document.getElementById("rollDiceBtn");
const logEl = document.getElementById("log");

const lobbyEl = document.getElementById("lobby");
const gameScreenEl = document.getElementById("gameScreen");
const roomCodeDisplayEl = document.getElementById("roomCodeDisplay");
const boardNameEl = document.getElementById("boardName");

const p1Card = document.getElementById("p1Card");
const p2Card = document.getElementById("p2Card");
const p1NameEl = document.getElementById("p1Name");
const p2NameEl = document.getElementById("p2Name");
const p1PosEl = document.getElementById("p1Pos");
const p2PosEl = document.getElementById("p2Pos");

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
const p1OnlineEl = document.getElementById("p1Online");
const p2OnlineEl = document.getElementById("p2Online");

/* ── State ── */

let currentUser = null;
let currentRoom = null;
let currentMembership = null;
let currentGame = null;
let currentPlayers = [];
let realtimeChannel = null;
let toastTimer = null;
let prevP1Pos = 0;
let prevP2Pos = 0;
let animateMoves = false;
let presenceState = {};
let opponentOnline = false;

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

  /* [SNAKE TEXTURE] Layered body group for refined depth */
  const g = document.createElementNS(NS, "g");

  /* Soft shadow — adds subtle depth behind the body */
  const shadow = document.createElementNS(NS, "path");
  shadow.setAttribute("d", d);
  shadow.setAttribute("stroke", "#b33030");
  shadow.setAttribute("stroke-width", "2.6");
  shadow.setAttribute("fill", "none");
  shadow.setAttribute("opacity", "0.12");
  shadow.setAttribute("stroke-linecap", "round");
  g.appendChild(shadow);

  /* Main body stroke */
  const body = document.createElementNS(NS, "path");
  body.setAttribute("d", d);
  body.setAttribute("stroke", "#e25555");
  body.setAttribute("stroke-width", "1.6");
  body.setAttribute("fill", "none");
  body.setAttribute("opacity", "0.5");
  body.setAttribute("stroke-linecap", "round");
  g.appendChild(body);

  /* Scale pattern — dashed overlay for gentle patterning */
  const scales = document.createElementNS(NS, "path");
  scales.setAttribute("d", d);
  scales.setAttribute("stroke", "#c04040");
  scales.setAttribute("stroke-width", "0.9");
  scales.setAttribute("fill", "none");
  scales.setAttribute("opacity", "0.18");
  scales.setAttribute("stroke-linecap", "round");
  scales.setAttribute("stroke-dasharray", "1.2 2.8");
  g.appendChild(scales);

  /* Highlight — lighter line for shading contour */
  const hl = document.createElementNS(NS, "path");
  hl.setAttribute("d", d);
  hl.setAttribute("stroke", "#ff9999");
  hl.setAttribute("stroke-width", "0.4");
  hl.setAttribute("fill", "none");
  hl.setAttribute("opacity", "0.2");
  hl.setAttribute("stroke-linecap", "round");
  g.appendChild(hl);

  svg.appendChild(g);

  /* [SNAKE HEAD] 3D head with shadow and highlight */
  const headG = document.createElementNS(NS, "g");

  const headShadow = document.createElementNS(NS, "circle");
  headShadow.setAttribute("cx", (start.x + 0.3).toFixed(1));
  headShadow.setAttribute("cy", (start.y + 0.3).toFixed(1));
  headShadow.setAttribute("r", "2.0");
  headShadow.setAttribute("fill", "#8b1a1a");
  headShadow.setAttribute("opacity", "0.18");
  headG.appendChild(headShadow);

  const head = document.createElementNS(NS, "circle");
  head.setAttribute("cx", start.x.toFixed(1));
  head.setAttribute("cy", start.y.toFixed(1));
  head.setAttribute("r", "1.8");
  head.setAttribute("fill", "#dc2626");
  head.setAttribute("opacity", "0.6");
  headG.appendChild(head);

  const headHL = document.createElementNS(NS, "circle");
  headHL.setAttribute("cx", (start.x - 0.4).toFixed(1));
  headHL.setAttribute("cy", (start.y - 0.4).toFixed(1));
  headHL.setAttribute("r", "0.55");
  headHL.setAttribute("fill", "#ff9999");
  headHL.setAttribute("opacity", "0.35");
  headG.appendChild(headHL);

  svg.appendChild(headG);

  /* Tail taper */
  const tail = document.createElementNS(NS, "circle");
  tail.setAttribute("cx", end.x.toFixed(1));
  tail.setAttribute("cy", end.y.toFixed(1));
  tail.setAttribute("r", "0.7");
  tail.setAttribute("fill", "#e25555");
  tail.setAttribute("opacity", "0.3");
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
  g.setAttribute("opacity", "0.5");

  for (let s = -1; s <= 1; s += 2) {
    const rail = document.createElementNS(NS, "line");
    rail.setAttribute("x1", (start.x + px * off * s).toFixed(1));
    rail.setAttribute("y1", (start.y + py * off * s).toFixed(1));
    rail.setAttribute("x2", (end.x + px * off * s).toFixed(1));
    rail.setAttribute("y2", (end.y + py * off * s).toFixed(1));
    rail.setAttribute("stroke", "#22a352");
    rail.setAttribute("stroke-width", "0.9");
    rail.setAttribute("stroke-linecap", "round");
    g.appendChild(rail);
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
    rung.setAttribute("stroke", "#22a352");
    rung.setAttribute("stroke-width", "0.7");
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

function animateDice(value) {
  diceCharEl.textContent = DICE_FACES[value] || "?";
  diceEl.classList.remove("rolling");
  void diceEl.offsetWidth;
  diceEl.classList.add("rolling");
}

/* Shake the dice for immediate feedback while the server resolves the roll. */
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
      /* Parabolic arc: peaks at midpoint, 6px height */
      const arc = -6 * Math.sin(t * Math.PI);

      el.style.left = (startLeft + dLeft * ease) + "px";
      el.style.top = (startTop + dTop * ease + arc) + "px";

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        el.style.left = targetLeft + "px";
        el.style.top = targetTop + "px";
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

/* [LADDER/SNAKE TRAVERSAL] Smooth slide with subtle scale pulse */
function slideTo(el, targetLeft, targetTop, duration) {
  return new Promise(function (resolve) {
    const startLeft = parseFloat(el.style.left) || 0;
    const startTop = parseFloat(el.style.top) || 0;
    const dLeft = targetLeft - startLeft;
    const dTop = targetTop - startTop;
    const startTime = performance.now();

    function frame(now) {
      const t = Math.min((now - startTime) / duration, 1);
      /* Quartic ease-out: fast start, smooth settle */
      const ease = 1 - Math.pow(1 - t, 4);
      /* Gentle scale pulse during traversal */
      const scale = 1 + 0.12 * Math.sin(t * Math.PI);

      el.style.left = (startLeft + dLeft * ease) + "px";
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

function hideRealToken(square, color) {
  const cell = boardEl.querySelector("[data-square='" + square + "']");
  if (!cell) return;
  const token = cell.querySelector(".token." + color);
  if (token) token.style.opacity = "0";
}

function showRealToken(square, color) {
  const cell = boardEl.querySelector("[data-square='" + square + "']");
  if (!cell) return;
  const token = cell.querySelector(".token." + color);
  if (token) {
    token.style.opacity = "1";
    /* Re-trigger landing bounce for satisfying arrival */
    token.classList.remove("bounce");
    void token.offsetWidth;
    token.classList.add("bounce");
  }
}

async function animateTokenMove(fromSquare, toSquare, color) {
  /* [ACCESSIBILITY] Respect reduced-motion preference */
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    showRealToken(toSquare, color);
    return;
  }

  /* Skip animation for winning move (let overlay take focus) */
  if (currentGame?.winner) {
    showRealToken(toSquare, color);
    return;
  }

  /* Clean up any existing ghost from a previous animation */
  if (activeGhost) {
    activeGhost.remove();
    activeGhost = null;
  }

  const frameEl = boardEl.closest(".board-frame");
  if (!frameEl) { showRealToken(toSquare, color); return; }

  const board = findBoardById(currentGame?.board_id ?? boards[0].id);
  const roll = currentGame?.last_roll ?? 0;

  /* Reuse the shared resolver so the animation matches the authoritative move. */
  const move = resolveMove(fromSquare, roll, board.jumps);
  const rawLanding = move.landing;

  /* Bounce case: player stays in place, no movement to animate */
  if (move.bounced) {
    showRealToken(toSquare, color);
    return;
  }

  const hasJump = move.jumpType !== null;
  const isLadder = move.jumpType === "ladder";

  /* Create ghost token at start position */
  const ghost = document.createElement("div");
  ghost.className = "ghost-token " + color;
  frameEl.appendChild(ghost);
  activeGhost = ghost;

  const startPos = getSquareTokenPos(fromSquare);
  if (!startPos) {
    ghost.remove();
    activeGhost = null;
    showRealToken(toSquare, color);
    return;
  }

  ghost.style.left = startPos.left + "px";
  ghost.style.top = startPos.top + "px";

  /* Wait one frame so the initial position renders before animation */
  await new Promise(function (r) { requestAnimationFrame(r); });
  if (activeGhost !== ghost) return;

  /* Phase 1: Hop tile-by-tile to the landing square */
  for (let sq = fromSquare + 1; sq <= rawLanding; sq++) {
    const target = getSquareTokenPos(sq);
    if (!target || activeGhost !== ghost) break;
    await hopTo(ghost, target.left, target.top, 260);
  }

  /* Phase 2: [LADDER TRAVERSAL / SNAKE DESCENT] distinct from normal hops */
  if (hasJump && activeGhost === ghost) {
    /* Brief pause at the junction for visual clarity */
    await new Promise(function (r) { setTimeout(r, 80); });
    if (activeGhost !== ghost) return;

    ghost.classList.add(isLadder ? "climb-glow" : "descend-glow");
    const jumpTarget = getSquareTokenPos(toSquare);
    if (jumpTarget) {
      await slideTo(ghost, jumpTarget.left, jumpTarget.top, isLadder ? 420 : 380);
    }
  }

  /* Remove ghost and reveal real token */
  if (activeGhost === ghost) {
    ghost.remove();
    activeGhost = null;
  }
  showRealToken(toSquare, color);
}

/* ═══════════════════ END ANIMATION SYSTEM ═══════════════════ */

/* ── Rendering ── */

function renderBoard() {
  boardEl.innerHTML = "";

  const board = findBoardById(currentGame?.board_id ?? boards[0].id);
  const jumps = board.jumps;
  const p1Pos = currentGame?.player1_position ?? 0;
  const p2Pos = currentGame?.player2_position ?? 0;

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

      const here = [];
      if (p1Pos === number) here.push("black");
      if (p2Pos === number) here.push("white");

      if (here.length) {
        const wrap = document.createElement("div");
        wrap.className = "tokens";
        here.forEach(function (color) {
          const tk = document.createElement("div");
          tk.className = "token " + color;
          if (animateMoves) {
            if (color === "black" && p1Pos !== prevP1Pos) tk.classList.add("bounce");
            if (color === "white" && p2Pos !== prevP2Pos) tk.classList.add("bounce");
          }
          wrap.appendChild(tk);
        });
        cell.appendChild(wrap);
      }

      boardEl.appendChild(cell);
    }
  }

  prevP1Pos = p1Pos;
  prevP2Pos = p2Pos;
  animateMoves = false;

  renderOverlay();
}

function updateUI() {
  /* ── [PIECE HOP] Capture pre-render positions for animation ── */
  const shouldAnimate = animateMoves;
  const oldP1 = prevP1Pos;
  const oldP2 = prevP2Pos;
  const newP1 = currentGame?.player1_position ?? 0;
  const newP2 = currentGame?.player2_position ?? 0;

  renderBoard();

  /* ── [PIECE HOP] Hide destination tokens during ghost animation ── */
  if (shouldAnimate) {
    if (oldP1 !== newP1 && oldP1 > 0 && newP1 > 0) hideRealToken(newP1, "black");
    if (oldP2 !== newP2 && oldP2 > 0 && newP2 > 0) hideRealToken(newP2, "white");
  }

  /* Board name */
  boardNameEl.textContent = currentGame
    ? findBoardById(currentGame.board_id).name
    : "\u2014";

  /* Room code */
  roomCodeDisplayEl.textContent = currentRoom?.code ?? "------";

  /* Dice display */
  if (currentGame?.last_roll) {
    diceCharEl.textContent = DICE_FACES[currentGame.last_roll] || "?";
    lastActionEl.textContent = "Rolled " + currentGame.last_roll;
  }

  /* Player cards */
  const p1 = currentPlayers.find(function (p) { return p.role === "player1"; });
  const p2 = currentPlayers.find(function (p) { return p.role === "player2"; });

  p1NameEl.textContent = p1?.player_name ?? "Player 1";
  p2NameEl.textContent = p2?.player_name ?? "Waiting\u2026";
  p1PosEl.textContent = currentGame ? "Sq " + (currentGame.player1_position || 0) : "Start";
  p2PosEl.textContent = currentGame && p2 ? "Sq " + (currentGame.player2_position || 0) : "\u2014";

  const isMyTurn =
    currentGame &&
    !currentGame.winner &&
    currentPlayers.length === 2 &&
    currentMembership?.role === currentGame.current_turn;

  /* Active card highlight */
  p1Card.classList.toggle("active", currentGame?.current_turn === "player1" && !currentGame?.winner);
  p2Card.classList.toggle("active", currentGame?.current_turn === "player2" && !currentGame?.winner);

  /* Turn banner */
  turnBannerEl.classList.remove("state-go", "state-wait", "state-win");

  if (currentGame?.winner) {
    const wp = currentPlayers.find(function (p) { return p.role === currentGame.winner; });
    const winnerName = wp?.player_name ?? currentGame.winner;
    const winnerPos = currentGame.winner === "player1"
      ? currentGame.player1_position
      : currentGame.player2_position;
    turnTextEl.textContent = winnerName + " wins!";
    turnBannerEl.classList.add("state-win");
    winMessageEl.textContent = winnerPos === 100
      ? winnerName + " reached square 100!"
      : winnerName + " wins \u2014 opponent left the game.";
    winOverlayEl.classList.remove("hidden");
  } else {
    /* No winner: keep the overlay hidden (covers rematch resets). */
    winOverlayEl.classList.add("hidden");
    if (currentPlayers.length < 2) {
      turnTextEl.textContent = "Waiting for opponent\u2026";
      turnBannerEl.classList.add("state-wait");
    } else if (isMyTurn) {
      turnTextEl.textContent = "Your turn \u2014 roll the dice!";
      turnBannerEl.classList.add("state-go");
    } else {
      const opp = currentPlayers.find(function (p) { return p.role === currentGame?.current_turn; });
      turnTextEl.textContent = "Waiting for " + (opp?.player_name ?? "opponent") + "\u2026";
      turnBannerEl.classList.add("state-wait");
    }
  }

  /* Roll button */
  if (rollDiceBtn) {
    const canRoll = !!isMyTurn;
    rollDiceBtn.disabled = !canRoll;
    rollDiceBtn.classList.toggle("pulse", canRoll);

    if (currentGame?.winner) {
      rollDiceBtn.textContent = "Game Over";
    } else if (canRoll) {
      rollDiceBtn.textContent = "Roll";
    } else {
      rollDiceBtn.textContent = "Waiting\u2026";
    }
  }

  /* Dice highlight */
  diceEl.classList.toggle("your-turn", !!isMyTurn);

  /* ── [PIECE HOP / LADDER / SNAKE TRAVERSAL] Fire movement animations ── */
  if (shouldAnimate) {
    if (oldP1 !== newP1 && oldP1 > 0 && newP1 > 0) animateTokenMove(oldP1, newP1, "black");
    if (oldP2 !== newP2 && oldP2 > 0 && newP2 > 0) animateTokenMove(oldP2, newP2, "white");
  }
}

/* ── Room creation ── */

async function createRoom() {
  const playerName = playerNameInput.value.trim();
  if (!playerName) { notifyError("Enter a player name first."); return; }
  if (!currentUser?.id) { notifyError("Still connecting — try again in a moment."); return; }

  setButtonsDisabled(true);
  try {
    /* Atomic server-side create: room + player1 + game, unique code, random board. */
    const { data, error } = await supabase.rpc("create_room", { p_player_name: playerName });
    if (error) { notifyError(errorMessage(error, "Could not create a room.")); return; }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.room_code) { notifyError("Room creation returned no data."); return; }

    logMessage("Created room " + row.room_code + " as " + row.assigned_role + ".");
    showToast("Room " + row.room_code + " created!");
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
  if (!currentRoom || !currentGame || !currentMembership) {
    notifyError("Game not ready yet. Try Refresh.");
    return;
  }

  /* Disable immediately and shake the dice for instant feedback while the
     server resolves the roll. The server is the only authority over the move. */
  rollDiceBtn.disabled = true;
  rollDiceBtn.classList.remove("pulse");
  shakeDice();

  const role = currentMembership.role;
  const posKey = role === "player1" ? "player1_position" : "player2_position";
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
  if (!currentRoom) return;
  rematchBtn.disabled = true;
  try {
    const { data, error } = await supabase.rpc("rematch", { p_room_id: currentRoom.id });
    if (error) { notifyError(errorMessage(error, "Could not start a rematch.")); return; }
    const game = Array.isArray(data) ? data[0] : data;
    if (game) {
      currentGame = game;
      prevP1Pos = 0;
      prevP2Pos = 0;
      animateMoves = false;
      winOverlayEl.classList.add("hidden");
      diceCharEl.textContent = "?";
      lastActionEl.textContent = "Roll to start";
      logMessage("Rematch \u2014 new game on " + findBoardById(game.board_id).name + "!");
      updateUI();
    }
  } finally {
    rematchBtn.disabled = false;
  }
}

function leaveToLobby() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  currentRoom = null;
  currentMembership = null;
  currentGame = null;
  currentPlayers = [];
  prevP1Pos = 0;
  prevP2Pos = 0;
  animateMoves = false;
  presenceState = {};
  diceCharEl.textContent = "?";
  lastActionEl.textContent = "Roll to start";
  rollDiceBtn.textContent = "Roll";
  logEl.innerHTML = "";
  winOverlayEl.classList.add("hidden");
  gameScreenEl.classList.add("hidden");
  lobbyEl.classList.remove("hidden");
}

/* Leaving an in-progress game forfeits it (the opponent wins). */
async function leaveRoom() {
  const inProgress = currentGame && !currentGame.winner && currentPlayers.length >= 2;
  if (inProgress) {
    const ok = window.confirm("Leave the game? Your opponent will be awarded the win.");
    if (!ok) return;
    const { error } = await supabase.rpc("forfeit", { p_room_id: currentRoom.id });
    if (error) notifyError(errorMessage(error, "Could not leave cleanly."));
  }
  leaveToLobby();
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
    .on("presence", { event: "sync" }, handlePresenceSync)
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
    incoming.player2_position !== prev.player2_position;
  const isRoll = !isRematch && incoming.last_roll != null &&
    (positionsChanged || (prev && incoming.last_roll !== prev.last_roll && !incoming.winner));

  currentGame = incoming;

  if (isRematch) {
    prevP1Pos = 0;
    prevP2Pos = 0;
    animateMoves = false;
    diceCharEl.textContent = "?";
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
  const oppRole = myRole === "player1" ? "player2" : "player1";
  const oppNowOnline = onlineRoles.has(oppRole);

  if (currentPlayers.length >= 2 && opponentOnline && !oppNowOnline) {
    showToast("Opponent disconnected");
  }
  opponentOnline = oppNowOnline;
  updatePresenceIndicators(onlineRoles);
}

function updatePresenceIndicators(onlineRoles) {
  p1OnlineEl.classList.toggle("online", onlineRoles.has("player1"));
  p2OnlineEl.classList.toggle("online", onlineRoles.has("player2"));
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
  prevP1Pos = currentGame?.player1_position ?? 0;
  prevP2Pos = currentGame?.player2_position ?? 0;

  /* Reset presence baseline; the channel re-tracks on (re)subscribe. */
  presenceState = {};
  opponentOnline = false;

  subscribeToRoom(room.id);
  logMessage("Loaded room " + room.code + ".");
  updateUI();
}

/* ── Boot ── */

async function boot() {
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
  try { await rollDice(); } catch (e) { console.error(e); logMessage("Error: " + e.message); notifyError(e.message); }
});

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

boot();
