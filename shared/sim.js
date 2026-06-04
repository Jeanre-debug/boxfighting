// ═══════════════════════════════════════════════════════════════════════════════
// AUTHORITATIVE SIMULATION — the single source of truth for a match.
//
// Pure & headless: no DOM, no canvas, no globals, no wall-clock time.
// The Node server runs this to own the game; the browser runs the SAME code for
// client-side prediction. Because both sides import this identical module, a
// predicted frame matches the server's frame.
//
// Design rules that make it net-safe:
//   • State is fully serializable — bullets reference players by ID string,
//     never by object. No DOM nodes, no functions stored in state.
//   • Time is simulation time (ms) passed in as `now`/`dt`, never Date.now().
//   • Randomness that the client must predict (weapon spread) uses a
//     deterministic PRNG keyed by (playerId, shotCounter). Bot-AI randomness is
//     server-authoritative only (clients interpolate bots, never predict them).
//   • step() mutates state and RETURNS an events[] array. Events are how the
//     client turns sim outcomes into juice (particles, shake, sound, killfeed).
//     The server ignores most events; match logic consumes 'kill'.
// ═══════════════════════════════════════════════════════════════════════════════
import * as C from './constants.js';
import {
  edgeKey, keyMeta, wallRect, wallSegs, closestPt,
  resolveWalls, clampArena, wrapAngle, dist2,
} from './geometry.js';

// ─── Deterministic PRNG (for predictable weapon spread) ───────────────────────
function strHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  return h;
}
function detRand(seed) {
  let x = (seed | 0) || 1;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return ((x >>> 0) % 1000000) / 1000000;
}

// ─── State construction ───────────────────────────────────────────────────────
export function createState() {
  return {
    tick: 0,
    players: {},          // id -> player
    walls: {},            // edgeKey -> { hp, state, team }
    bullets: [],          // serializable: owner is an id string
    nextBulletId: 1,
  };
}

function makeAmmo() {
  const a = {};
  for (const id of C.WEAPON_ORDER) a[id] = { count: C.WEAPONS[id].magSize, reloadEnd: 0 };
  return a;
}

export function addPlayer(state, id, { x, y, team = 0, isBot = false, difficulty = 'medium', weapon = 'ar' }) {
  state.players[id] = {
    id, team, isBot, difficulty,
    x, y, radius: C.P_RADIUS, aimAngle: team === 1 ? Math.PI : 0,
    hp: 100, shield: 0, dead: false,
    weapon,
    ammo: makeAmmo(),
    materials: isBot ? Infinity : C.MAT_MAX,
    minis: isBot ? 0 : C.PLAYER_MINIS,
    bigPots: isBot ? 0 : C.PLAYER_BIGPOTS,
    lastFire: -9999, lastBuild: -9999, swingEnd: 0,
    dashEnd: 0, dashReadyAt: 0, dashVx: 0, dashVy: 0,
    potionEnd: 0, potionType: null,
    shotCounter: 0,
    // bot fields
    botPhase: Math.random() * Math.PI * 2,
    botTimer: Math.random() * 1000,
    peekState: 'idle', peekKey: null, peekTimer: 0,
  };
  return state.players[id];
}

export function removePlayer(state, id) { delete state.players[id]; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function angleToSide(a) {
  const n = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (n < Math.PI / 4 || n >= 7 * Math.PI / 4) return 'E';
  if (n < 3 * Math.PI / 4) return 'S';
  if (n < 5 * Math.PI / 4) return 'W';
  return 'N';
}
function cellOf(e) { return { cx: Math.floor(e.x / C.CELL), cy: Math.floor(e.y / C.CELL) }; }
function dashActive(p, now) { return now < p.dashEnd; }

// Pure player movement for one tick — clock-agnostic (caller decides `dashing`).
// Shared by the server (stepPlayer) AND client prediction so they stay identical.
export function movePlayer(p, input, walls, dt, dashing) {
  if (dashing) {
    const sx = p.dashVx * dt / C.FRAME_MS / C.SUB_STEPS;
    const sy = p.dashVy * dt / C.FRAME_MS / C.SUB_STEPS;
    for (let i = 0; i < C.SUB_STEPS; i++) {
      p.x += sx; resolveWalls(p, walls);
      p.y += sy; resolveWalls(p, walls);
    }
  } else {
    let mx = input.moveX || 0, my = input.moveY || 0;
    const mag = Math.sqrt(mx * mx + my * my) || 1;
    if (mx || my) { mx /= mag; my /= mag; }
    const spd = C.P_SPEED * dt / C.FRAME_MS / C.SUB_STEPS;
    for (let i = 0; i < C.SUB_STEPS; i++) {
      p.x += mx * spd; resolveWalls(p, walls);
      p.y += my * spd; resolveWalls(p, walls);
    }
  }
  clampArena(p);
}

function hasLOS(state, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const steps = Math.ceil(Math.sqrt(dx * dx + dy * dy) / 5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps, px = x1 + dx * t, py = y1 + dy * t;
    for (const key in state.walls)
      for (const seg of wallSegs(key, state.walls[key]))
        if (px >= seg.x && px <= seg.x + seg.w && py >= seg.y && py <= seg.y + seg.h) return false;
  }
  return true;
}

// ─── Building ─────────────────────────────────────────────────────────────────
function tryBuild(state, p, now, events) {
  if (now - p.lastBuild < C.BUILD_CD) return;
  if (p.materials < C.MAT_COST) return;
  const { cx, cy } = cellOf(p);
  const key = edgeKey(cx, cy, angleToSide(p.aimAngle));
  if (state.walls[key]) return;
  state.walls[key] = { hp: C.WALL_START_HP, state: 'full', team: p.team };
  if (p.materials !== Infinity) p.materials -= C.MAT_COST;
  p.lastBuild = now;
  events.push({ t: 'build', key, team: p.team, x: cx * C.CELL + C.CELL / 2, y: cy * C.CELL + C.CELL / 2 });
}

function tryEdit(state, p, toState, events) {
  const { cx, cy } = cellOf(p);
  const key = edgeKey(cx, cy, angleToSide(p.aimAngle));
  const wall = state.walls[key];
  if (!wall) return;
  wall.state = toState !== undefined ? toState : (wall.state === 'full' ? 'window' : 'full');
  events.push({ t: 'edit', key, state: wall.state });
}

// ─── Damage / kills ───────────────────────────────────────────────────────────
function applyDamage(state, target, amount, sourceId, sourceWeapon, events) {
  if (target.dead || dashActive(target, state._now)) return 0;
  const shieldDmg = Math.min(target.shield || 0, amount);
  target.shield = Math.max(0, (target.shield || 0) - shieldDmg);
  const hpDmg = Math.min(Math.max(0, target.hp), amount - shieldDmg);
  target.hp -= hpDmg;
  const actual = shieldDmg + hpDmg;
  if (actual <= 0) return 0;

  target.potionEnd = 0; target.potionType = null;   // damage interrupts drinking
  events.push({ t: 'hit', targetId: target.id, sourceId, dmg: actual, x: target.x, y: target.y, shieldOnly: hpDmg === 0 });

  if (target.hp <= 0 && !target.dead) {
    target.dead = true; target.hp = 0;
    events.push({ t: 'kill', targetId: target.id, sourceId, weapon: sourceWeapon, x: target.x, y: target.y });
  }
  return actual;
}

// ─── Explosions (rocket AOE) ──────────────────────────────────────────────────
function explode(state, x, y, ownerId, events) {
  events.push({ t: 'explosion', x, y, ownerId });
  for (const key in state.walls) {
    const wall = state.walls[key];
    const wr = wallRect(key);
    const d = Math.sqrt(dist2(wr.x + wr.w / 2, wr.y + wr.h / 2, x, y));
    if (d < C.EXPL_RADIUS) {
      wall.hp -= 80 * (1 - d / C.EXPL_RADIUS * 0.5);
      if (wall.hp <= 0) { events.push({ t: 'wallBreak', key, x: wr.x + wr.w / 2, y: wr.y + wr.h / 2, team: wall.team }); delete state.walls[key]; }
    }
  }
  for (const id in state.players) {
    const t = state.players[id];
    if (id === ownerId || t.dead) continue;
    const d = Math.sqrt(dist2(t.x, t.y, x, y));
    if (d < C.EXPL_RADIUS + t.radius) {
      const falloff = Math.max(0, 1 - d / C.EXPL_RADIUS);
      const ang = Math.atan2(t.y - y, t.x - x);
      t.x += Math.cos(ang) * 45 * falloff;
      t.y += Math.sin(ang) * 45 * falloff;
      clampArena(t); resolveWalls(t, state.walls);
      applyDamage(state, t, 40 * falloff, ownerId, 'rocket', events);
    }
  }
}

// ─── Weapons ──────────────────────────────────────────────────────────────────
function spawnBullet(state, p, angle, wep) {
  const barrel = p.radius + 6;
  const bx = p.x + Math.cos(p.aimAngle) * barrel;
  const by = p.y + Math.sin(p.aimAngle) * barrel;
  state.bullets.push({
    id: state.nextBulletId++,
    x: bx, y: by, prevX: bx, prevY: by,
    vx: Math.cos(angle) * C.BULLET_SPEED, vy: Math.sin(angle) * C.BULLET_SPEED,
    owner: p.id, team: p.team, life: wep.range,
    wallDmg: wep.wallDmg, playerDmg: wep.playerDmg,
    col: wep.col, sz: wep.sz, pierce: !!wep.pierce, isRocket: !!wep.isRocket,
  });
}

function fireWeapon(state, p, now, events) {
  const wep = C.WEAPONS[p.weapon];
  if (!wep) return;
  if (p.weapon === 'pickaxe') { swingPickaxe(state, p, now, events); return; }

  const ws = p.ammo[p.weapon];
  if (now < ws.reloadEnd) return;
  if (ws.count <= 0) {
    ws.reloadEnd = now + wep.reloadTime * (p.isBot ? 0.65 : 1);
    ws.count = wep.magSize;
    events.push({ t: 'reload', id: p.id, weapon: p.weapon });
    return;
  }
  const diff = p.isBot ? C.BOT_DIFF[p.difficulty || 'medium'] : null;
  const cd = diff ? wep.cd * diff.fireMult : wep.cd;
  if (now - p.lastFire < cd) return;
  p.lastFire = now;

  const extraSpread = diff ? diff.aimSpread : 0;
  const pellets = wep.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    // Deterministic spread so client prediction matches the server exactly.
    const r = detRand(strHash(p.id) + p.shotCounter++);
    const angle = p.aimAngle + (r - 0.5) * 2 * (wep.spread + extraSpread);
    spawnBullet(state, p, angle, wep);
  }
  events.push({ t: 'shoot', id: p.id, weapon: p.weapon });
  ws.count--;
  if (ws.count <= 0) {
    ws.reloadEnd = now + wep.reloadTime * (p.isBot ? 0.65 : 1);
    ws.count = wep.magSize;
    events.push({ t: 'reload', id: p.id, weapon: p.weapon });
  }
}

function swingPickaxe(state, p, now, events) {
  const wep = C.WEAPONS.pickaxe;
  if (now - p.lastFire < wep.cd) return;
  p.lastFire = now;
  p.swingEnd = now + wep.swingDur;
  events.push({ t: 'melee', id: p.id });

  for (const key in state.walls) {
    const wall = state.walls[key];
    let hit = null;
    for (const seg of wallSegs(key, wall)) {
      const cp = closestPt(p.x, p.y, seg.x, seg.y, seg.w, seg.h);
      const dx = cp.x - p.x, dy = cp.y - p.y;
      if (Math.sqrt(dx * dx + dy * dy) > wep.reach) continue;
      if (Math.abs(wrapAngle(Math.atan2(dy, dx) - p.aimAngle)) > wep.arc) continue;
      hit = cp; break;
    }
    if (!hit) continue;
    wall.hp -= wep.wallDmg;
    if (wall.hp <= 0) { const r = wallRect(key); events.push({ t: 'wallBreak', key, x: r.x + r.w / 2, y: r.y + r.h / 2, team: wall.team }); delete state.walls[key]; }
  }
  for (const id in state.players) {
    const t = state.players[id];
    if (id === p.id || t.dead || t.team === p.team) continue;
    const dx = t.x - p.x, dy = t.y - p.y;
    if (Math.sqrt(dx * dx + dy * dy) < wep.reach + t.radius &&
        Math.abs(wrapAngle(Math.atan2(dy, dx) - p.aimAngle)) < wep.arc) {
      applyDamage(state, t, wep.playerDmg, p.id, 'pickaxe', events);
    }
  }
}

// ─── Potions ──────────────────────────────────────────────────────────────────
function startPotion(state, p, type, now, events) {
  if (p.dead || p.potionEnd) return;
  if (type === 'mini') {
    if (p.minis <= 0 || p.shield >= C.MINI_SHIELD_CAP) return;
  } else {
    if (p.bigPots <= 0 || p.shield >= C.SHIELD_MAX) return;
  }
  p.potionType = type;
  p.potionEnd = now + (type === 'mini' ? C.MINI_USE_MS : C.BIG_USE_MS);
  events.push({ t: 'potionStart', id: p.id, type });
}

function updatePotion(state, p, now, events) {
  if (!p.potionEnd) return;
  if (now >= p.potionEnd) {
    if (p.potionType === 'mini') { p.shield = Math.min(C.MINI_SHIELD_CAP, p.shield + C.MINI_AMOUNT); p.minis--; }
    else { p.shield = Math.min(C.SHIELD_MAX, p.shield + C.BIG_POT_AMOUNT); p.bigPots--; }
    events.push({ t: 'potionDone', id: p.id, type: p.potionType });
    p.potionEnd = 0; p.potionType = null;
  }
}

// ─── Per-player input step ────────────────────────────────────────────────────
function stepPlayer(state, p, input, now, dt, events) {
  if (p.dead || !input) return;
  if (typeof input.aimAngle === 'number') p.aimAngle = input.aimAngle;
  if (input.weapon && C.WEAPONS[input.weapon]) p.weapon = input.weapon;

  // Edge actions
  if (input.dash && now >= p.dashReadyAt && !dashActive(p, now)) {
    let dx = input.moveX || 0, dy = input.moveY || 0;
    if (dx === 0 && dy === 0) { dx = Math.cos(p.aimAngle); dy = Math.sin(p.aimAngle); }
    const m = Math.sqrt(dx * dx + dy * dy) || 1;
    p.dashVx = dx / m * C.DASH_SPD; p.dashVy = dy / m * C.DASH_SPD;
    p.dashEnd = now + C.DASH_DUR; p.dashReadyAt = now + C.DASH_CD;
    p.potionEnd = 0; p.potionType = null;
    events.push({ t: 'dash', id: p.id });
  }
  if (input.edit)   tryEdit(state, p, undefined, events);
  if (input.reset)  tryEdit(state, p, 'full', events);
  if (input.reload) {
    const ws = p.ammo[p.weapon], wep = C.WEAPONS[p.weapon];
    if (ws && wep.magSize !== Infinity && ws.count < wep.magSize) {
      ws.reloadEnd = now + wep.reloadTime; ws.count = wep.magSize;
      events.push({ t: 'reload', id: p.id, weapon: p.weapon });
    }
  }
  if (input.mini)   startPotion(state, p, 'mini', now, events);
  if (input.bigpot) startPotion(state, p, 'big', now, events);

  // Movement — shared with client prediction so a predicted frame matches the server
  movePlayer(p, input, state.walls, dt, dashActive(p, now));

  if (p.materials !== Infinity && p.materials < C.MAT_MAX)
    p.materials = Math.min(C.MAT_MAX, p.materials + C.MAT_REGEN * dt / C.FRAME_MS);

  updatePotion(state, p, now, events);
  const busy = !!p.potionEnd;
  if (!busy) {
    if (input.fire)  fireWeapon(state, p, now, events);
    if (input.build) tryBuild(state, p, now, events);
  }
}

// ─── Bot AI step (server-authoritative; not predicted by clients) ─────────────
function nearestEnemy(state, b) {
  let best = null, bestD = Infinity;
  for (const id in state.players) {
    const t = state.players[id];
    if (t.dead || t.team === b.team) continue;
    const d = dist2(b.x, b.y, t.x, t.y);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

function stepBot(state, b, now, dt, events) {
  if (b.dead) return;
  const diff = C.BOT_DIFF[b.difficulty] || C.BOT_DIFF.medium;
  const target = nearestEnemy(state, b);
  if (!target) return;

  const dx = target.x - b.x, dy = target.y - b.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  b.aimAngle = Math.atan2(dy, dx);
  b.botPhase += 0.045 * dt / C.FRAME_MS;

  if (diff.peeks) {
    if (b.peekState === 'idle') {
      b.peekTimer += dt;
      if (b.peekTimer > 2000 + Math.random() * 1000) {
        b.peekTimer = 0;
        if (!hasLOS(state, b.x, b.y, target.x, target.y)) {
          const { cx, cy } = cellOf(b);
          const key = edgeKey(cx, cy, angleToSide(b.aimAngle));
          if (state.walls[key] && state.walls[key].state === 'full') {
            b.peekState = 'peeking'; b.peekKey = key; b.peekTimer = 650;
            state.walls[key].state = 'window';
            events.push({ t: 'edit', key, state: 'window' });
          }
        }
      }
    } else if (b.peekState === 'peeking') {
      b.peekTimer -= dt;
      fireWeapon(state, b, now, events);
      if (b.peekTimer <= 0) {
        if (state.walls[b.peekKey]) { state.walls[b.peekKey].state = 'full'; events.push({ t: 'edit', key: b.peekKey, state: 'full' }); }
        b.peekState = 'idle'; b.peekKey = null; b.peekTimer = 800;
      }
    }
  }

  const perpX = -dy / dist, perpY = dx / dist;
  const strafe = Math.sin(b.botPhase);
  const spd = C.BOT_BASE_SPEED * diff.spd;
  let mx = perpX * strafe, my = perpY * strafe;
  if (dist > diff.idealDist + 20) { mx += dx / dist * 0.9; my += dy / dist * 0.9; }
  else if (dist < diff.idealDist - 20) { mx -= dx / dist * 0.9; my -= dy / dist * 0.9; }

  const stepLen = spd * dt / C.FRAME_MS / C.SUB_STEPS;
  for (let i = 0; i < C.SUB_STEPS; i++) {
    b.x += mx * stepLen; resolveWalls(b, state.walls);
    b.y += my * stepLen; resolveWalls(b, state.walls);
  }
  clampArena(b);

  b.botTimer += dt;
  if (b.botTimer > 1400) { b.botTimer = 0; tryBuild(state, b, now, events); }
  if (b.peekState === 'idle' && hasLOS(state, b.x, b.y, target.x, target.y)) fireWeapon(state, b, now, events);
}

// ─── Bullets ──────────────────────────────────────────────────────────────────
function stepBullets(state, dt, events) {
  const steps = Math.max(1, Math.round(dt / C.FRAME_MS));   // advance per ~16ms slice
  const next = [];
  outer: for (const b of state.bullets) {
    for (let s = 0; s < steps; s++) {
      b.prevX = b.x; b.prevY = b.y;
      b.x += b.vx; b.y += b.vy;
      if (--b.life <= 0 || b.x < 0 || b.x > C.W || b.y < 0 || b.y > C.H) {
        if (b.isRocket) explode(state, b.x, b.y, b.owner, events);
        continue outer;
      }
      const br = b.sz;
      let consumed = false;
      for (const key in state.walls) {
        const wall = state.walls[key];
        let wallHit = false;
        for (const seg of wallSegs(key, wall)) {
          if (b.x + br < seg.x || b.x - br > seg.x + seg.w || b.y + br < seg.y || b.y - br > seg.y + seg.h) continue;
          wallHit = true; break;
        }
        if (!wallHit) continue;
        if (b.isRocket) { explode(state, b.x, b.y, b.owner, events); consumed = true; break; }
        wall.hp -= b.wallDmg;
        events.push({ t: 'bulletWall', key, x: b.x, y: b.y });
        if (wall.hp <= 0) { const r = wallRect(key); events.push({ t: 'wallBreak', key, x: r.x + r.w / 2, y: r.y + r.h / 2, team: wall.team }); delete state.walls[key]; }
        if (!b.pierce) { consumed = true; }
        break;
      }
      if (consumed) continue outer;

      for (const id in state.players) {
        const t = state.players[id];
        if (id === b.owner || t.dead || t.team === b.team) continue;
        if (dist2(b.x, b.y, t.x, t.y) < (t.radius + br) ** 2) {
          if (b.isRocket) explode(state, b.x, b.y, b.owner, events);
          else applyDamage(state, t, b.playerDmg, b.owner, weaponOfBullet(b), events);
          consumed = true; break;
        }
      }
      if (consumed) continue outer;
    }
    next.push(b);
  }
  state.bullets = next;
}
function weaponOfBullet(b) {
  // Reverse-lookup weapon by signature (only needed for killfeed text).
  for (const id of C.WEAPON_ORDER) { const w = C.WEAPONS[id]; if (w.playerDmg === b.playerDmg && !!w.pierce === b.pierce) return id; }
  return 'ar';
}

function stepWalls(state, dt) {
  for (const key in state.walls) {
    const w = state.walls[key];
    if (w.hp < C.WALL_HP) w.hp = Math.min(C.WALL_HP, w.hp + C.WALL_REGEN * dt / 1000);
  }
}

// ─── The tick ─────────────────────────────────────────────────────────────────
// inputs: { [playerId]: inputObject }.  now/dt in sim-ms.  Returns events[].
export function step(state, inputs, now, dt) {
  const events = [];
  state.tick++;
  state._now = now;
  for (const id in state.players) {
    const p = state.players[id];
    if (p.isBot) stepBot(state, p, now, dt, events);
    else stepPlayer(state, p, inputs[id], now, dt, events);
  }
  stepBullets(state, dt, events);
  stepWalls(state, dt);
  return events;
}
