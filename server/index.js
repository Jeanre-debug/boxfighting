// ═══════════════════════════════════════════════════════════════════════════════
// AUTHORITATIVE GAME SERVER (P2)
//
// Runs the shared simulation at 30 Hz per room. Clients send INPUTS only; the
// server owns all state and broadcasts snapshots. This is what makes online play
// cheat-proof: a client cannot set its own HP or teleport — it can only press
// buttons, and the server decides what happens.
//
// Protocol (JSON over WebSocket):
//   client → server
//     { type:'join',  roomId, playerId, username, team, mode }
//     { type:'input', input:{moveX,moveY,aimAngle,fire,build,weapon,dash,edit,
//                            reset,reload,mini,bigpot}, seq }
//     { type:'leave' }
//   server → client
//     { type:'joined',   playerId, roomId, waiting }
//     { type:'start',    mode, assignments:[{playerId,username,team,x,y}] }
//     { type:'snapshot', tick, now, state, events, ackSeq }
//     { type:'playerLeft', playerId }
//     { type:'gameover', winner }   // winning team (0/1) or 'draw'
// ═══════════════════════════════════════════════════════════════════════════════
import { WebSocketServer } from 'ws';
import { createState, addPlayer, removePlayer, step as simStep } from '../shared/sim.js';
import * as C from '../shared/constants.js';

const TICK_HZ = 30;
const TICK_MS = 1000 / TICK_HZ;

const expectedPlayers = (mode) => (mode === '2v2' ? 4 : 2);

function spawnPoints(mode) {
  if (mode === '2v2') return [
    { team: 0, x: C.CELL * 2.5, y: C.H / 3 }, { team: 0, x: C.CELL * 2.5, y: C.H * 2 / 3 },
    { team: 1, x: C.W - C.CELL * 2.5, y: C.H / 3 }, { team: 1, x: C.W - C.CELL * 2.5, y: C.H * 2 / 3 },
  ];
  return [{ team: 0, x: C.CELL * 2.5, y: C.H / 2 }, { team: 1, x: C.W - C.CELL * 2.5, y: C.H / 2 }];
}

// Trim sim state to what clients need to render (keeps snapshots small).
function serializeState(s) {
  const players = {};
  for (const id in s.players) {
    const p = s.players[id];
    players[id] = {
      x: p.x, y: p.y, aimAngle: p.aimAngle, hp: p.hp, shield: p.shield,
      dead: p.dead, weapon: p.weapon, team: p.team,
      minis: p.minis, bigPots: p.bigPots,
      materials: p.materials === Infinity ? -1 : p.materials,
      dashReadyAt: p.dashReadyAt, potionEnd: p.potionEnd, potionType: p.potionType,
      swingEnd: p.swingEnd,
      ammo: Object.fromEntries(C.WEAPON_ORDER.map(id => [id, p.ammo[id].count])),
    };
  }
  const bullets = s.bullets.map(b => ({
    id: b.id, x: b.x, y: b.y, prevX: b.prevX, prevY: b.prevY,
    col: b.col, sz: b.sz, owner: b.owner, team: b.team, isRocket: b.isRocket,
  }));
  return { players, walls: s.walls, bullets };
}

function aliveByTeam(state) {
  const t = { 0: 0, 1: 0 };
  for (const id in state.players) { const p = state.players[id]; if (!p.dead) t[p.team]++; }
  return t;
}

export function startServer(port) {
  const rooms = new Map();
  const wss = new WebSocketServer({ port });
  console.log(`[boxfight] authoritative server listening on :${port} (${TICK_HZ}Hz)`);

  const broadcast = (room, obj) => {
    const msg = JSON.stringify(obj);
    for (const ws of room.sockets.values()) if (ws.readyState === ws.OPEN) ws.send(msg);
  };

  function makeRoom(id, mode) {
    return { id, mode, state: createState(), sockets: new Map(), pending: new Map(),
             started: false, over: false, simNow: 0, handle: null, lastAck: {} };
  }

  function startMatch(room) {
    room.started = true;
    const pts = spawnPoints(room.mode);
    const used = { 0: 0, 1: 0 };
    const assignments = [];
    for (const [pid, ws] of room.sockets) {
      const t = ws.team;
      const slot = pts.filter(s => s.team === t)[used[t]++] || pts.find(s => s.team === t);
      addPlayer(room.state, pid, { x: slot.x, y: slot.y, team: t });
      assignments.push({ playerId: pid, username: ws.username, team: t, x: slot.x, y: slot.y });
    }
    broadcast(room, { type: 'start', mode: room.mode, assignments });
    room.handle = setInterval(() => tick(room), TICK_MS);
  }

  function tick(room) {
    if (room.over) return;
    room.simNow += TICK_MS;
    const inputs = {};
    for (const [pid, inp] of room.pending) {
      inputs[pid] = inp;
      // Ack the input ACTUALLY simulated this tick (not merely received) so the
      // client replays exactly the right unacked inputs during reconciliation.
      if (typeof inp.seq === 'number') room.lastAck[pid] = inp.seq;
    }

    const events = simStep(room.state, inputs, room.simNow, TICK_MS);

    // Consume one-shot edge inputs so they fire exactly once
    for (const inp of room.pending.values())
      inp.dash = inp.edit = inp.reset = inp.reload = inp.mini = inp.bigpot = false;

    const snap = {
      type: 'snapshot', tick: room.state.tick, now: room.simNow,
      state: serializeState(room.state), events,
    };
    // per-client ack of their last processed input seq (for P3 reconciliation)
    for (const [pid, ws] of room.sockets) {
      if (ws.readyState !== ws.OPEN) continue;
      ws.send(JSON.stringify({ ...snap, ackSeq: room.lastAck[pid] ?? 0 }));
    }

    // Win check
    const alive = aliveByTeam(room.state);
    if (alive[0] === 0 || alive[1] === 0) {
      const winner = alive[0] === 0 && alive[1] === 0 ? 'draw' : (alive[0] > 0 ? 0 : 1);
      endMatch(room, winner);
    }
  }

  function endMatch(room, winner) {
    room.over = true;
    broadcast(room, { type: 'gameover', winner });
    clearInterval(room.handle);
    setTimeout(() => rooms.delete(room.id), 10000);
  }

  function handleJoin(ws, msg) {
    const { roomId, playerId, username, team, mode } = msg;
    if (!roomId || !playerId) return;
    let room = rooms.get(roomId);
    if (!room) { room = makeRoom(roomId, mode || '1v1'); rooms.set(roomId, room); }
    if (room.started) { ws.send(JSON.stringify({ type: 'joined', playerId, roomId, waiting: false, full: true })); return; }
    ws.playerId = playerId; ws.roomId = roomId; ws.username = username || 'Player'; ws.team = team ?? 0;
    room.sockets.set(playerId, ws);
    const need = expectedPlayers(room.mode);
    ws.send(JSON.stringify({ type: 'joined', playerId, roomId, waiting: room.sockets.size < need }));
    if (room.sockets.size >= need) startMatch(room);
  }

  function handleInput(ws, msg) {
    const room = rooms.get(ws.roomId); if (!room || !ws.playerId) return;
    const inp = msg.input || {};
    const prev = room.pending.get(ws.playerId);
    if (prev) {  // OR pending edges so a press between ticks is never lost
      inp.dash   = inp.dash   || prev.dash;
      inp.edit   = inp.edit   || prev.edit;
      inp.reset  = inp.reset  || prev.reset;
      inp.reload = inp.reload || prev.reload;
      inp.mini   = inp.mini   || prev.mini;
      inp.bigpot = inp.bigpot || prev.bigpot;
    }
    inp.seq = msg.seq;            // ack happens at tick time, when it's simulated
    room.pending.set(ws.playerId, inp);
  }

  function handleLeave(ws) {
    const room = rooms.get(ws.roomId); if (!room) return;
    room.sockets.delete(ws.playerId);
    room.pending.delete(ws.playerId);
    removePlayer(room.state, ws.playerId);
    broadcast(room, { type: 'playerLeft', playerId: ws.playerId });
    if (room.sockets.size === 0) { clearInterval(room.handle); rooms.delete(room.id); return; }
    if (room.started && !room.over) {
      const alive = aliveByTeam(room.state);
      if (alive[0] === 0 || alive[1] === 0) endMatch(room, alive[0] > 0 ? 0 : 1);
    }
  }

  wss.on('connection', (ws) => {
    ws.playerId = null; ws.roomId = null;
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg.type === 'join') handleJoin(ws, msg);
      else if (msg.type === 'input') handleInput(ws, msg);
      else if (msg.type === 'leave') handleLeave(ws);
      else if (msg.type === 'ping') { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'pong', t: msg.t })); }
    });
    ws.on('close', () => handleLeave(ws));
    ws.on('error', () => {});
  });

  return { wss, rooms };
}

// Auto-start when run directly (Railway: `npm start`)
const isMain = process.argv[1] && (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('server/index.js'));
if (isMain) startServer(Number(process.env.PORT) || 8080);
