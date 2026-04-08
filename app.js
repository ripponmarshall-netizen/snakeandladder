const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const lastRollEl = document.getElementById("lastRoll");
const positionsEl = document.getElementById("positions");
const logEl = document.getElementById("log");
const rollBtn = document.getElementById("rollBtn");
const resetBtn = document.getElementById("resetBtn");

/*
  Valid jumps:
  - vertical
  - diagonal
  Invalid jumps:
  - horizontal only (same board row)
*/
const jumps = {
  3: 22,
  5: 8,
  11: 26,
  20: 29,
  27: 46,
  36: 55,
  43: 77,
  50: 91,
  17: 4,
  19: 7,
  21: 9,
  32: 14,
  54: 34,
  62: 18,
  64: 60,
  87: 24,
  95: 75,
  99: 78
};

const initialGameState = () => ({
  currentPlayer: 0,
  players: [
    { name: "Black", color: "black", position: 0 },
    { name: "White", color: "white", position: 0 }
  ],
  lastRoll: null,
  winner: null,
  turnCount: 1
});

let game = initialGameState();

function rollDie() {
  return cryptoRandomInt(1, 6);
}

function cryptoRandomInt(min, max) {
  const range = max - min + 1;
  if (range <= 0) throw new Error("Invalid random range.");

  const maxUint32 = 0xFFFFFFFF;
  const bucketSize = Math.floor((maxUint32 + 1) / range);
  const limit = bucketSize * range;

  const values = new Uint32Array(1);
  let randomNumber;

  do {
    crypto.getRandomValues(values);
    randomNumber = values[0];
  } while (randomNumber >= limit);

  return min + Math.floor(randomNumber / bucketSize);
}

function getCellNumber(rowFromTop, col) {
  const rowFromBottom = 9 - rowFromTop;
  const rowStart = rowFromBottom * 10 + 1;
  const leftToRight = rowFromBottom % 2 === 0;
  return leftToRight ? rowStart + col : rowStart + (9 - col);
}

function getBoardPosition(square) {
  if (square < 1 || square > 100) return null;

  const zeroBased = square - 1;
  const rowFromBottom = Math.floor(zeroBased / 10);
  const colInRow = zeroBased % 10;
  const col = rowFromBottom % 2 === 0 ? colInRow : 9 - colInRow;

  return { rowFromBottom, col };
}

function isHorizontalOnlyJump(from, to) {
  const fromPos = getBoardPosition(from);
  const toPos = getBoardPosition(to);
  return fromPos.rowFromBottom === toPos.rowFromBottom;
}

function renderBoard() {
  boardEl.innerHTML = "";

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

      const jumpTarget = jumps[number];
      if (jumpTarget) {
        const marker = document.createElement("div");
        marker.style.position = "absolute";
        marker.style.left = "6px";
        marker.style.top = "22px";
        marker.style.fontSize = "0.62rem";
        marker.style.color = "#5e5e5e";
        marker.textContent = jumpTarget > number ? `L→${jumpTarget}` : `S→${jumpTarget}`;
        cell.appendChild(marker);
      }

      const playersHere = game.players.filter(player => player.position === number);
      if (playersHere.length > 0) {
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

function renderOffBoardTokens() {
  const zeroPlayers = game.players.filter(player => player.position === 0);
  const panel = document.querySelector(".stats");
  let dock = document.getElementById("startDock");

  if (zeroPlayers.length === 0) {
    if (dock) dock.remove();
    return;
  }

  if (!dock) {
    dock = document.createElement("div");
    dock.id = "startDock";
    dock.style.marginTop = "8px";
    dock.style.display = "flex";
    dock.style.alignItems = "center";
    dock.style.gap = "8px";
    panel.appendChild(dock);
  }

  dock.innerHTML = `<span style="font-size:0.9rem;color:#5e5e5e;">At start:</span>`;

  zeroPlayers.forEach(player => {
    const token = document.createElement("div");
    token.className = `token ${player.color}`;
    token.title = `${player.name} at start`;
    dock.appendChild(token);
  });
}

function logMessage(message) {
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = message;
  logEl.prepend(entry);
}

function updateUI() {
  renderBoard();
  renderOffBoardTokens();

  positionsEl.textContent = `Black: ${game.players[0].position} | White: ${game.players[1].position}`;
  lastRollEl.textContent = `Last roll: ${game.lastRoll ?? "-"}`;

  if (game.winner) {
    statusEl.textContent = `${game.winner.name} wins on turn ${game.turnCount}.`;
    rollBtn.disabled = true;
    return;
  }

  const current = game.players[game.currentPlayer];
  statusEl.textContent = `${current.name} to roll.`;
  rollBtn.disabled = false;
}

function applyJump(position) {
  if (!jumps[position]) {
    return { finalPosition: position, message: null };
  }

  const destination = jumps[position];

  if (isHorizontalOnlyJump(position, destination)) {
    throw new Error(
      `Invalid jump: ${position} -> ${destination} is horizontal-only, which is not allowed.`
    );
  }

  const type = destination > position ? "ladder" : "snake";
  const fromPos = getBoardPosition(position);
  const toPos = getBoardPosition(destination);

  let shape = "vertical";
  if (fromPos.col !== toPos.col) shape = "diagonal";

  const message =
    type === "ladder"
      ? `Climbed a ${shape} ladder from ${position} to ${destination}.`
      : `Hit a ${shape} snake from ${position} down to ${destination}.`;

  return {
    finalPosition: destination,
    message
  };
}

function validateJumpMap() {
  const seenSources = new Set();

  Object.entries(jumps).forEach(([fromRaw, to]) => {
    const from = Number(fromRaw);

    if (from < 1 || from > 100 || to < 1 || to > 100) {
      throw new Error(`Jump out of range: ${from} -> ${to}`);
    }

    if (from === to) {
      throw new Error(`Jump cannot point to itself: ${from} -> ${to}`);
    }

    if (seenSources.has(from)) {
      throw new Error(`Duplicate jump source detected at square ${from}`);
    }

    if (isHorizontalOnlyJump(from, to)) {
      throw new Error(`Horizontal-only jump not allowed: ${from} -> ${to}`);
    }

    seenSources.add(from);
  });
}

function takeTurn() {
  if (game.winner) return;

  const player = game.players[game.currentPlayer];
  const roll = rollDie();
  game.lastRoll = roll;

  const attempted = player.position + roll;

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
  logMessage(
    `Turn ${game.turnCount}: ${player.name} rolled ${roll} and moved to ${player.position}.`
  );

  const jumpResult = applyJump(player.position);
  if (jumpResult.message) {
    player.position = jumpResult.finalPosition;
    logMessage(`${player.name}: ${jumpResult.message}`);
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
  game = initialGameState();
  logEl.innerHTML = "";
  logMessage("Game reset. Black starts. Both players begin at 0.");
  updateUI();
}

validateJumpMap();
rollBtn.addEventListener("click", takeTurn);
resetBtn.addEventListener("click", resetGame);
resetGame();
