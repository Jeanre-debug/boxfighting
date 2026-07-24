// ═══════════════════════════════════════════════════════════════════════════════
// ASTEROIDS PVP — AUTHORITATIVE SIMULATION
//
// Pure & headless, same philosophy as shared/sim.js: no DOM, no wall-clock time,
// fully serializable state. The Node server runs this to own the match; the
// browser imports `moveShip` alone to predict the LOCAL ship instantly (rockets,
// remote ships, bullets and asteroids are rendered straight from snapshots —
// same tradeoff Box Fight already makes for its own bullets).
//
// Loop: two ships duel inside a drifting asteroid field. Shooting a rock splits
// it (classic Asteroids) and has a chance to drop a health pickup — clearing the
// field is how you heal, ramming a rock is how you get hurt.
// ═══════════════════════════════════════════════════════════════════════════════
import * as C from './ast-constants.js';

function rand(a, b) { return a + Math.random() * (b - a); }

function wrap(e) {
  if (e.x < -e.radius) e.x = C.AST_W + e.radius;
  else if (e.x > C.AST_W + e.radius) e.x = -e.radius;
  if (e.y < -e.radius) e.y = C.AST_H + e.radius;
  else if (e.y > C.AST_H + e.radius) e.y = -e.radius;
}

// ─── State construction ───────────────────────────────────────────────────────
export function createState() {
  return { tick: 0, ships: {}, asteroids: [], bullets: [], pickups: [], nextId: 1, spawnTimer: 0 };
}

export function addPlayer(state, id, { slot = 0, x, y, angle } = {}) {
  const sp = C.SHIP_SPAWNS[slot % C.SHIP_SPAWNS.length];
  state.ships[id] = {
    id, slot, x: x ?? sp.x, y: y ?? sp.y, vx: 0, vy: 0, angle: angle ?? sp.angle, radius: C.SHIP_RADIUS,
    hp: C.SHIP_HP, dead: false, thrusting: false, lastFire: -9999, spawnAt: 0,
  };
  return state.ships[id];
}

export function removePlayer(state, id) { delete state.ships[id]; }

// Pure ship movement for one tick — shared by the server AND client prediction
// so a predicted frame matches the server's frame exactly (mirrors movePlayer()
// in shared/sim.js).
export function moveShip(ship, input, dt) {
  const steps = dt / 16.6667;
  if (input.rotateLeft) ship.angle -= C.SHIP_TURN * steps;
  if (input.rotateRight) ship.angle += C.SHIP_TURN * steps;
  ship.thrusting = !!input.thrust;
  if (input.thrust) {
    ship.vx += Math.cos(ship.angle) * C.SHIP_THRUST * steps;
    ship.vy += Math.sin(ship.angle) * C.SHIP_THRUST * steps;
  }
  const drag = Math.pow(C.SHIP_DRAG, steps);
  ship.vx *= drag; ship.vy *= drag;
  const spd = Math.hypot(ship.vx, ship.vy);
  if (spd > C.SHIP_MAX_SPEED) { const k = C.SHIP_MAX_SPEED / spd; ship.vx *= k; ship.vy *= k; }
  ship.x += ship.vx * steps;
  ship.y += ship.vy * steps;
  wrap(ship);
}

// ─── Asteroid field ───────────────────────────────────────────────────────────
function spawnAsteroid(targetArr, size = 'large', x, y, vx, vy) {
  const cfg = C.AST_SIZES[size];
  if (x === undefined) {
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) { x = rand(0, C.AST_W); y = -cfg.radius; }
    else if (edge === 1) { x = C.AST_W + cfg.radius; y = rand(0, C.AST_H); }
    else if (edge === 2) { x = rand(0, C.AST_W); y = C.AST_H + cfg.radius; }
    else { x = -cfg.radius; y = rand(0, C.AST_H); }
  }
  if (vx === undefined) {
    const ang = rand(0, Math.PI * 2), spd = cfg.speed * rand(0.6, 1.3);
    vx = Math.cos(ang) * spd; vy = Math.sin(ang) * spd;
  }
  targetArr.push({
    id: 0, x, y, vx, vy, size, radius: cfg.radius, hp: cfg.hp,
    angle: rand(0, Math.PI * 2), spin: rand(-0.02, 0.02),
  });
}

export function initField(state, count = C.AST_INITIAL_COUNT) {
  for (let i = 0; i < count; i++) {
    const x = rand(C.AST_W * 0.28, C.AST_W * 0.72), y = rand(0, C.AST_H);
    spawnAsteroid(state.asteroids, 'large', x, y);
  }
  for (const a of state.asteroids) if (!a.id) a.id = state.nextId++;
}

function destroyAsteroid(state, ast, events, spawned) {
  events.push({ t: 'astBreak', x: ast.x, y: ast.y, size: ast.size });
  const cfg = C.AST_SIZES[ast.size];
  if (Math.random() < cfg.dropChance) {
    state.pickups.push({ id: state.nextId++, x: ast.x, y: ast.y, life: C.PICKUP_LIFE_MS, heal: C.PICKUP_HEAL });
    events.push({ t: 'pickupSpawn', x: ast.x, y: ast.y });
  }
  if (cfg.splitsInto) {
    for (let i = 0; i < C.AST_SPLIT_COUNT; i++) {
      const ang = rand(0, Math.PI * 2), spd = C.AST_SIZES[cfg.splitsInto].speed * rand(0.8, 1.6);
      spawnAsteroid(spawned, cfg.splitsInto, ast.x, ast.y, Math.cos(ang) * spd + ast.vx * 0.3, Math.sin(ang) * spd + ast.vy * 0.3);
    }
  }
}

// ─── Damage ───────────────────────────────────────────────────────────────────
function damageShip(state, ship, amount, events, sourceId) {
  if (ship.dead) return;
  if (state._now - ship.spawnAt < C.SPAWN_SHIELD_MS) return;
  ship.hp -= amount;
  events.push({ t: 'shipHit', id: ship.id, dmg: amount, x: ship.x, y: ship.y, sourceId });
  if (ship.hp <= 0 && !ship.dead) {
    ship.hp = 0; ship.dead = true;
    events.push({ t: 'shipKill', id: ship.id, sourceId, x: ship.x, y: ship.y });
  }
}

function fireShip(state, ship, now, events) {
  if (now - ship.lastFire < C.BULLET_CD) return;
  ship.lastFire = now;
  const bx = ship.x + Math.cos(ship.angle) * (C.SHIP_RADIUS + 6);
  const by = ship.y + Math.sin(ship.angle) * (C.SHIP_RADIUS + 6);
  state.bullets.push({
    id: state.nextId++, x: bx, y: by,
    vx: Math.cos(ship.angle) * C.BULLET_SPEED + ship.vx * 0.4,
    vy: Math.sin(ship.angle) * C.BULLET_SPEED + ship.vy * 0.4,
    owner: ship.id, life: C.BULLET_LIFE_FRAMES,
  });
  events.push({ t: 'shoot', id: ship.id });
}

// ─── The tick ─────────────────────────────────────────────────────────────────
// inputs: { [playerId]: {rotateLeft,rotateRight,thrust,fire} }. now/dt in sim-ms.
export function step(state, inputs, now, dt) {
  const events = [];
  state.tick++;
  state._now = now;
  const steps = dt / 16.6667;

  for (const id in state.ships) {
    const ship = state.ships[id];
    if (ship.dead) continue;
    const input = inputs[id] || {};
    moveShip(ship, input, dt);
    if (input.fire) fireShip(state, ship, now, events);
  }

  // Bullets vs ships / asteroids
  const nextBullets = [];
  for (const b of state.bullets) {
    b.x += b.vx * steps; b.y += b.vy * steps; b.life -= steps;
    if (b.life <= 0 || b.x < -20 || b.x > C.AST_W + 20 || b.y < -20 || b.y > C.AST_H + 20) continue;
    let consumed = false;
    for (const id in state.ships) {
      const ship = state.ships[id];
      if (ship.dead || id === b.owner) continue;
      if (Math.hypot(ship.x - b.x, ship.y - b.y) < C.SHIP_RADIUS + C.BULLET_RADIUS) {
        damageShip(state, ship, C.BULLET_SHIP_DMG, events, b.owner);
        consumed = true; break;
      }
    }
    if (!consumed) {
      for (const ast of state.asteroids) {
        if (Math.hypot(ast.x - b.x, ast.y - b.y) < ast.radius + C.BULLET_RADIUS) {
          ast.hp -= C.BULLET_AST_DMG;
          consumed = true; break;
        }
      }
    }
    if (!consumed) nextBullets.push(b);
  }
  state.bullets = nextBullets;

  // Asteroids: move, wrap, break, split
  const survivors = [], spawned = [];
  for (const ast of state.asteroids) {
    if (ast.hp <= 0) { destroyAsteroid(state, ast, events, spawned); continue; }
    ast.x += ast.vx * steps; ast.y += ast.vy * steps; ast.angle += ast.spin * steps;
    wrap(ast);
    survivors.push(ast);
  }
  for (const a of spawned) a.id = state.nextId++;
  state.asteroids = survivors.concat(spawned);

  // Ship vs asteroid contact damage + knockback
  for (const id in state.ships) {
    const ship = state.ships[id];
    if (ship.dead) continue;
    for (const ast of state.asteroids) {
      const d = Math.hypot(ship.x - ast.x, ship.y - ast.y);
      if (d < ship.radius + ast.radius) {
        const cfg = C.AST_SIZES[ast.size];
        damageShip(state, ship, cfg.dmg, events, null);
        const ang = Math.atan2(ship.y - ast.y, ship.x - ast.x) || 0;
        ship.vx += Math.cos(ang) * 3; ship.vy += Math.sin(ang) * 3;
        ast.hp -= C.AST_RAM_SELF_DMG;
      }
    }
  }

  // Pickups: decay + collection
  const remainingPickups = [];
  for (const p of state.pickups) {
    p.life -= dt;
    let collected = false;
    for (const id in state.ships) {
      const ship = state.ships[id];
      if (ship.dead) continue;
      if (Math.hypot(ship.x - p.x, ship.y - p.y) < C.SHIP_RADIUS + C.PICKUP_RADIUS) {
        ship.hp = Math.min(C.SHIP_HP, ship.hp + p.heal);
        events.push({ t: 'pickupTaken', id: ship.id, x: p.x, y: p.y, heal: p.heal });
        collected = true; break;
      }
    }
    if (!collected && p.life > 0) remainingPickups.push(p);
  }
  state.pickups = remainingPickups;

  // Keep the field alive as players clear it (PvP only — Solo Arcade clears a
  // wave to zero on purpose and advances client-side, see stepAstSolo()).
  state.spawnTimer += dt;
  if (!state.noAutoSpawn && state.asteroids.length < C.AST_MIN_COUNT && state.spawnTimer > C.AST_SPAWN_MS) {
    state.spawnTimer = 0;
    const fresh = [];
    spawnAsteroid(fresh, 'large');
    fresh[0].id = state.nextId++;
    state.asteroids.push(fresh[0]);
  }

  return events;
}

// Winner by elimination: returns a ship's `slot` (0/1), 'draw', or null (ongoing).
// 1v1 only — good enough for N players would need a team/FFA rework.
export function checkWinner(state) {
  const ships = Object.values(state.ships);
  if (ships.length < 2) return null;
  const alive = ships.filter(s => !s.dead);
  if (alive.length === ships.length) return null;
  if (alive.length === 0) return 'draw';
  return alive[0].slot;
}

// Trim state to what clients need to render.
export function serialize(state) {
  const ships = {};
  for (const id in state.ships) {
    const s = state.ships[id];
    ships[id] = {
      x: s.x, y: s.y, angle: s.angle, vx: s.vx, vy: s.vy, hp: s.hp, dead: s.dead,
      thrusting: s.thrusting, invuln: (state._now - s.spawnAt) < C.SPAWN_SHIELD_MS,
    };
  }
  return {
    ships,
    asteroids: state.asteroids.map(a => ({ id: a.id, x: a.x, y: a.y, angle: a.angle, size: a.size, radius: a.radius })),
    bullets: state.bullets.map(b => ({ id: b.id, x: b.x, y: b.y, owner: b.owner })),
    pickups: state.pickups.map(p => ({ id: p.id, x: p.x, y: p.y })),
  };
}
