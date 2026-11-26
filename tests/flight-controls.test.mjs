import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { Ship } from '../src/game/ship.js';
import { DockingController } from '../src/game/docking.js';
import { attachShip, SHIP_SCALE, surfaceVelocity } from '../src/game/shipConfig.js';

function flatWorld() {
  const body = {
    id: 'pad', name: 'PAD', x: 0, y: 1000, vx: 3, vy: -2, omega: 0, rotation: 0,
    w: 100, h: 100, radius: 20, integrity: () => 1, market: true,
    dock: { x: 50, y: 23, width: 80, height: 16, captureRadius: 24 },
    localToWorld(x, y) { return { x: this.x + x - this.w / 2, y: this.y + y - this.h / 2 }; },
    worldToLocal(x, y) { return { x: x - this.x + this.w / 2, y: y - this.y + this.h / 2 }; }
  };
  const world = {
    time: 0, bodies: [body],
    sampleMaterial(x, y) {
      const local = body.worldToLocal(x, y);
      return local.y > 38 ? { body, material: 2, x, y, normal: { x: 0, y: -1 } } : null;
    },
    gravityAt: () => ({ x: 0, y: 4, magnitude: 4 }),
    nearestBody: () => ({ body, distance: 60, altitude: 40, gravity: { x: 0, y: 4, magnitude: 4 }, away: { x: 0, y: -1 } }),
    pushEvent() {},
    findDock(ship) { return ship.docking?.dock || null; }
  };
  return { world, body };
}

function inputWith(down = []) {
  const set = new Set(down);
  return { anyDown: (...codes) => codes.some((code) => set.has(code)), isDown: (code) => set.has(code) };
}

test('surface hold follows body velocity and survives changing local support', () => {
  const { world, body } = flatWorld();
  const ship = new Ship(world);
  attachShip(ship, body, 50, 23, 0, world);
  body.vx = 9;
  ship.update(1 / 60, inputWith(), world);
  assert.equal(ship.landed, true);
  assert.equal(ship.vx, 9);
  assert.equal(ship.x, 0);
  assert.equal(ship.y, 973);

  const original = world.sampleMaterial;
  world.sampleMaterial = (x, y) => {
    const local = body.worldToLocal(x, y);
    return original(x, y) && local.x > 45 ? { body, material: 2, x, y, normal: { x: 0, y: -1 } } : null;
  };
  ship.update(1 / 60, inputWith(), world);
  assert.equal(ship.landed, true, 'one remaining foot keeps the attachment stable');
});

test('safe geared contact attaches and manual thrust lifts off once', () => {
  const { world, body } = flatWorld();
  const ship = new Ship(world);
  ship.x = 0;
  ship.y = 980;
  ship.prevY = 980;
  ship.vx = body.vx;
  ship.vy = body.vy + 0.7;
  ship.gear = true;
  ship.invulnerable = 0;
  ship.touchdownCooldown = 0;
  ship.update(1 / 60, inputWith(), world);
  assert.equal(ship.landed, true);
  assert.ok(ship.surfaceAnchor);

  const launches = [];
  world.pushEvent = (event) => { if (event.type === 'launch') launches.push(event); };
  ship.update(1 / 60, inputWith(['KeyW']), world);
  assert.equal(ship.landed, false);
  assert.equal(ship.vx > body.vx, true);
  ship.update(1 / 60, inputWith(['KeyW']), world);
  assert.equal(launches.length, 1, 'takeoff is not retriggered every frame');
});

test('pad clamps engage only inside the aligned landing slot', () => {
  const { world, body } = flatWorld();
  const ship = new Ship(world);
  const docking = new DockingController(world, ship);
  ship.docking = docking;
  attachShip(ship, body, 50, 23, 0, world);
  ship.vx = body.vx;
  ship.vy = body.vy;
  docking.update(1 / 60);
  assert.equal(docking.phase, 'capturing');
  docking.update(0.4);
  assert.equal(docking.phase, 'clamped');
  assert.equal(docking.dock.ready, true);

  ship.update(1 / 60, inputWith(['KeyW']), world);
  assert.equal(docking.phase, 'released');
  assert.equal(ship.landed, false);
  assert.equal(docking.dock, null);
});

test('secured clamps hold the exact pad pose without generic terrain support', () => {
  const { world, body } = flatWorld();
  const ship = new Ship(world);
  const docking = new DockingController(world, ship);
  ship.docking = docking;
  attachShip(ship, body, 50, 23, 0, world);
  docking.update(1 / 60);
  docking.update(0.4);

  world.sampleMaterial = () => null;
  body.x += 12;
  body.y -= 8;
  body.vx = 7;
  body.vy = -4;
  ship.update(1 / 60, inputWith(), world);
  docking.update(1 / 60);

  const expected = body.localToWorld(50, 23);
  assert.equal(docking.phase, 'clamped');
  assert.equal(ship.landed, true);
  assert.equal(ship.x, expected.x);
  assert.equal(ship.y, expected.y);
  assert.equal(ship.vx, body.vx);
  assert.equal(ship.vy, body.vy);
  assert.equal(ship.surfaceAnchor.x, 50);
  assert.equal(ship.surfaceAnchor.y, 23);
});

test('dock readiness is not inferred from loose proximity', () => {
  const { world, body } = flatWorld();
  const ship = new Ship(world);
  const docking = new DockingController(world, ship);
  ship.docking = docking;
  ship.x = 0;
  ship.y = 970;
  const dock = docking.update(1 / 60);
  assert.ok(dock);
  assert.equal(dock.ready, false);
  assert.equal(world.findDock(ship), dock);
  assert.equal(surfaceVelocity(body, 50, 23).x, body.vx);
});

test('rotating surfaces carry attached ships in both position and attitude', () => {
  const { world, body } = flatWorld();
  const ship = new Ship(world);
  attachShip(ship, body, 50, 23, 0, world);
  body.rotation = 0.1;
  body.omega = 0.2;
  body.vx = 4;
  body.vy = -3;
  ship.update(1 / 60, inputWith(), world);
  const expected = body.localToWorld(50, 23);
  assert.ok(Math.abs(ship.x - expected.x) < 1e-9);
  assert.ok(Math.abs(ship.y - expected.y) < 1e-9);
  assert.ok(Math.abs(ship.angle - body.rotation) < 1e-9);
  const velocity = surfaceVelocity(body, 50, 23);
  assert.equal(ship.vx, velocity.x);
  assert.equal(ship.vy, velocity.y);
  assert.equal(ship.omega, body.omega);
});

test('generated pads place the enlarged landing feet on their surface', () => {
  const world = new World(0x51a7);
  const body = world.bodies.find((candidate) => candidate.id === 'selene');
  const slot = body.dock;
  const ship = new Ship(world);
  attachShip(ship, body, slot.x, slot.y, 0, world);
  assert.equal(body.worldToLocal(ship.x, ship.y).y, slot.y);
  const gearHeightCells = SHIP_SCALE.gearHeight / body.cellScale;
  assert.ok(slot.y + gearHeightCells <= body.h);
  const padPoint = body.localToWorld(slot.x, slot.y + gearHeightCells);
  assert.ok(world.sampleMaterial(padPoint.x, padPoint.y));
});
