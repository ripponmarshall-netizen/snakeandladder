/* Tiny haptic feedback helper around navigator.vibrate. No-ops where the API is
   unsupported (most desktops, iOS Safari), so call sites need no guards. */

const can = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

function buzz(pattern) {
  if (!can) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw if called outside a user gesture — ignore */
  }
}

export function roll() {
  buzz(20);
}

export function land() {
  buzz(12);
}

export function ladder() {
  buzz([15, 40, 15, 40, 25]);
}

export function snake() {
  buzz([40, 30, 40]);
}

export function win() {
  buzz([30, 50, 30, 50, 80]);
}
