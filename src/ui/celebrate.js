// Personal-best celebration: confetti fired from two cannons at the bottom corners, a
// "Personal Best Time!!" overlay and a short fanfare, all fading away after 5 seconds.
// Fanfare: "Classic fanfare lick" by fvcalderan, CC0 (opengameart.org/content/classic-fanfare-lick).

import fanfareUrl from '../assets/fanfare.ogg';
import { escapeHtml } from './dom.js';
import { icons } from './icons.js';

const SHOW_MS = 5000;
const FADE_MS = 800;
const COLOURS = ['#f5c518', '#ffd95a', '#f2672e', '#2f9e8f', '#3a7bd5', '#e5487a', '#ffffff'];

/**
 * Celebrate on top of the page. Returns a function that ends it early (e.g. leaving the view).
 * @param {{title: string, detail?: string, sound?: boolean}} opts
 */
export function celebrate({ title, detail = '', sound = true }) {
  const host = document.createElement('div');
  host.className = 'pb-celebration';
  host.setAttribute('role', 'status');
  host.innerHTML = `
    <canvas aria-hidden="true"></canvas>
    <div class="pb-card">${icons.trophy}<strong>${escapeHtml(title)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</div>`;
  document.body.append(host);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stopConfetti = reduced ? () => {} : confetti(host.querySelector('canvas'));
  let audio = null;
  if (sound) {
    audio = new Audio(fanfareUrl);
    audio.play().catch(() => {});
  }

  let done = false;
  const fade = setTimeout(() => host.classList.add('fading'), SHOW_MS - FADE_MS);
  const end = setTimeout(finish, SHOW_MS);
  function finish() {
    if (done) return;
    done = true;
    clearTimeout(fade);
    clearTimeout(end);
    stopConfetti();
    audio?.pause();
    host.remove();
  }
  // A tap dismisses it early.
  host.addEventListener('click', finish);
  return finish;
}

/** Confetti on a full-screen canvas until stopped or the pieces have fallen. */
function confetti(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  // Speeds scale with the screen so the bursts reach about three-quarters of the way up.
  const v0 = Math.sqrt(2 * 900 * H) * 1.3;
  const pieces = [];
  const fire = (x, dir, n) => {
    for (let i = 0; i < n; i++) {
      // Up and inwards: 55–80° from the horizontal.
      const angle = ((55 + Math.random() * 25) * Math.PI) / 180;
      const speed = v0 * (0.55 + Math.random() * 0.5);
      pieces.push({
        x,
        y: H + 10,
        vx: dir * Math.cos(angle) * speed,
        vy: -Math.sin(angle) * speed,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 8,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 14,
        flip: Math.random() * Math.PI,
        flipSpeed: 6 + Math.random() * 8,
        colour: COLOURS[(Math.random() * COLOURS.length) | 0],
      });
    }
  };
  fire(0, 1, 90);
  fire(W, -1, 90);
  // A second, smaller volley a moment later.
  const second = setTimeout(() => {
    fire(0, 1, 45);
    fire(W, -1, 45);
  }, 450);

  let raf = 0;
  let last = performance.now();
  const start = last;
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const age = now - start;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = age > SHOW_MS - FADE_MS ? Math.max(0, (SHOW_MS - age) / FADE_MS) : 1;
    let alive = 0;
    for (const p of pieces) {
      // Gravity and air drag: they burst out fast, then flutter down.
      const drag = Math.pow(0.35, dt);
      p.vx *= drag;
      p.vy = Math.min(140, (p.vy + 900 * dt) * drag);
      p.x += p.vx * dt + Math.sin(p.flip) * 20 * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.flip += p.flipSpeed * dt;
      if (p.y > H + 20) continue;
      alive++;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.flip));
      ctx.fillStyle = p.colour;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive || age < 600) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    clearTimeout(second);
    cancelAnimationFrame(raf);
  };
}
