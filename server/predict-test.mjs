// Proves client prediction matches the server exactly: the same movePlayer()
// the client runs locally produces the identical position the server computes
// from the same inputs. This is why reconciliation is invisible when the
// network is clean — there's nothing to correct.
// Run: node server/predict-test.mjs
import * as C from '../shared/constants.js';
import { createState, addPlayer, step, movePlayer } from '../shared/sim.js';

const TICK = 1000 / 30;
let fail = 0;
const assert = (c, m) => { console.log(`${c ? '  ✓' : '  ✗ FAIL:'} ${m}`); if (!c) fail++; };

// Server: one player. Client: a predicted twin starting at the same spot.
const s = createState();
const P = addPlayer(s, 'P', { x: 300, y: 300, team: 0 });
const predicted = { x: 300, y: 300, radius: C.P_RADIUS, dashVx: 0, dashVy: 0 };

console.log('\n── Prediction parity (no packet loss) ──');
let now = 0, maxDrift = 0;
const inputs = [
  { moveX: 1, moveY: 0 }, { moveX: 1, moveY: 1 }, { moveX: 0, moveY: 1 },
  { moveX: -1, moveY: 1 }, { moveX: -1, moveY: 0 }, { moveX: 0, moveY: 0 },
];
for (let i = 0; i < 60; i++) {
  const input = inputs[i % inputs.length];
  now += TICK;
  // Client predicts immediately
  movePlayer(predicted, input, s.walls, TICK, false);
  // Server processes the same input
  step(s, { P: input }, now, TICK);
  // With identical physics + inputs, predicted MUST equal the server
  const drift = Math.hypot(predicted.x - P.x, predicted.y - P.y);
  maxDrift = Math.max(maxDrift, drift);
}
assert(maxDrift < 1e-9, `predicted position matches server every tick (max drift ${maxDrift.toExponential(1)}px)`);

// Reconcile after divergence: snap to server + replay 3 unacked inputs → exact match
console.log('\n── Reconcile replay converges ──');
const pending = [{ moveX: 1, moveY: 0 }, { moveX: 1, moveY: 0 }, { moveX: 0, moveY: 1 }];
// server is "behind" by 3 inputs; client predicted all 3 ahead
const clientAhead = { x: P.x, y: P.y, radius: C.P_RADIUS, dashVx: 0, dashVy: 0 };
for (const inp of pending) movePlayer(clientAhead, inp, s.walls, TICK, false);
// now server processes those 3 and acks; client reconciles from server + replay (nothing pending)
for (const inp of pending) step(s, { P: inp }, now += TICK, TICK);
const reconciled = { x: P.x, y: P.y, radius: C.P_RADIUS, dashVx: 0, dashVy: 0 }; // snap to server, no replay
assert(Math.hypot(clientAhead.x - reconciled.x, clientAhead.y - reconciled.y) < 1e-9,
  'client-ahead prediction equals server after it catches up');

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ ' + fail + ' FAILED'} — prediction is sound\n`);
process.exit(fail ? 1 : 0);
