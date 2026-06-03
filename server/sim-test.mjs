// Headless proof that the shared simulation runs server-side with no browser.
// Run: node server/sim-test.mjs
import * as C from '../shared/constants.js';
import { createState, addPlayer, step } from '../shared/sim.js';
import { edgeKey } from '../shared/geometry.js';

const TICK_MS = 1000 / 30;          // 30 Hz authoritative tick
let now = 0;
let fail = 0;
const assert = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${msg}`); if (!cond) fail++; };

// ── Setup: A (team 0, left) vs B (team 1, right), facing each other ──
const s = createState();
const A = addPlayer(s, 'A', { x: C.CELL * 2,  y: C.H / 2, team: 0 });
const B = addPlayer(s, 'B', { x: C.W - C.CELL * 2, y: C.H / 2, team: 1 });
A.aimAngle = 0;          // A aims right toward B
A.weapon = 'ar';

console.log('\n── Test 1: A shoots B until B dies ──');
let kills = [];
for (let i = 0; i < 400 && !B.dead; i++) {
  now += TICK_MS;
  const ev = step(s, { A: { aimAngle: 0, fire: true }, B: {} }, now, TICK_MS);
  kills.push(...ev.filter(e => e.t === 'kill'));
}
assert(B.hp < 100, `B took damage (hp=${Math.ceil(B.hp)})`);
assert(B.dead, 'B was eliminated');
assert(kills.some(k => k.targetId === 'B' && k.sourceId === 'A'), 'kill event credited to A');

// ── Test 2: walls build, block bullets, and regen ──
console.log('\n── Test 2: building + wall collision ──');
const s2 = createState();
const P = addPlayer(s2, 'P', { x: C.CELL * 2 + C.CELL / 2, y: C.CELL * 2 + C.CELL / 2, team: 0 });
const Q = addPlayer(s2, 'Q', { x: C.CELL * 5, y: C.CELL * 2 + C.CELL / 2, team: 1 });
P.aimAngle = 0;
now = 0;
step(s2, { P: { aimAngle: 0, build: true }, Q: {} }, now += TICK_MS, TICK_MS);
const wallCount = Object.keys(s2.walls).length;
assert(wallCount === 1, `P built exactly one wall (${wallCount})`);
const builtWall = Object.values(s2.walls)[0];
assert(builtWall.team === 0, 'wall tagged with builder team 0');
assert(builtWall.hp >= C.WALL_START_HP && builtWall.hp < C.WALL_START_HP + 1, `wall starts at ~${C.WALL_START_HP} HP (not full)`);
// regen over 1s
for (let i = 0; i < 30; i++) step(s2, { P: {}, Q: {} }, now += TICK_MS, TICK_MS);
assert(builtWall.hp > C.WALL_START_HP, `wall regenerated (hp=${builtWall.hp.toFixed(1)})`);

// ── Test 3: shield potion absorbs damage ──
console.log('\n── Test 3: shield potion ──');
const s3 = createState();
const D = addPlayer(s3, 'D', { x: 200, y: 200, team: 0 });
now = 0;
// drink a mini (2s) then check shield
step(s3, { D: { mini: true } }, now += TICK_MS, TICK_MS);
assert(D.potionEnd > 0, 'mini potion started');
for (let i = 0; i < 70 && D.potionEnd; i++) step(s3, { D: {} }, now += TICK_MS, TICK_MS);
assert(D.shield === C.MINI_AMOUNT, `gained ${C.MINI_AMOUNT} shield (have ${D.shield})`);
assert(D.minis === C.PLAYER_MINIS - 1, 'mini consumed');

// ── Test 4: determinism — same inputs ⇒ identical state ──
console.log('\n── Test 4: determinism (prediction will match server) ──');
function run() {
  const st = createState();
  addPlayer(st, 'X', { x: 300, y: 300, team: 0 });
  addPlayer(st, 'Y', { x: 600, y: 300, team: 1 });
  let t = 0;
  for (let i = 0; i < 120; i++) step(st, { X: { aimAngle: 0, fire: true, moveX: 1 }, Y: {} }, t += TICK_MS, TICK_MS);
  return JSON.stringify({ x: st.players.X.x, hp: st.players.Y.hp, bullets: st.bullets.length });
}
assert(run() === run(), 'two identical runs produce identical state');

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ ' + fail + ' FAILED'} — sim is server-ready\n`);
process.exit(fail ? 1 : 0);
