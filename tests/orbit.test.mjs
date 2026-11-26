import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitController, desiredOrbitVelocity } from '../src/game/orbit.js';
import { Ship } from '../src/game/ship.js';
import { SHIP_SCALE } from '../src/game/shipConfig.js';

function fixture(options = {}) {
  const body = {
    id: 'target', name: 'TEST TARGET', type: 'asteroid',
    x: 0, y: 0, vx: 3, vy: -2,
    radius: 100, mu: 100 * 100 * 1.08
  };
  const world = {
    time: 0,
    nearestBody: () => ({ body, distance: options.distance || 400, altitude: (options.distance || 400) - body.radius, gravity: { x: 0, y: 0, magnitude: 0 } }),
    gravityAt: (x, y) => {
      const r2 = x * x + y * y + (body.radius * 0.22) ** 2;
      const f = body.mu / Math.pow(r2, 1.5);
      return { x: -x * f, y: -y * f, magnitude: Math.hypot(x, y) * f, dominant: body };
    },
    pushEvent: () => {},
    sampleMaterial: () => null
  };
  const ship = new Ship(world);
  ship.x = options.distance || 400;
  ship.y = 0;
  ship.vx = body.vx;
  ship.vy = body.vy + Math.sqrt(body.mu) * ship.x / Math.pow(ship.x * ship.x + (body.radius * 0.22) ** 2, 0.75);
  ship.gear = false;
  return { world, ship, body };
}

function noInput() {
  return { anyDown: () => false };
}

test('orbit target is selected without changing ship pose', () => {
  const { ship, body } = fixture();
  const orbit = new OrbitController({ nearestBody: () => ({ body }), pushEvent: () => {} }, ship);
  const before = { x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy };
  orbit.toggle();
  assert.equal(orbit.target, body);
  assert.deepEqual({ x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy }, before);
});

test('orbit engagement rejects terrain, excessive range and excessive relative speed', () => {
  const near = fixture({ distance: 115 });
  const nearOrbit = new OrbitController(near.world, near.ship);
  assert.match(nearOrbit.engagementCheck().reason, /SELECT/);
  nearOrbit.toggle();
  assert.match(nearOrbit.lastRejection, /CLEAR OF THE SURFACE/);
  assert.equal(nearOrbit.target, null, 'a rejected target is reselected on the next attempt');
  near.ship.x = 0;
  near.ship.y = near.body.radius + 500;
  near.ship.vx = near.body.vx + 4;
  near.ship.vy = near.body.vy;
  nearOrbit.toggle();
  assert.equal(nearOrbit.active, true);
  nearOrbit.cancel();

  const far = fixture({ distance: 1400 });
  const farOrbit = new OrbitController(far.world, far.ship);
  farOrbit.selectTarget(far.body);
  assert.match(farOrbit.engagementCheck().reason, /OUTSIDE/);

  const fast = fixture();
  fast.ship.vx += 80;
  const fastOrbit = new OrbitController(fast.world, fast.ship);
  fastOrbit.selectTarget(fast.body);
  assert.match(fastOrbit.engagementCheck().reason, /SLOW TO TARGET/);
});

test('orbit capture moves through thrusters, burns fuel and enters a slow circular orbit', () => {
  const { world, ship, body } = fixture({ distance: 620 });
  const orbit = new OrbitController(world, ship);
  ship.orbitControl = orbit;
  const initial = { x: ship.x, y: ship.y };
  const fuelBefore = ship.fuel;
  assert.equal(orbit.toggle(), true);
  let correctionFrames = 0;
  let sawBurn = false;
  for (let frame = 0; frame < 60 * 180; frame++) {
    const burn = orbit.update(1 / 60, noInput());
    if (burn) sawBurn = true;
    if (orbit.phase === 'correction') correctionFrames++;
    ship.update(1 / 60, noInput(), world);
    if (orbit.phase === 'correction' && orbit.error < 0.5 && correctionFrames > 120) break;
  }
  assert.ok(sawBurn, 'capture produces visible thruster acceleration');
  assert.ok(ship.fuel < fuelBefore, 'capture consumes fuel');
  assert.ok(Math.hypot(ship.x - initial.x, ship.y - initial.y) > 5, 'capture does not teleport');
  assert.equal(orbit.phase, 'correction');
  const distance = Math.hypot(ship.x - body.x, ship.y - body.y);
  assert.ok(Math.abs(distance - orbit.radius) < 8);
  const desired = desiredOrbitVelocity(body, ship.x, ship.y, orbit.radius, orbit.direction);
  const error = Math.hypot(ship.vx - desired.x, ship.vy - desired.y);
  assert.ok(error < 2.2, `expected a slow orbit, got ${error.toFixed(2)} m/s error`);
});

test('acquired orbit holds through occasional low-thrust correction burns', () => {
  const { world, ship, body } = fixture();
  const orbit = new OrbitController(world, ship);
  ship.orbitControl = orbit;
  orbit.toggle();
  orbit.phase = 'correction';
  orbit.error = 0;
  let burnFrames = 0;
  const radius = orbit.radius;
  for (let frame = 0; frame < 60 * 30; frame++) {
    const burn = orbit.update(1 / 60, noInput());
    if (burn) {
      burnFrames++;
      assert.ok(burn.magnitude <= SHIP_SCALE.rcsThrust + 0.00001);
    }
    ship.update(1 / 60, noInput(), world);
  }
  assert.ok(burnFrames > 0 && burnFrames < 60 * 30, 'station keeping fires intermittently');
  assert.equal(orbit.active, true, 'a stable captured orbit remains engaged until O is pressed');
  assert.ok(Math.abs(Math.hypot(ship.x - body.x, ship.y - body.y) - radius) < 10);
});

test('O disengagement and manual takeover cancel guidance without teleporting', () => {
  const { world, ship } = fixture();
  const orbit = new OrbitController(world, ship);
  orbit.toggle();
  orbit.update(1 / 60, noInput());
  const before = { x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy };
  orbit.toggle();
  assert.equal(orbit.active, false);
  assert.equal(orbit.burn, null);
  assert.deepEqual({ x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy }, before);

  orbit.toggle();
  orbit.update(1 / 60, { anyDown: (...codes) => codes.includes('KeyW') });
  assert.equal(orbit.active, false);
  assert.equal(orbit.burn, null);
  assert.deepEqual({ x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy }, before);
});
