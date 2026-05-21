/* Theme switching via a data-theme attribute on <html> + CSS variable blocks in
   style.css. Persisted to localStorage (guarded for private mode, like sound.js).
   Also keeps the <meta name="theme-color"> / color-scheme tags in sync. */

const STORAGE_KEY = "snl_theme";

export const THEMES = [
  { id: "light", name: "Light",  meta: "#1f2a44", scheme: "light" },
  { id: "dark",  name: "Dark",   meta: "#141824", scheme: "dark" },
  { id: "neon",  name: "Neon",   meta: "#0a0e1a", scheme: "dark" },
  { id: "retro", name: "Retro",  meta: "#2e2618", scheme: "light" }
];

function read() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function write(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* localStorage unavailable — keep in-memory only */
  }
}

export function getTheme() {
  const stored = read();
  return THEMES.some(function (t) { return t.id === stored; }) ? stored : "light";
}

function metaFor(id) {
  return THEMES.find(function (t) { return t.id === id; }) || THEMES[0];
}

export function applyTheme(id) {
  const theme = metaFor(id);
  document.documentElement.setAttribute("data-theme", theme.id);
  write(theme.id);

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", theme.meta);
  const colorScheme = document.querySelector('meta[name="color-scheme"]');
  if (colorScheme) colorScheme.setAttribute("content", theme.scheme);
  return theme.id;
}

export function nextTheme(id) {
  const order = THEMES.map(function (t) { return t.id; });
  const at = order.indexOf(id);
  return order[(at + 1) % order.length];
}

export function initTheme() {
  return applyTheme(getTheme());
}
