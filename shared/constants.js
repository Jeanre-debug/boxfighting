// ═══════════════════════════════════════════════════════════════════════════════
// SHARED CONSTANTS — imported by both the browser client and the Node game server.
// Pure data only: no DOM, no canvas, no globals.
// ═══════════════════════════════════════════════════════════════════════════════

export const CELL = 72, COLS = 15, ROWS = 11;
export const W = COLS * CELL, H = ROWS * CELL;
export const WALL_THICK = 12, WALL_HP = 100, WALL_START_HP = 35, WALL_REGEN = 10;
export const P_RADIUS = 12, P_SPEED = 2.1, BOT_BASE_SPEED = 1.7;
export const BULLET_SPEED = 8;
export const MAT_MAX = 300, MAT_COST = 10, MAT_REGEN = 0.06;
export const BUILD_CD = 140;
export const SUB_STEPS = 4, WIN_FRAC = 0.25;
export const FRAME_MS = 1000 / 60;
export const DASH_DUR = 200, DASH_CD = 3000, DASH_SPD = 16;
export const EXPL_RADIUS = 90;
export const COMBO_RESET = 2400;
export const SHIELD_MAX = 150;
export const MINI_SHIELD_CAP = 50;
export const MINI_AMOUNT = 25;
export const BIG_POT_AMOUNT = 50;
export const MINI_USE_MS = 2000;
export const BIG_USE_MS = 4000;
export const PLAYER_MINIS = 3;
export const PLAYER_BIGPOTS = 1;

export const WEAPON_ORDER = ['ar', 'smg', 'shotgun', 'sniper', 'rocket', 'pickaxe'];

export const WEAPONS = {
  ar:      { name:'AR',      cd:140,  wallDmg:18, playerDmg:12, range:140, spread:0.03, pellets:1, magSize:30, reloadTime:1800, bLen:13, bW:2,  col:'#ffe944', sz:3 },
  smg:     { name:'SMG',     cd:80,   wallDmg:7,  playerDmg:6,  range:60,  spread:0.11, pellets:1, magSize:25, reloadTime:1300, bLen:9,  bW:2,  col:'#88ffcc', sz:2 },
  shotgun: { name:'SHOTGUN', cd:700,  wallDmg:8,  playerDmg:7,  range:28,  spread:0.38, pellets:8, magSize:8,  reloadTime:2200, bLen:7,  bW:5,  col:'#ff9933', sz:2 },
  sniper:  { name:'SNIPER',  cd:1100, wallDmg:22, playerDmg:50, range:500, spread:0,    pellets:1, magSize:5,  reloadTime:2800, bLen:22, bW:1,  col:'#00eeff', sz:5, pierce:true },
  rocket:  { name:'ROCKET',  cd:1400, wallDmg:0,  playerDmg:0,  range:260, spread:0,    pellets:1, magSize:2,  reloadTime:3500, bLen:15, bW:7,  col:'#ff5500', sz:7, isRocket:true },
  pickaxe: { name:'PICKAXE', cd:650,  wallDmg:40, playerDmg:15, range:0,   spread:0,    pellets:0, magSize:Infinity, reloadTime:0, bLen:0, bW:0, col:'#f0c83c', sz:0, reach:46, arc:Math.PI/5, swingDur:280 },
};

export const BOT_DIFF = {
  easy:   { spd:0.65, fireMult:1.9, aimSpread:0.26, edits:false, peeks:false, idealDist:150, weps:['ar'] },
  medium: { spd:1.0,  fireMult:1.0, aimSpread:0.09, edits:false, peeks:false, idealDist:130, weps:['ar','smg'] },
  hard:   { spd:1.3,  fireMult:0.7, aimSpread:0.02, edits:true,  peeks:true,  idealDist:110, weps:['shotgun','smg'] },
};

export const COMBO_LABELS = ['', '', 'DOUBLE!', 'TRIPLE!', 'QUAD!', 'PENTA!', 'RAMPAGE!'];
