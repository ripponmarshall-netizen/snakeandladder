/* Canvas-based confetti / sparkle — no external library, no images.
   A single full-screen, pointer-transparent canvas is created lazily and reused.
   The rAF loop only runs while particles are alive, then clears and stops, so
   nothing leaks. Respects prefers-reduced-motion (both entry points no-op). */

const COLORS = ["#3d8bff", "#8b5cf6", "#ff5fa2", "#f5b430", "#ff7a3d", "#18c2a8"];

let canvas = null;
let ctx = null;
let dpr = 1;
let particles = [];
let rafId = null;

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.className = "fx-canvas";
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  resize();
  window.addEventListener("resize", resize);
}

function resize() {
  if (!canvas) return;
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function spawn(x, y, vx, vy, size, life) {
  particles.push({
    x, y, vx, vy, size, life,
    maxLife: life,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    color: COLORS[(Math.random() * COLORS.length) | 0]
  });
}

function loop() {
  rafId = null;
  if (!ctx) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += 0.12;        // gravity
    p.vx *= 0.99;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 1;

    if (p.life <= 0 || p.y > h + 20) {
      particles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / (p.maxLife * 0.5)));
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  }

  if (particles.length) {
    rafId = requestAnimationFrame(loop);
  } else {
    ctx.clearRect(0, 0, w, h);
  }
}

function start() {
  if (rafId == null) rafId = requestAnimationFrame(loop);
}

/* Big celebratory burst from the top of the screen — used on a win. */
export function burst() {
  if (reduceMotion()) return;
  ensureCanvas();
  const w = window.innerWidth;
  const origins = [w * 0.15, w * 0.5, w * 0.85];
  origins.forEach(function (ox) {
    for (let i = 0; i < 40; i++) {
      const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 1.2;
      const speed = 6 + Math.random() * 7;
      spawn(
        ox + (Math.random() - 0.5) * 40,
        -10 + Math.random() * 20,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed + 2,
        5 + Math.random() * 6,
        90 + Math.random() * 50
      );
    }
  });
  start();
}

/* Small localized sparkle at a screen coordinate — used on a ladder landing. */
export function sparkle(x, y) {
  if (reduceMotion()) return;
  ensureCanvas();
  for (let i = 0; i < 14; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 4;
    spawn(
      x, y,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed - 2,
      3 + Math.random() * 4,
      40 + Math.random() * 25
    );
  }
  start();
}

/* Instantly stop and clear any in-flight effect (e.g. on leaving a room). */
export function clear() {
  particles = [];
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
}
