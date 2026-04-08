const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const lastRollEl = document.getElementById("lastRoll");
const positionsEl = document.getElementById("positions");
const logEl = document.getElementById("log");
const rollBtn = document.getElementById("rollBtn");
const resetBtn = document.getElementById("resetBtn");

const jumps = {
  3: 22,
  5: 8,
  11: 26,
  20: 29,
  43: 77,
  50: 91,
  57: 76,
  72: 84,
  17: 4,
  19: 7,
  21: 9,
  27: 1,
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
  return Math.floor(Math.random() * 6) + 1;
}

function getCellNumber(rowFromTop, col) {
  const rowFromBottom = 9 - rowFromTop;
  const rowStart = rowFromBottom * 10 + 1;
  const leftToRight = rowFromBottom % 2 === 0;
  return leftToRight ? rowStart + col : rowStart + (9 - col);
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
  if (zeroPlayers.length === 0) return;

  const panel = document.querySelector(".stats");
  let dock = document.getElementById("startDock");

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
  if (!jumps[position]) return { finalPosition: position, message: null };

  const destination = jumps[position];
  const type = destination > position ? "ladder" : "snake";
  const message =
    type === "ladder"
      ? `Climbed a ladder from ${position} to ${destination}.`
      : `Hit a snake from ${position} down to ${destination}.`;

  return {
    finalPosition: destination,
    message
  };
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

rollBtn.addEventListener("click", takeTurn);
resetBtn.addEventListener("click", resetGame);

resetGame();
