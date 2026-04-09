import { boards } from "./boards.js";
import { supabase, ensureSignedIn, getCurrentUser } from "./supabase.js";

const boardEl = document.getElementById("board");
const authStatusEl = document.getElementById("authStatus");
const roomStatusEl = document.getElementById("roomStatus");
const statusEl = document.getElementById("status");
const boardNameEl = document.getElementById("boardName");
const lastRollEl = document.getElementById("lastRoll");
const positionsEl = document.getElementById("positions");
const roomCodeDisplayEl = document.getElementById("roomCodeDisplay");
const roleDisplayEl = document.getElementById("roleDisplay");
const playersDisplayEl = document.getElementById("playersDisplay");
const playerNameInput = document.getElementById("playerName");
const roomCodeInput = document.getElementById("roomCodeInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const refreshRoomBtn = document.getElementById("refreshRoomBtn");
const rollDiceBtn = document.getElementById("rollDiceBtn");
const logEl = document.getElementById("log");

let currentUser = null;
let currentRoom = null;
let currentMembership = null;
let currentGame = null;
let currentPlayers = [];
let realtimeChannel = null;
let gamePollingInterval = null;
let isRolling = false;

/* ── Board helpers ── */

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
        throw new Error(`Board ${board.id}: jump out of range ${from} -> ${to}`);
      }

      if (from === to) {
        throw new Error(`Board ${board.id}: self jump ${from} -> ${to}`);
      }

      if (isHorizontalJump(from, to)) {
        throw new Error(`Board ${board.id}: horizontal jump ${from} -> ${to} is not allowed`);
      }
    }
  }
}

/* ── Utilities ── */

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
  return boards.find(board => board.id === boardId) ?? boards[0];
}

function setButtonsDisabled(disabled) {
  createRoomBtn.disabled = disabled;
  joinRoomBtn.disabled = disabled;
  refreshRoomBtn.disabled = disabled;
  /* rollDiceBtn state is managed exclusively by updateUI() */
}

/* ── Rendering ── */

function renderBoard() {
  boardEl.innerHTML = "";

  const board = findBoardById(currentGame?.board_id ?? boards[0].id);
  const jumps = board.jumps;
  const player1Position = currentGame?.player1_position ?? 0;
  const player2Position = currentGame?.player2_position ?? 0;

  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const number = getCellNumber(row, col);
      const cell = document.createElement("div");
      cell.className = "cell";

      if (jumps[number]) cell.classList.add("has-jump");
      if (number === 1) cell.classList.add("cell-start");
      if (number === 100) cell.classList.add("cell-end");

      const numberEl = document.createElement("div");
      numberEl.className = "cell-number";
      numberEl.textContent = number;
      cell.appendChild(numberEl);

      if (jumps[number]) {
        const jumpEl = document.createElement("div");
        jumpEl.className = "jump-label";
        jumpEl.textContent = jumps[number] > number ? "L\u2192" + jumps[number] : "S\u2192" + jumps[number];
        cell.appendChild(jumpEl);
      }

      const playersHere = [];
      if (player1Position === number) playersHere.push("black");
      if (player2Position === number) playersHere.push("white");

      if (playersHere.length) {
        const tokensEl = document.createElement("div");
        tokensEl.className = "tokens";

        playersHere.forEach(color => {
          const token = document.createElement("div");
          token.className = "token " + color;
          tokensEl.appendChild(token);
        });

        cell.appendChild(tokensEl);
      }

      boardEl.appendChild(cell);
    }
  }
}

function updatePlayersDisplay() {
  if (!currentPlayers.length) {
    playersDisplayEl.textContent = "Players: -";
    return;
  }

  const summary = currentPlayers
    .map(player => player.role + ": " + player.player_name)
    .join(" | ");

  playersDisplayEl.textContent = "Players: " + summary;
}

function updateUI() {
  renderBoard();

  boardNameEl.textContent = "Board: " + (currentGame ? findBoardById(currentGame.board_id).name : "-");
  lastRollEl.textContent = "Last roll: " + (currentGame?.last_roll ?? "-");
  positionsEl.textContent = "Black: " + (currentGame?.player1_position ?? 0) + " | White: " + (currentGame?.player2_position ?? 0);
  roomCodeDisplayEl.textContent = "Room code: " + (currentRoom?.code ?? "-");
  roleDisplayEl.textContent = "Role: " + (currentMembership?.role ?? "-");

  if (currentRoom) {
    roomStatusEl.textContent = "Joined room " + currentRoom.code + ".";
  } else {
    roomStatusEl.textContent = "No room joined.";
  }

  if (currentGame?.winner) {
    const winnerPlayer = currentPlayers.find(function(p) { return p.role === currentGame.winner; });
    statusEl.textContent = (winnerPlayer?.player_name ?? currentGame.winner) + " won the game!";
  } else if (currentGame && currentPlayers.length < 2) {
    statusEl.textContent = "Waiting for player 2 to join\u2026";
  } else if (currentGame) {
    statusEl.textContent = "Current turn: " + currentGame.current_turn;
  } else if (currentRoom) {
    statusEl.textContent = "Game data not loaded \u2014 click Refresh Room.";
  } else {
    statusEl.textContent = "Game not started.";
  }

  /* Enable roll only when it is this player's turn, both present, no winner */
  if (rollDiceBtn) {
    var canRoll =
      currentGame &&
      !currentGame.winner &&
      currentPlayers.length === 2 &&
      currentMembership?.role === currentGame.current_turn;

    rollDiceBtn.disabled = !canRoll;
  }

  updatePlayersDisplay();
}

/* ── Polling fallback for Realtime ── */

function startPolling(roomId) {
  stopPolling();
  gamePollingInterval = setInterval(async function () {
    if (!currentGame || isRolling) return;
    try {
      var { data: game } = await supabase
        .from("games")
        .select("*")
        .eq("room_id", roomId)
        .maybeSingle();
      if (game) {
        currentGame = game;
      }
      var { data: players } = await supabase
        .from("room_players")
        .select("*")
        .eq("room_id", roomId);
      if (Array.isArray(players)) {
        currentPlayers = players;
      }
      updateUI();
    } catch (e) {
      /* silently ignore polling errors */
    }
  }, 3000);
}

function stopPolling() {
  if (gamePollingInterval) {
    clearInterval(gamePollingInterval);
    gamePollingInterval = null;
  }
}

/* ── Room creation ── */

async function createUniqueRoomCode() {
  for (let i = 0; i < 10; i += 1) {
    const code = generateRoomCode();

    const { data, error } = await supabase
      .from("rooms")
      .select("id")
      .eq("code", code)
      .maybeSingle();

    if (error) {
      throw new Error("Room code check failed: " + error.message);
    }

    if (!data) {
      return code;
    }
  }

  throw new Error("Could not generate a unique room code.");
}

async function createRoom() {
  const playerName = playerNameInput.value.trim();

  if (!playerName) {
    alert("Enter a player name first.");
    return;
  }

  if (!currentUser?.id) {
    throw new Error("No authenticated user found.");
  }

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

    /* 1. Insert room */
    const { error: roomError } = await supabase
      .from("rooms")
      .insert(roomPayload);

    if (roomError) {
      throw new Error("Room creation failed: " + roomError.message);
    }

    /* 2. Insert membership (rollback room on failure) */
    const { error: membershipError } = await supabase
      .from("room_players")
      .insert(membershipPayload);

    if (membershipError) {
      await supabase.from("rooms").delete().eq("id", roomId);
      throw new Error("Membership creation failed: " + membershipError.message);
    }

    /* 3. Insert game (rollback room + membership on failure) */
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

    if (!game) {
      throw new Error("Game creation returned no data.");
    }

    currentRoom = roomPayload;
    currentMembership = Object.assign({}, membershipPayload, {
      joined_at: new Date().toISOString()
    });
    currentGame = game;
    currentPlayers = [currentMembership];

    logMessage("Created room " + code + " as player1 on " + board.name + ".");
    subscribeToRoom(roomId);
  } finally {
    setButtonsDisabled(false);
    updateUI();
  }
}

/* ── Join room (client-side, no RPC needed) ── */

async function joinRoom() {
  const playerName = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();

  if (!playerName) {
    alert("Enter a player name first.");
    return;
  }

  if (!code) {
    alert("Enter a room code.");
    return;
  }

  if (!currentUser?.id) {
    throw new Error("No authenticated user found.");
  }

  setButtonsDisabled(true);

  try {
    /* Find room */
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (roomError) {
      throw new Error("Room lookup failed: " + roomError.message);
    }

    if (!room) {
      throw new Error("No room found with code " + code + ".");
    }

    /* Check existing players */
    const { data: players, error: playersError } = await supabase
      .from("room_players")
      .select("*")
      .eq("room_id", room.id);

    if (playersError) {
      throw new Error("Players lookup failed: " + playersError.message);
    }

    const safePlayers = Array.isArray(players) ? players : [];

    /* Already in this room? Rejoin regardless of room status. */
    const existing = safePlayers.find(function(p) { return p.user_id === currentUser.id; });
    if (existing) {
      currentRoom = room;
      currentMembership = existing;
      currentPlayers = safePlayers;
      logMessage("Rejoined room " + code + " as " + existing.role + ".");
      subscribeToRoom(room.id);
      await loadRoomState(code);
      return;
    }

    /* Only enforce status for brand-new joins */
    if (room.status !== "waiting") {
      throw new Error("This room is no longer accepting players.");
    }

    if (safePlayers.length >= 2) {
      throw new Error("Room is full.");
    }

    /* Determine role */
    const takenRoles = safePlayers.map(function(p) { return p.role; });
    const role = takenRoles.includes("player1") ? "player2" : "player1";

    /* Insert membership */
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

    if (membershipError) {
      throw new Error("Could not join room: " + membershipError.message);
    }

    /* Mark room as playing now that both players are in */
    if (safePlayers.length === 1) {
      await supabase
        .from("rooms")
        .update({ status: "playing" })
        .eq("id", room.id);
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
    await loadRoomState(code);
  } finally {
    setButtonsDisabled(false);
    updateUI();
  }
}

/* ── Dice roll ── */

async function rollDice() {
  if (!currentRoom) {
    alert("Join a room first.");
    return;
  }

  if (!currentGame) {
    alert("Game data not loaded. Try clicking Refresh Room.");
    return;
  }

  if (!currentMembership) {
    alert("Player membership not found. Try refreshing the page.");
    return;
  }

  if (rollDiceBtn) rollDiceBtn.disabled = true;
  setButtonsDisabled(true);
  isRolling = true;

  try {
    /* ── Re-fetch latest game state before rolling ── */
    const { data: freshGame, error: gameRefetchError } = await supabase
      .from("games")
      .select("*")
      .eq("id", currentGame.id)
      .maybeSingle();

    if (gameRefetchError) {
      throw new Error("Could not verify game state: " + gameRefetchError.message);
    }

    if (!freshGame) {
      throw new Error("Game no longer exists. Try refreshing the room.");
    }

    currentGame = freshGame;

    /* Re-fetch players to ensure accurate count */
    const { data: freshPlayers, error: playersRefetchError } = await supabase
      .from("room_players")
      .select("*")
      .eq("room_id", currentRoom.id);

    if (!playersRefetchError && Array.isArray(freshPlayers)) {
      currentPlayers = freshPlayers;
    }

    /* ── Re-validate against fresh data ── */
    if (currentGame.winner) {
      logMessage("Game is already over.");
      return;
    }

    if (currentPlayers.length < 2) {
      logMessage("Waiting for player 2 to join.");
      return;
    }

    if (currentMembership.role !== currentGame.current_turn) {
      logMessage("Not your turn. Current turn: " + currentGame.current_turn);
      return;
    }

    /* ── Compute roll ── */
    const roll = cryptoRandomInt(1, 6);
    const board = findBoardById(currentGame.board_id);
    const posKey =
      currentMembership.role === "player1"
        ? "player1_position"
        : "player2_position";

    const currentPos = currentGame[posKey] ?? 0;
    let newPos = currentPos + roll;
    const nextTurn =
      currentGame.current_turn === "player1" ? "player2" : "player1";

    /* Must land exactly on 100 */
    if (newPos > 100) {
      logMessage(
        "Rolled " + roll + " but need exactly " + (100 - currentPos) + " to win. Stay at " + currentPos + "."
      );

      const { data: confirmedGame, error } = await supabase
        .from("games")
        .update({ last_roll: roll, current_turn: nextTurn })
        .eq("id", currentGame.id)
        .select()
        .maybeSingle();

      if (error) throw new Error("Update failed: " + error.message);
      if (!confirmedGame) throw new Error("Dice roll blocked \u2014 check Supabase RLS UPDATE policy on the games table.");

      currentGame = confirmedGame;
      return;
    }

    /* Check for snake or ladder */
    const jumpTarget = board.jumps[newPos];

    if (jumpTarget) {
      const jumpType = jumpTarget > newPos ? "Ladder" : "Snake";
      logMessage(
        "Rolled " + roll + ". Moved to " + newPos + ", hit a " + jumpType + "! Go to " + jumpTarget + "."
      );
      newPos = jumpTarget;
    } else {
      logMessage("Rolled " + roll + ". Moved from " + currentPos + " to " + newPos + ".");
    }

    /* Build update */
    const winner = newPos === 100 ? currentMembership.role : null;
    const updatePayload = {
      [posKey]: newPos,
      last_roll: roll,
      current_turn: winner ? currentGame.current_turn : nextTurn
    };

    if (winner) {
      updatePayload.winner = winner;
    }

    const { data: confirmedGame, error } = await supabase
      .from("games")
      .update(updatePayload)
      .eq("id", currentGame.id)
      .select()
      .maybeSingle();

    if (error) throw new Error("Update failed: " + error.message);
    if (!confirmedGame) throw new Error("Dice roll blocked \u2014 check Supabase RLS UPDATE policy on the games table.");

    currentGame = confirmedGame;

    if (winner) {
      const winnerPlayer = currentPlayers.find(function(p) { return p.role === winner; });
      logMessage((winnerPlayer?.player_name ?? winner) + " wins the game!");
    }
  } finally {
    isRolling = false;
    setButtonsDisabled(false);
    updateUI();
  }
}

/* ── Realtime subscriptions ── */

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
      function(payload) {
        if (payload.new && !isRolling) {
          currentGame = payload.new;
          logMessage("Game state updated.");
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
      function(payload) {
        if (payload.new) {
          var exists = currentPlayers.find(function(p) { return p.id === payload.new.id; });
          if (!exists) {
            currentPlayers.push(payload.new);
            logMessage(
              payload.new.player_name + " joined as " + payload.new.role + "."
            );
            updateUI();
          }
        }
      }
    )
    .subscribe(function(status) {
      if (status === "SUBSCRIBED") {
        logMessage("Realtime connected.");
      }
    });

  /* Polling fallback in case Realtime replication is not enabled */
  startPolling(roomId);
}

/* ── Load room state ── */

async function loadRoomState(roomCode) {
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", roomCode)
    .maybeSingle();

  if (roomError) {
    throw new Error("Room load failed: " + roomError.message);
  }

  if (!room) {
    throw new Error("Room not found.");
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("*")
    .eq("room_id", room.id)
    .maybeSingle();

  if (gameError) {
    throw new Error("Game load failed: " + gameError.message);
  }

  if (!game) {
    console.warn("No game found for room " + roomCode + " (room_id: " + room.id + "). Check RLS SELECT policy on the games table.");
    logMessage("Warning: game data not found for this room. Check Supabase RLS policies on the games table.");
  }

  const { data: players, error: playersError } = await supabase
    .from("room_players")
    .select("*")
    .eq("room_id", room.id);

  if (playersError) {
    throw new Error("Players load failed: " + playersError.message);
  }

  const safePlayers = Array.isArray(players) ? players : [];

  currentRoom = room;
  currentGame = game ?? null;
  currentPlayers = safePlayers;
  currentMembership =
    safePlayers.find(function(player) { return player.user_id === currentUser.id; }) ??
    currentMembership;

  subscribeToRoom(room.id);
  logMessage("Loaded room " + room.code + ".");
  updateUI();
}

/* ── Boot ── */

async function boot() {
  try {
    validateBoardSet();

    await ensureSignedIn();
    currentUser = await getCurrentUser();

    if (!currentUser?.id) {
      throw new Error("Anonymous sign-in succeeded but no user was returned.");
    }

    authStatusEl.textContent = "Signed in anonymously: " + currentUser.id.slice(0, 8) + "\u2026";
    logMessage("Supabase session ready for user " + currentUser.id.slice(0, 8) + "\u2026");

    updateUI();
  } catch (error) {
    console.error(error);
    authStatusEl.textContent = "Supabase connection failed.";
    statusEl.textContent =
      "Check your Supabase URL, anon key, and Anonymous Auth settings.";
    logMessage("Boot error: " + error.message);
  }
}

/* ── Event listeners ── */

createRoomBtn.addEventListener("click", async () => {
  try {
    await createRoom();
  } catch (error) {
    console.error(error);
    logMessage("Create room error: " + error.message);
    alert(error.message);
  }
});

joinRoomBtn.addEventListener("click", async () => {
  try {
    await joinRoom();
  } catch (error) {
    console.error(error);
    logMessage("Join room error: " + error.message);
    alert(error.message);
  }
});

refreshRoomBtn.addEventListener("click", async () => {
  try {
    const code = currentRoom?.code || roomCodeInput.value.trim().toUpperCase();

    if (!code) {
      alert("No room code available.");
      return;
    }

    await loadRoomState(code);
  } catch (error) {
    console.error(error);
    logMessage("Refresh room error: " + error.message);
    alert(error.message);
  }
});

rollDiceBtn.addEventListener("click", async () => {
  try {
    await rollDice();
  } catch (error) {
    console.error(error);
    logMessage("Roll dice error: " + error.message);
    alert(error.message);
  }
});

boot();
