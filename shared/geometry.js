// ═══════════════════════════════════════════════════════════════════════════════
// SHARED GEOMETRY — canonical edge keys + circle/rect collision math.
// Pure functions. The server and client MUST agree on these exactly, so they live
// here and are imported by both (this is what makes prediction match the server).
// ═══════════════════════════════════════════════════════════════════════════════
import { CELL, W, H, WALL_THICK, WIN_FRAC } from './constants.js';

// ─── Canonical edge keys ──────────────────────────────────────────────────────
// Each physical wall edge has exactly one key, so two adjacent cells can never
// produce duplicate overlapping walls.
export const edgeKey = (cx, cy, side) =>
  side === 'N' ? `h,${cx},${cy}` : side === 'S' ? `h,${cx},${cy + 1}` :
  side === 'W' ? `v,${cx},${cy}` : `v,${cx + 1},${cy}`;

export function keyMeta(key) { const p = key.split(','); return { type: p[0], a: +p[1], b: +p[2] }; }

export function wallRect(key) {
  const { type, a, b } = keyMeta(key), half = WALL_THICK / 2;
  return type === 'h'
    ? { x: a * CELL, y: b * CELL - half, w: CELL, h: WALL_THICK }
    : { x: a * CELL - half, y: b * CELL, w: WALL_THICK, h: CELL };
}

// Solid segments of a wall (full wall = one rect; window = two end caps).
export function wallSegs(key, wall) {
  if (wall.state === 'full') return [wallRect(key)];
  const { type, a, b } = keyMeta(key), half = WALL_THICK / 2, frac = CELL * WIN_FRAC;
  return type === 'h'
    ? [{ x: a * CELL, y: b * CELL - half, w: frac, h: WALL_THICK }, { x: a * CELL + CELL - frac, y: b * CELL - half, w: frac, h: WALL_THICK }]
    : [{ x: a * CELL - half, y: b * CELL, w: WALL_THICK, h: frac }, { x: a * CELL - half, y: b * CELL + CELL - frac, w: WALL_THICK, h: frac }];
}

// Deterministic hash of a key → stable per-wall crack positions (no per-frame flicker).
export function hashKey(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) & 0x7fffffff;
  return h;
}

// ─── Circle vs rect ───────────────────────────────────────────────────────────
export const closestPt = (px, py, rx, ry, rw, rh) => ({
  x: Math.max(rx, Math.min(px, rx + rw)),
  y: Math.max(ry, Math.min(py, ry + rh)),
});

export function circleHitsRect(px, py, r, rx, ry, rw, rh) {
  const cp = closestPt(px, py, rx, ry, rw, rh);
  const dx = px - cp.x, dy = py - cp.y;
  return dx * dx + dy * dy < r * r;
}

// Push an entity {x,y,radius} out of a rectangle (axis-resolved penetration).
export function resolveRect(e, rx, ry, rw, rh) {
  if (!circleHitsRect(e.x, e.y, e.radius, rx, ry, rw, rh)) return;
  const cp = closestPt(e.x, e.y, rx, ry, rw, rh);
  const dx = e.x - cp.x, dy = e.y - cp.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
  const pen = e.radius - dist;
  e.x += (dx / dist) * pen;
  e.y += (dy / dist) * pen;
}

// Resolve an entity against every solid wall segment in `walls`.
export function resolveWalls(e, walls) {
  for (const key in walls)
    for (const seg of wallSegs(key, walls[key]))
      resolveRect(e, seg.x, seg.y, seg.w, seg.h);
}

export function clampArena(e) {
  const r = e.radius;
  e.x = Math.max(r, Math.min(W - r, e.x));
  e.y = Math.max(r, Math.min(H - r, e.y));
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function dist2(ax, ay, bx, by) { return (ax - bx) ** 2 + (ay - by) ** 2; }
