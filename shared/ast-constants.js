// ═══════════════════════════════════════════════════════════════════════════════
// ASTEROIDS PVP — shared constants. Same arena size as Box Fight's canvas so the
// client can reuse one <canvas> without resizing.
// ═══════════════════════════════════════════════════════════════════════════════

export const AST_W = 1080, AST_H = 792;

// Ships are deliberately larger than a classic Asteroids ship — meatier hitbox,
// easier to read at a glance during a PvP duel.
export const SHIP_RADIUS = 22;
export const SHIP_HP = 100;
export const SHIP_TURN = 0.062;        // rad per ~16.67ms frame
export const SHIP_THRUST = 0.16;       // accel per frame while thrusting
export const SHIP_DRAG = 0.988;        // per-frame velocity retention (light space drag)
export const SHIP_MAX_SPEED = 7.2;
export const SPAWN_SHIELD_MS = 2000;   // brief invuln after (re)spawn

export const BULLET_SPEED = 9.5;
export const BULLET_LIFE_FRAMES = 62;
export const BULLET_CD = 260;          // ms between shots
export const BULLET_SHIP_DMG = 12;
export const BULLET_AST_DMG = 20;
export const BULLET_RADIUS = 3;

export const AST_SIZES = {
  large:  { radius: 46, hp: 60, speed: 1.6, dmg: 26, dropChance: 0.42, splitsInto: 'medium' },
  medium: { radius: 27, hp: 30, speed: 2.3, dmg: 15, dropChance: 0.26, splitsInto: 'small'  },
  small:  { radius: 14, hp: 15, speed: 3.1, dmg: 8,  dropChance: 0.14, splitsInto: null     },
};
export const AST_SPLIT_COUNT = 2;
export const AST_MIN_COUNT = 5;
export const AST_SPAWN_MS = 3200;
export const AST_INITIAL_COUNT = 6;
export const AST_RAM_SELF_DMG = 12;     // damage the rock takes from a ship ramming it

export const PICKUP_RADIUS = 11;
export const PICKUP_HEAL = 22;
export const PICKUP_LIFE_MS = 9000;

export const SHIP_SPAWNS = [
  { x: AST_W * 0.14, y: AST_H * 0.5, angle: 0 },
  { x: AST_W * 0.86, y: AST_H * 0.5, angle: Math.PI },
];

// ─── Solo Arcade mode — classic 1979 Asteroids scoring ────────────────────────
export const AST_SCORE = { large: 20, medium: 50, small: 100 };
export const SOLO_SPAWN = { x: AST_W * 0.5, y: AST_H * 0.5, angle: -Math.PI / 2 };
export const SOLO_LIVES = 3;
export const SOLO_EXTRA_LIFE_SCORE = 10000;   // classic Asteroids' bonus-ship threshold
export const SOLO_WAVE_BASE_COUNT = 4;
export const SOLO_WAVE_COUNT_STEP = 2;
export const SOLO_WAVE_MAX_COUNT = 16;
export const SOLO_WAVE_CLEAR_DELAY_MS = 2200;
