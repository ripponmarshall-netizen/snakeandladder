/* Local match history + aggregate stats, persisted to localStorage (guarded for
   private mode). Records both online and local results. Pure data layer — no DOM. */

const STORAGE_KEY = "snl_stats";
const MAX_RECENT = 20;

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* localStorage unavailable — no-op */
  }
}

function empty() {
  return { played: 0, won: 0, lost: 0, streak: 0, recent: [] };
}

/* match: { mode:"online"|"local", result:"win"|"loss", opponent, board } */
export function recordMatch(match) {
  const data = read() || empty();
  data.played += 1;
  if (match.result === "win") {
    data.won += 1;
    data.streak = data.streak >= 0 ? data.streak + 1 : 1;
  } else {
    data.lost += 1;
    data.streak = data.streak <= 0 ? data.streak - 1 : -1;
  }
  data.recent.unshift({
    mode: match.mode || "local",
    result: match.result,
    opponent: match.opponent || "—",
    board: match.board || "—",
    date: Date.now()
  });
  if (data.recent.length > MAX_RECENT) data.recent.length = MAX_RECENT;
  write(data);
  return data;
}

export function getStats() {
  const data = read() || empty();
  data.winRate = data.played ? Math.round((data.won / data.played) * 100) : 0;
  return data;
}

export function clearStats() {
  write(empty());
}
