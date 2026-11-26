import test from 'node:test';
import assert from 'node:assert/strict';
import { Astronaut, EVA_TUNING } from '../src/game/eva.js';

function fixture() {
  const ship = {
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, energy: 100, landed: true,
    landedBody: { x: 0, y: 0, radius: 30 },
    upVector: () => ({ x: 0, y: -1 }),
    notify() {},
    consumeEnergy(amount) { this.energy -= amount; return true; }
  };
  const world = {
    events: [],
    gravityAt: () => ({ x: 0, y: 0, magnitude: 0 }),
    sampleMaterial: () => null,
    nearestBody: () => ({ body: null, distance: 1000 }),
    pushEvent(event) { this.events.push(event); },
    scan: () => [{ id: 'survey' }],
    interact: () => ({ type: 'derelict', oxygen: 0 })
  };
  return { ship, world, eva: new Astronaut(world, ship) };
}

const controls = (keys = []) => ({
  anyDown: (...codes) => codes.some((code) => keys.includes(code)),
  isDown: (code) => keys.includes(code)
});

test('EVA begins from a landed ship and uses continuous suit thrusters', () => {
  const { eva, ship } = fixture();
  assert.equal(eva.start(), true);
  assert.equal(eva.active, true);
  assert.equal(eva.tetherDistance, 48);
  const x = eva.x;
  eva.update(1 / 60, controls(['KeyW']));
  assert.ok(eva.x > x);
  assert.ok(eva.thrustLevel > 0);
  assert.equal(ship.landed, true);
});

test('physical tether limits separation and return guidance recovers the astronaut', () => {
  const { eva } = fixture();
  eva.start();
  eva.x = 1000;
  eva.update(1 / 60, controls());
  assert.ok(eva.tetherDistance <= EVA_TUNING.tetherMax + 0.001);
  eva.returning = true;
  for (let frame = 0; frame < 900 && eva.active; frame++) eva.update(1 / 60, controls());
  assert.equal(eva.active, false);
});

test('return guidance slides around a cave lip instead of steering into it', () => {
  const { eva, ship, world } = fixture();
  const wall = { id: 'cave-wall', x: -20, y: 0, radius: 60 };
  ship.x = 40;
  world.sampleMaterial = (x, y) => {
    if (x < -22 || x > -18 || Math.abs(y) > 25) return null;
    return {
      body: wall, material: 1, x, y,
      normal: { x: x < -20 ? -1 : 1, y: 0 }
    };
  };
  world.nearestBody = (x, y) => ({ body: wall, distance: Math.hypot(x + 20, y) });
  eva.active = true;
  eva.returning = true;
  eva.x = -40;
  eva.y = 0;

  for (let frame = 0; frame < 1800 && eva.active; frame++) eva.update(1 / 60, controls());
  assert.equal(eva.active, false);
});

test('suit scanning consumes shared energy and site interaction reports discoveries', () => {
  const { eva, ship, world } = fixture();
  eva.start();
  assert.equal(eva.scan(), true);
  assert.ok(ship.energy < 100);
  assert.equal(eva.scanCooldown, EVA_TUNING.scanCooldown);
  assert.ok(world.events.some((event) => event.type === 'scan'));
  assert.equal(eva.interact().type, 'derelict');
});
