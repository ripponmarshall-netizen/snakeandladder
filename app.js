import { boards } from "./boards.js";
import { ensureSignedIn, getCurrentUser } from "./supabase.js";

const boardEl = document.getElementById("board");
const authStatusEl = document.getElementById("authStatus");
const statusEl = document.getElementById("status");
const boardNameEl = document.getElementById("boardName");
const lastRollEl = document.getElementById("lastRoll");
const positionsEl = document.getElementById("positions");
const logEl = document.getElementById("log");
const rollBtn = document.getElementById("rollBtn");
const resetBtn = document.getElementById("resetBtn");

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

function rollDie() {
  return cryptoRandomInt(1, 6);
}

function randomBoard() {
  return boards[cryptoRandomInt(0, boards.length - 1)];
}

function createGame() {
  return {
    currentPlayer: 0,
    players: [
      { name: "Black", color: "black", position: 0 },
      { name: "White", color: "white", position: 0 }
    ],
    lastRoll: null,
    winner: null,
    turnCount: 1,
    board: randomBoard()
  };
}

let game = createGame();

function logMessage(message) {
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = message;
  logEl.prepend(entry);
}

function renderStartTokens() {
  const stats = document.querySelector(".stats");
  let dock = document.getElementById("startDock");
  const zeroPlayers = game.players.filter(player => player.position === 0);

  if (dock) dock.remove();
  if (!zeroPlayers.length) return;

  dock = document.createElement("div");
  dock.id = "startDock";
  dock.style.marginTop = "8px";
  dock.style.display = "flex";
  dock.style.alignItems = "center";
  dock.style.gap = "8px";
  dock.innerHTML = `<span style="font-size:0.9rem;color:#5e5e5e;">At start:</span>`;

  zeroPlayers.forEach(player => {
    const token = document.createElement("div");
    token.className = `token ${player.color}`;
    token.title = `${player.name} at start`;
    dock.appendChild(token);
  });

  stats.appendChild(dock);
}

function renderBoard() {
  boardEl.innerHTML = "";
  const jumps = game.board.jumps;

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

      const playersHere = game.players.filter(player => player.position === number);
      if (playersHere.length) {
        const tokensEl = document.createElement("div");
        tokensEl.className = "tokens";

        playersHere.forEach(player => {
          const token = document.createElement("div");
          token.className = `token ${player.color}`;
          token.title = `${player.name} on ${player.position}`;
          tokensEl.appendChild(token);
        });

        cell.appendChild(tokensEl);
      }

      boardEl.appendChild(cell);
    }
  }
}

function updateUI() {
  renderBoard();
  renderStartTokens();

  boardNameEl.textContent = `Board: ${game.board.name}`;
  positionsEl.textContent = `Black: ${game.players[0].position} | White: ${game.players[1].position}`;
  lastRollEl.textContent = `Last roll: ${game.lastRoll ?? "-"}`;

  if (game.winner) {
    statusEl.textContent = `${game.winner.name} wins on turn ${game.turnCount}.`;
    rollBtn.disabled = true;
    return;
  }

  statusEl.textContent = `${game.players[game.currentPlayer].name} to roll.`;
  rollBtn.disabled = false;
}

function applyJump(position) {
  return game.board.jumps[position] ?? position;
}

function takeTurn() {
  if (game.winner) return;

  const player = game.players[game.currentPlayer];
  const roll = rollDie();
  const attempted = player.position + roll;

  game.lastRoll = roll;

  if (attempted > 100) {
    logMessage(
      `Turn ${game.turnCount}: ${player.name} rolled ${roll} from ${player.position} but needs an exact roll to reach 100, so stays put.`
    );
    game.currentPlayer = (game.currentPlayer + 1) % 2;
    game.turnCount += 1;
    updateUI();
    return;
  }

  player.position = attempted;
  logMessage(`Turn ${game.turnCount}: ${player.name} rolled ${roll} and moved to ${player.position}.`);

  const jumpedTo = applyJump(player.position);
  if (jumpedTo !== player.position) {
    const isLadder = jumpedTo > player.position;
    logMessage(
      `${player.name} ${isLadder ? "climbed a ladder" : "hit a snake"} from ${player.position} to ${jumpedTo}.`
    );
    player.position = jumpedTo;
  }

  if (player.position === 100) {
    game.winner = player;
    updateUI();
    return;
  }

  game.currentPlayer = (game.currentPlayer + 1) % 2;
  game.turnCount += 1;
  updateUI();
}

function resetGame() {
  game = createGame();
  logEl.innerHTML = "";
  logMessage(`Game reset. New board: ${game.board.name}. Black starts. Both players begin at 0.`);
  updateUI();
}

async function boot() {
  try {
    validateBoardSet();

    const session = await ensureSignedIn();
    const user = await getCurrentUser();

    authStatusEl.textContent = `Signed in anonymously: ${user?.id?.slice(0, 8) ?? "unknown"}…`;
    logMessage(`Supabase session ready: ${session?.user?.id?.slice(0, 8) ?? "unknown"}…`);

    resetGame();
  } catch (error) {
    console.error(error);
    authStatusEl.textContent = "Supabase connection failed.";
    statusEl.textContent = "Check your Supabase URL, anon key, and Anonymous Auth settings.";
    rollBtn.disabled = true;
    resetBtn.disabled = true;
  }
}

rollBtn.addEventListener("click", takeTurn);
resetBtn.addEventListener("click", resetGame);

boot();
