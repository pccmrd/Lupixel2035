import test from 'node:test';
import assert from 'node:assert/strict';
import { Ship } from '../src/game/ship.js';
import { SHIP_SCALE } from '../src/game/shipConfig.js';
import { MAT } from '../src/world/materials.js';
import { World } from '../src/world/world.js';
import { desiredOrbitVelocity } from '../src/game/orbit.js';

function fakeWorld() {
  const body = { id: 'test', name: 'TEST', x: 0, y: 1000, vx: 0, vy: 0, radius: 10 };
  return {
    time: 0,
    gravityAt: () => ({ x: 0, y: 0, magnitude: 0, dominant: body, dominantMagnitude: 0 }),
    nearestBody: () => ({
      body, distance: 1000, altitude: 990,
      gravity: { x: 0, y: 0, magnitude: 0 },
      away: { x: 0, y: -1 }
    }),
    sampleMaterial: () => null,
    pushEvent: () => {}
  };
}

function inputWith(down = []) {
  const set = new Set(down);
  return {
    anyDown: (...codes) => codes.some((code) => set.has(code)),
    isDown: (code) => set.has(code)
  };
}

test('initial spawn clear Selene with a near-circular orbital velocity', () => {
  const world = new World(0x51a7);
  const ship = new Ship(world);
  const moon = world.bodyById.get('selene');
  const desired = desiredOrbitVelocity(moon, ship.x, ship.y, Math.hypot(ship.x, ship.y), 1);
  assert.ok(Math.hypot(ship.x, ship.y) - moon.radius > 150);
  assert.ok(Math.abs(ship.vx - desired.x) < 2);
  assert.ok(Math.abs(ship.vy - desired.y) < 0.01);
});

test('vacuum flight preserves momentum with no passive damping', () => {
  const world = fakeWorld();
  const ship = new Ship(world);
  ship.x = 0;
  ship.y = 0;
  ship.vx = 10;
  ship.vy = 0;
  ship.angle = 0;
  ship.omega = 0;
  ship.gear = false;
  ship.landed = false;
  ship.update(1, inputWith(), world);
  assert.equal(ship.x, 10);
  assert.equal(ship.vx, 10);
  assert.equal(ship.omega, 0);
});

test('main thrust consumes fuel and adds Newtonian acceleration', () => {
  const world = fakeWorld();
  const ship = new Ship(world);
  ship.x = 0;
  ship.y = 0;
  ship.vx = 0;
  ship.vy = 0;
  ship.angle = 0;
  ship.gear = false;
  ship.landed = false;
  const fuelBefore = ship.fuel;
  ship.update(1, inputWith(['KeyW']), world);
  assert.ok(ship.vx > SHIP_SCALE.mainThrust * 0.98);
  assert.ok(ship.fuel < fuelBefore);
  assert.ok(ship.thrustLevel > 0);
});

test('cargo accepts material units and sells them for credits', () => {
  const ship = new Ship(fakeWorld());
  ship.credits = 0;
  assert.equal(ship.addMaterial(MAT.ORE_DUST), true);
  assert.ok(ship.cargo.ore > 0);
  const result = ship.sellCargo('ore', 100);
  assert.ok(result);
  assert.ok(result.revenue > 0);
  assert.equal(ship.credits, result.revenue);
  assert.equal(ship.cargo.ore, 0);
});
