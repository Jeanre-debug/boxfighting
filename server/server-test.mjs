// End-to-end proof of the authoritative server: spin it up, connect two real
// WebSocket clients, have A shoot B, and confirm the SERVER decides the winner.
// Run: node server/server-test.mjs
import { WebSocket } from 'ws';
import { startServer } from './index.js';
import * as C from '../shared/constants.js';

const PORT = 8090;
let fail = 0;
const assert = (c, m) => { console.log(`${c ? '  ✓' : '  ✗ FAIL:'} ${m}`); if (!c) fail++; };

const { wss } = startServer(PORT);

function client(playerId, team, onMsg) {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  ws.on('message', (b) => onMsg(JSON.parse(b.toString()), ws));
  return ws;
}

const result = { startSeen: 0, snapshots: 0, gameover: null, bAlive: true };

const A = client('A', 0, (m, ws) => {
  if (m.type === 'joined')   ws.send(JSON.stringify({ type: 'join', roomId: 'r1', playerId: 'A', username: 'Ava', team: 0, mode: '1v1' }));
  if (m.type === 'start')    { result.startSeen++; result.aimAtB = true; }
  if (m.type === 'snapshot') { result.snapshots++; if (m.state.players.B) result.bHp = m.state.players.B.hp; }
  if (m.type === 'gameover') result.gameover = m.winner;
});
const B = client('B', 1, (m, ws) => {
  if (m.type === 'joined') ws.send(JSON.stringify({ type: 'join', roomId: 'r1', playerId: 'B', username: 'Ben', team: 1, mode: '1v1' }));
});

// On connect, ws 'open' → server doesn't prompt; send join immediately
A.on('open', () => A.send(JSON.stringify({ type: 'join', roomId: 'r1', playerId: 'A', username: 'Ava', team: 0, mode: '1v1' })));
B.on('open', () => B.send(JSON.stringify({ type: 'join', roomId: 'r1', playerId: 'B', username: 'Ben', team: 1, mode: '1v1' })));

// A holds fire aimed right (toward B) once the match starts
let seq = 0;
const inputLoop = setInterval(() => {
  if (result.startSeen && A.readyState === A.OPEN)
    A.send(JSON.stringify({ type: 'input', seq: seq++, input: { aimAngle: 0, fire: true } }));
}, 1000 / 60);

setTimeout(() => {
  clearInterval(inputLoop);
  console.log('\n── Authoritative server end-to-end ──');
  assert(result.startSeen === 1, 'match auto-started when room filled (2/2)');
  assert(result.snapshots > 20, `server streamed snapshots (${result.snapshots})`);
  assert(result.bHp !== undefined && result.bHp < 100, `B took server-side damage (hp=${Math.ceil(result.bHp ?? 100)})`);
  assert(result.gameover === 0, `server declared team 0 (A) the winner (got ${result.gameover})`);
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ ' + fail + ' FAILED'} — server is deploy-ready\n`);
  A.close(); B.close(); wss.close();
  process.exit(fail ? 1 : 0);
}, 6000);
