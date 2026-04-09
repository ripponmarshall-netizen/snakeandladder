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
const logEl = document.getElementById("log");

let currentUser = null;
let currentRoom = null;
let currentMembership = null;
let currentGame = null;
let currentPlayers = [];

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
        jumpEl.textContent = jumps[number] > number ? `L→${jumps[number]}` : `S→${jumps[number]}`;
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
          token.className = `token ${color}`;
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
    .map(player => `${player.role}: ${player.player_name}`)
    .join(" | ");

  playersDisplayEl.textContent = `Players: ${summary}`;
}

function updateUI() {
  renderBoard();

  boardNameEl.textContent = `Board: ${currentGame ? findBoardById(currentGame.board_id).name : "-"}`;
  lastRollEl.textContent = `Last roll: ${currentGame?.last_roll ?? "-"}`;
  positionsEl.textContent = `Black: ${currentGame?.player1_position ?? 0} | White: ${currentGame?.player2_position ?? 0}`;
  roomCodeDisplayEl.textContent = `Room code: ${currentRoom?.code ?? "-"}`;
  roleDisplayEl.textContent = `Role: ${currentMembership?.role ?? "-"}`;

  if (currentRoom) {
    roomStatusEl.textContent = `Joined room ${currentRoom.code}.`;
  } else {
    roomStatusEl.textContent = "No room joined.";
  }

  if (currentGame?.winner) {
    statusEl.textContent = `${currentGame.winner} won the game.`;
  } else if (currentGame) {
    statusEl.textContent = `Current turn: ${currentGame.current_turn}`;
  } else {
    statusEl.textContent = "Game not started.";
  }

  updatePlayersDisplay();
}

async function createUniqueRoomCode() {
  for (let i = 0; i < 10; i += 1) {
    const code = generateRoomCode();

    const { data, error } = await supabase
      .from("rooms")
      .select("id")
      .eq("code", code)
      .maybeSingle();

    if (error) throw error;
    if (!data) return code;
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

  const code = await createUniqueRoomCode();
  const board = randomBoard();

  const {  room, error: roomError } = await supabase
    .from("rooms")
    .insert({
      code,
      created_by: currentUser.id,
      status: "waiting"
    })
    .select()
    .single();

  if (roomError) throw roomError;

  const {  membership, error: membershipError } = await supabase
    .from("room_players")
    .insert({
      room_id: room.id,
      user_id: currentUser.id,
      player_name: playerName,
      role: "player1"
    })
    .select()
    .single();

  if (membershipError) throw membershipError;

  const {  game, error: gameError } = await supabase
    .from("games")
    .insert({
      room_id: room.id,
      board_id: board.id,
      current_turn: "player1",
      player1_position: 0,
      player2_position: 0
    })
    .select()
    .single();

  if (gameError) throw gameError;

  currentRoom = room;
  currentMembership = membership;
  currentGame = game;
  currentPlayers = [membership];

  logMessage(`Created room ${room.code} as player1 on ${board.name}.`);
  updateUI();
}

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

  const {  room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .single();

  if (roomError) throw roomError;

  const {  players, error: playersError } = await supabase
    .from("room_players")
    .select("*")
    .eq("room_id", room.id);

  if (playersError) throw playersError;

  const alreadyInRoom = players.find(player => player.user_id === currentUser.id);
  if (alreadyInRoom) {
    currentRoom = room;
    currentMembership = alreadyInRoom;
    currentPlayers = players;
    await loadRoomState(code);
    return;
  }

  if (players.length >= 2) {
    throw new Error("This room is already full.");
  }

  const takenRoles = new Set(players.map(player => player.role));
  const role = takenRoles.has("player1") ? "player2" : "player1";

  const {  membership, error: membershipError } = await supabase
    .from("room_players")
    .insert({
      room_id: room.id,
      user_id: currentUser.id,
      player_name: playerName,
      role
    })
    .select()
    .single();

  if (membershipError) throw membershipError;

  const nextStatus = players.length + 1 >= 2 ? "active" : room.status;

  if (room.created_by === currentUser.id) {
    const { error: roomUpdateError } = await supabase
      .from("rooms")
      .update({ status: nextStatus })
      .eq("id", room.id);

    if (roomUpdateError) throw roomUpdateError;
  }

  currentRoom = { ...room, status: nextStatus };
  currentMembership = membership;
  currentPlayers = [...players, membership];

  logMessage(`Joined room ${room.code} as ${role}.`);
  await loadRoomState(code);
}

async function loadRoomState(roomCode) {
  const {  room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", roomCode)
    .single();

  if (roomError) throw roomError;

  const {  game, error: gameError } = await supabase
    .from("games")
    .select("*")
    .eq("room_id", room.id)
    .single();

  if (gameError) throw gameError;

  const {  players, error: playersError } = await supabase
    .from("room_players")
    .select("*")
    .eq("room_id", room.id);

  if (playersError) throw playersError;

  currentRoom = room;
  currentGame = game;
  currentPlayers = players;
  currentMembership = players.find(player => player.user_id === currentUser.id) ?? null;

  logMessage(`Loaded room ${room.code}.`);
  updateUI();
}

async function boot() {
  try {
    validateBoardSet();

    await ensureSignedIn();
    currentUser = await getCurrentUser();

    if (!currentUser?.id) {
      throw new Error("Anonymous sign-in succeeded but no user was returned.");
    }

    authStatusEl.textContent = `Signed in anonymously: ${currentUser.id.slice(0, 8)}…`;
    logMessage(`Supabase session ready for user ${currentUser.id.slice(0, 8)}…`);

    updateUI();
  } catch (error) {
    console.error(error);
    authStatusEl.textContent = "Supabase connection failed.";
    statusEl.textContent = "Check your Supabase URL, anon key, and Anonymous Auth settings.";
    logMessage(`Boot error: ${error.message}`);
  }
}

createRoomBtn.addEventListener("click", async () => {
  try {
    await createRoom();
  } catch (error) {
    console.error(error);
    logMessage(`Create room error: ${error.message}`);
    alert(error.message);
  }
});

joinRoomBtn.addEventListener("click", async () => {
  try {
    await joinRoom();
  } catch (error) {
    console.error(error);
    logMessage(`Join room error: ${error.message}`);
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
    logMessage(`Refresh room error: ${error.message}`);
    alert(error.message);
  }
});

boot();
