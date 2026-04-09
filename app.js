import { boards } from "./boards.js";
import { supabase, ensureSignedIn, getCurrentUser } from "./supabase.js";

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
const newGameBtn = document.getElementById("newGameBtn");
const copyCodeBtn = document.getElementById("copyCodeBtn");

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

const DICE_FACES = ["", "\u2680", "\u2681", "\u2682", "\u2683", "\u2684", "\u2685"];

/* ── Board helpers (unchanged) ── */

function getCellNumber(rowFromTop, col) {
  const rowFromBottom = 9 - rowFromTop;
  const rowStart = rowFromBottom * 10 + 1;
  return rowFromBottom % 2 === 0 ? rowStart + col : rowStart + (9 - col);
}

function getBoardPosition(square) {
  const zeroBased = square - 1;
  const rowFromBottom = Math.floor(zeroBased / 10);
  const colInRow = zeroBased % 10;
  const col = rowFromBottom % 2 === 0 ? colInRow : 9 - colInRow;
  return { rowFromBottom, col };
}

function isHorizontalJump(from, to) {
  return getBoardPosition(from).rowFromBottom === getBoardPosition(to).rowFromBottom;
}

function validateBoardSet() {
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

/* ── Utilities (unchanged) ── */

function logMessage(message) {
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = message;
  logEl.prepend(entry);
}

function cryptoRandomInt(min, max) {
  const range = max - min + 1;
  const maxUint32 = 0x100000000;
  const limit = maxUint32 - (maxUint32 % range);
  const buffer = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return min + (value % range);
}

function randomBoard() {
  return boards[cryptoRandomInt(0, boards.length - 1)];
}

function generateRoomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += chars[cryptoRandomInt(0, chars.length - 1)];
  }
  return code;
}

function findBoardById(boardId) {
  return boards.find(function (b) { return b.id === boardId; }) ?? boards[0];
}

function setButtonsDisabled(disabled) {
  createRoomBtn.disabled = disabled;
  joinRoomBtn.disabled = disabled;
  refreshRoomBtn.disabled = disabled;
}

/* ── UI helpers (NEW) ── */

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

function animateDice(value) {
  diceCharEl.textContent = DICE_FACES[value] || "?";
  diceEl.classList.remove("rolling");
  void diceEl.offsetWidth; /* force reflow */
  diceEl.classList.add("rolling");
}

/* ── Rendering (updated) ── */

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
        tag.className = "cell-tag win-tag";
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
          if (color === "black" && p1Pos !== prevP1Pos) tk.classList.add("bounce");
          if (color === "white" && p2Pos !== prevP2Pos) tk.classList.add("bounce");
          wrap.appendChild(tk);
        });
        cell.appendChild(wrap);
      }

      boardEl.appendChild(cell);
    }
  }

  prevP1Pos = p1Pos;
  prevP2Pos = p2Pos;
}

function updateUI() {
  renderBoard();

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
  var p1 = currentPlayers.find(function (p) { return p.role === "player1"; });
  var p2 = currentPlayers.find(function (p) { return p.role === "player2"; });

  p1NameEl.textContent = p1?.player_name ?? "Player 1";
  p2NameEl.textContent = p2?.player_name ?? "Waiting\u2026";
  p1PosEl.textContent = currentGame ? "Sq " + (currentGame.player1_position || 0) : "Start";
  p2PosEl.textContent = currentGame && p2 ? "Sq " + (currentGame.player2_position || 0) : "\u2014";

  var isMyTurn =
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
    var wp = currentPlayers.find(function (p) { return p.role === currentGame.winner; });
    turnTextEl.textContent = (wp?.player_name ?? currentGame.winner) + " wins!";
    turnBannerEl.classList.add("state-win");
    winMessageEl.textContent = (wp?.player_name ?? currentGame.winner) + " reached square 100!";
    winOverlayEl.classList.remove("hidden");
  } else if (currentPlayers.length < 2) {
    turnTextEl.textContent = "Waiting for opponent\u2026";
    turnBannerEl.classList.add("state-wait");
  } else if (isMyTurn) {
    turnTextEl.textContent = "Your turn \u2014 roll the dice!";
    turnBannerEl.classList.add("state-go");
  } else {
    var opp = currentPlayers.find(function (p) { return p.role === currentGame?.current_turn; });
    turnTextEl.textContent = "Waiting for " + (opp?.player_name ?? "opponent") + "\u2026";
    turnBannerEl.classList.add("state-wait");
  }

  /* Roll button */
  if (rollDiceBtn) {
    rollDiceBtn.disabled = !isMyTurn;
    rollDiceBtn.classList.toggle("pulse", !!isMyTurn);
  }
}

/* ── Room creation (logic unchanged) ── */

async function createUniqueRoomCode() {
  for (let i = 0; i < 10; i += 1) {
    const code = generateRoomCode();
    const { data, error } = await supabase
      .from("rooms")
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (error) throw new Error("Room code check failed: " + error.message);
    if (!data) return code;
  }
  throw new Error("Could not generate a unique room code.");
}

async function createRoom() {
  const playerName = playerNameInput.value.trim();
  if (!playerName) { alert("Enter a player name first."); return; }
  if (!currentUser?.id) throw new Error("No authenticated user found.");

  setButtonsDisabled(true);

  try {
    const code = await createUniqueRoomCode();
    const board = randomBoard();
    const roomId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();

    const roomPayload = {
      id: roomId,
      code: code,
      created_by: currentUser.id,
      status: "waiting"
    };

    const membershipPayload = {
      id: membershipId,
      room_id: roomId,
      user_id: currentUser.id,
      player_name: playerName,
      role: "player1"
    };

    const { error: roomError } = await supabase.from("rooms").insert(roomPayload);
    if (roomError) throw new Error("Room creation failed: " + roomError.message);

    const { error: membershipError } = await supabase.from("room_players").insert(membershipPayload);
    if (membershipError) {
      await supabase.from("rooms").delete().eq("id", roomId);
      throw new Error("Membership creation failed: " + membershipError.message);
    }

    const { data: game, error: gameError } = await supabase
      .from("games")
      .insert({
        room_id: roomId,
        board_id: board.id,
        current_turn: "player1",
        player1_position: 0,
        player2_position: 0
      })
      .select()
      .single();

    if (gameError) {
      await supabase.from("room_players").delete().eq("id", membershipId);
      await supabase.from("rooms").delete().eq("id", roomId);
      throw new Error("Game creation failed: " + gameError.message);
    }

    if (!game) throw new Error("Game creation returned no data.");

    currentRoom = roomPayload;
    currentMembership = Object.assign({}, membershipPayload, {
      joined_at: new Date().toISOString()
    });
    currentGame = game;
    currentPlayers = [currentMembership];

    logMessage("Created room " + code + " as player1 on " + board.name + ".");
    showToast("Room " + code + " created!");
    showGameScreen();
    subscribeToRoom(roomId);
  } finally {
    setButtonsDisabled(false);
    updateUI();
  }
}

/* ── Join room (logic unchanged) ── */

async function joinRoom() {
  const playerName = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!playerName) { alert("Enter a player name first."); return; }
  if (!code) { alert("Enter a room code."); return; }
  if (!currentUser?.id) throw new Error("No authenticated user found.");

  setButtonsDisabled(true);

  try {
    const { data: room, error: roomError } = await supabase
      .from("rooms").select("*").eq("code", code).maybeSingle();
    if (roomError) throw new Error("Room lookup failed: " + roomError.message);
    if (!room) throw new Error("No room found with code " + code + ".");
    if (room.status !== "waiting") throw new Error("This room is no longer accepting players.");

    const { data: players, error: playersError } = await supabase
      .from("room_players").select("*").eq("room_id", room.id);
    if (playersError) throw new Error("Players lookup failed: " + playersError.message);
    const safePlayers = Array.isArray(players) ? players : [];

    const existing = safePlayers.find(function (p) { return p.user_id === currentUser.id; });
    if (existing) {
      currentRoom = room;
      currentMembership = existing;
      currentPlayers = safePlayers;
      logMessage("Rejoined room " + code + " as " + existing.role + ".");
      showToast("Rejoined room " + code);
      showGameScreen();
      subscribeToRoom(room.id);
      await loadRoomState(code);
      return;
    }

    if (safePlayers.length >= 2) throw new Error("Room is full.");

    const takenRoles = safePlayers.map(function (p) { return p.role; });
    const role = takenRoles.includes("player1") ? "player2" : "player1";

    const membershipId = crypto.randomUUID();
    const { error: membershipError } = await supabase
      .from("room_players")
      .insert({
        id: membershipId,
        room_id: room.id,
        user_id: currentUser.id,
        player_name: playerName,
        role: role
      });
    if (membershipError) throw new Error("Could not join room: " + membershipError.message);

    if (safePlayers.length === 1) {
      await supabase.from("rooms").update({ status: "playing" }).eq("id", room.id);
    }

    currentRoom = room;
    currentMembership = {
      id: membershipId,
      room_id: room.id,
      user_id: currentUser.id,
      player_name: playerName,
      role: role
    };

    logMessage("Joined room " + code + " as " + role + ".");
    showToast("Joined as " + role);
    showGameScreen();
    await loadRoomState(code);
  } finally {
    setButtonsDisabled(false);
    updateUI();
  }
}

/* ── Dice roll (logic unchanged, animation added) ── */

async function rollDice() {
  if (!currentRoom) { alert("Join a room first."); return; }
  if (!currentGame) { alert("Game data not loaded. Try clicking Refresh."); return; }
  if (!currentMembership) { alert("Player membership not found. Try refreshing the page."); return; }

  if (rollDiceBtn) rollDiceBtn.disabled = true;
  setButtonsDisabled(true);

  try {
    /* Re-fetch latest game state before rolling */
    const { data: freshGame, error: gameRefetchError } = await supabase
      .from("games").select("*").eq("id", currentGame.id).maybeSingle();
    if (gameRefetchError) throw new Error("Could not verify game state: " + gameRefetchError.message);
    if (!freshGame) throw new Error("Game no longer exists. Try refreshing the room.");
    currentGame = freshGame;

    const { data: freshPlayers, error: playersRefetchError } = await supabase
      .from("room_players").select("*").eq("room_id", currentRoom.id);
    if (!playersRefetchError && Array.isArray(freshPlayers)) currentPlayers = freshPlayers;

    /* Re-validate against fresh data */
    if (currentGame.winner) { logMessage("Game is already over."); return; }
    if (currentPlayers.length < 2) { logMessage("Waiting for player 2 to join."); return; }
    if (currentMembership.role !== currentGame.current_turn) {
      logMessage("Not your turn. Current turn: " + currentGame.current_turn);
      return;
    }

    /* Compute roll */
    const roll = cryptoRandomInt(1, 6);
    animateDice(roll);

    const board = findBoardById(currentGame.board_id);
    const posKey = currentMembership.role === "player1" ? "player1_position" : "player2_position";
    const currentPos = currentGame[posKey] ?? 0;
    let newPos = currentPos + roll;
    const nextTurn = currentGame.current_turn === "player1" ? "player2" : "player1";

    /* Must land exactly on 100 */
    if (newPos > 100) {
      var bounceMsg = "Rolled " + roll + " \u2014 need exactly " + (100 - currentPos) + " to win. Stay at " + currentPos + ".";
      logMessage(bounceMsg);
      showToast(bounceMsg);

      const { error } = await supabase
        .from("games")
        .update({ last_roll: roll, current_turn: nextTurn })
        .eq("id", currentGame.id);
      if (error) throw new Error("Update failed: " + error.message);

      currentGame.last_roll = roll;
      currentGame.current_turn = nextTurn;
      return;
    }

    /* Check for snake or ladder */
    const jumpTarget = board.jumps[newPos];

    if (jumpTarget) {
      const jumpType = jumpTarget > newPos ? "Ladder" : "Snake";
      var jumpMsg = "Rolled " + roll + ". " + jumpType + "! " + newPos + " \u2192 " + jumpTarget;
      logMessage(jumpMsg);
      showToast(jumpMsg);
      newPos = jumpTarget;
    } else {
      var moveMsg = "Rolled " + roll + ". Moved " + currentPos + " \u2192 " + newPos;
      logMessage(moveMsg);
      showToast(moveMsg);
    }

    /* Build update */
    const winner = newPos === 100 ? currentMembership.role : null;
    const updatePayload = {
      [posKey]: newPos,
      last_roll: roll,
      current_turn: winner ? currentGame.current_turn : nextTurn
    };
    if (winner) updatePayload.winner = winner;

    const { error } = await supabase
      .from("games")
      .update(updatePayload)
      .eq("id", currentGame.id);
    if (error) throw new Error("Update failed: " + error.message);

    /* Optimistic local state */
    currentGame[posKey] = newPos;
    currentGame.last_roll = roll;
    currentGame.current_turn = updatePayload.current_turn;

    if (winner) {
      currentGame.winner = winner;
      const winnerPlayer = currentPlayers.find(function (p) { return p.role === winner; });
      logMessage((winnerPlayer?.player_name ?? winner) + " wins the game!");
    }
  } finally {
    setButtonsDisabled(false);
    updateUI();
  }
}

/* ── Realtime subscriptions (updated with dice animation) ── */

function subscribeToRoom(roomId) {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = supabase
    .channel("room-" + roomId)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "games",
        filter: "room_id=eq." + roomId
      },
      function (payload) {
        if (payload.new) {
          var prevRoll = currentGame ? currentGame.last_roll : null;
          currentGame = payload.new;
          if (currentGame.last_roll && currentGame.last_roll !== prevRoll) {
            animateDice(currentGame.last_roll);
          }
          logMessage("Game updated (roll: " + (currentGame.last_roll ?? "-") + ").");
          updateUI();
        }
      }
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
          var exists = currentPlayers.find(function (p) { return p.id === payload.new.id; });
          if (!exists) {
            currentPlayers.push(payload.new);
            logMessage(payload.new.player_name + " joined as " + payload.new.role + ".");
            showToast(payload.new.player_name + " joined!");
            updateUI();
          }
        }
      }
    )
    .subscribe(function (status) {
      if (status === "SUBSCRIBED") {
        logMessage("Realtime connected.");
      }
    });
}

/* ── Load room state (unchanged) ── */

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

  subscribeToRoom(room.id);
  logMessage("Loaded room " + room.code + ".");
  updateUI();
}

/* ── Boot (unchanged) ── */

async function boot() {
  try {
    validateBoardSet();
    await ensureSignedIn();
    currentUser = await getCurrentUser();
    if (!currentUser?.id) throw new Error("Anonymous sign-in succeeded but no user was returned.");

    authStatusEl.textContent = "Connected \u2022 " + currentUser.id.slice(0, 8) + "\u2026";
    logMessage("Supabase session ready.");
    updateUI();
  } catch (error) {
    console.error(error);
    authStatusEl.textContent = "Connection failed \u2014 check Supabase config.";
    logMessage("Boot error: " + error.message);
  }
}

/* ── Event listeners ── */

createRoomBtn.addEventListener("click", async function () {
  try { await createRoom(); } catch (e) { console.error(e); logMessage("Error: " + e.message); alert(e.message); }
});

joinRoomBtn.addEventListener("click", async function () {
  try { await joinRoom(); } catch (e) { console.error(e); logMessage("Error: " + e.message); alert(e.message); }
});

refreshRoomBtn.addEventListener("click", async function () {
  try {
    var code = currentRoom?.code || roomCodeInput.value.trim().toUpperCase();
    if (!code) { alert("No room code available."); return; }
    await loadRoomState(code);
  } catch (e) { console.error(e); logMessage("Error: " + e.message); alert(e.message); }
});

rollDiceBtn.addEventListener("click", async function () {
  try { await rollDice(); } catch (e) { console.error(e); logMessage("Error: " + e.message); alert(e.message); }
});

copyCodeBtn.addEventListener("click", function () {
  var code = currentRoom?.code;
  if (!code) return;
  navigator.clipboard.writeText(code).then(function () {
    showToast("Room code copied!");
  }).catch(function () {
    showToast(code);
  });
});

newGameBtn.addEventListener("click", function () {
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
  diceCharEl.textContent = "?";
  lastActionEl.textContent = "Roll to start";
  logEl.innerHTML = "";
  winOverlayEl.classList.add("hidden");
  gameScreenEl.classList.add("hidden");
  lobbyEl.classList.remove("hidden");
});

boot();