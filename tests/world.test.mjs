import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBody, materializeBody } from '../src/world/generation.js';
import { World } from '../src/world/world.js';
import { Ship } from '../src/game/ship.js';
import { DockingController } from '../src/game/docking.js';
import { attachShip } from '../src/game/shipConfig.js';
import { isCollidable, MAT } from '../src/world/materials.js';

test('procedural bodies generate solids, gravity directions and an active material list', () => {
  const body = generateBody({
    id: 'specimen', name: 'SPECIMEN', type: 'asteroid',
    x: 0, y: 0, w: 64, h: 64, radius: 24, g0: 8,
    seed: 0xabcd, structural: true
  });
  assert.ok(body.solidCount > 100);
  assert.ok(body.anchors.length > 0);
  assert.ok(body.active.length > 0);
  assert.equal(body.integrity(), 1);
  assert.equal(body.dir[body.index(32, 32)] & 7, body.dir[body.index(32, 32)]);
  assert.equal(body.surface, null, 'headless generation does not require a DOM canvas');
});

const world = new World();

test('gravity points into the dominant well and weakens with distance', () => {
  const surface = world.gravityAt(0, -270);
  assert.ok(surface.y > 0, 'north-pole gravity pulls toward the moon center');
  assert.ok(surface.magnitude > 10);
  const deep = world.gravityAt(7000, 7000);
  assert.ok(deep.magnitude < surface.magnitude * 0.2);
  assert.equal(world.discoveryCount().max, 297);
  assert.equal(world.discoveryCount().total, 15);
});

test('material samples expose finite world coordinates for collision support', () => {
  const ray = world.raycast(0, -285, 0, 1, 55);
  assert.ok(ray);
  const sample = world.sampleMaterial(ray.x, ray.y, true);
  assert.ok(sample);
  assert.equal(sample.x, ray.x);
  assert.equal(sample.y, ray.y);
  assert.ok(Number.isFinite(sample.localX));
  assert.ok(Number.isFinite(sample.localY));
  assert.ok(Number.isFinite(sample.normal.x));
  assert.ok(Number.isFinite(sample.normal.y));
});

test('raycasts hit destructible dock pixels and explosions remove monolith cells', () => {
  const hit = world.raycast(0, -285, 0, 1, 55);
  assert.ok(hit, 'a downward ray over Selene finds the outpost platform');
  assert.equal(hit.body.id, 'selene');
  assert.ok(isCollidable(hit.material));

  const selene = world.bodyById.get('selene');
  const before = selene.solidCount;
  world.explode(0, -235, 9, 130);
  assert.ok(selene.solidCount < before, 'the blast grinds or vaporizes material');
  assert.ok(world.takeEvents().some((event) => event.type === 'shockwave'));
});

test('docking requires physical attachment before clamps secure the ship', () => {
  const body = world.bodyById.get('selene');
  const ship = new Ship(world);
  const docking = new DockingController(world, ship);
  ship.docking = docking;
  attachShip(ship, body, body.dock.x, body.dock.y, 0, world);
  ship.vx = body.vx;
  ship.vy = body.vy;
  docking.update(1 / 60);
  assert.equal(docking.dock.body.id, 'selene');
  assert.equal(docking.dock.ready, false);
  docking.update(0.4);
  assert.equal(world.findDock(ship).ready, true);

  docking.release();
  ship.gear = false;
  ship.x = 0;
  ship.y = -263;
  assert.equal(docking.update(1 / 60)?.ready ?? false, false);
});

test('orbital population stays lazy while nearby bodies retain material edits', () => {
  const field = new World();
  const unknown = field.bodies.find((body) => body.id === 'bundle-0010');
  assert.equal(field.bodies.length, 294);
  assert.equal(field.bodies.filter((body) => body.id.startsWith('bundle-') && !body.generated).length, 288);
  assert.equal(unknown.catalogued, false);
  const ship = { x: unknown.x + unknown.radius + 80, y: unknown.y };
  assert.equal(field.materializeNear(ship), unknown);
  assert.equal(unknown.generated, true);
  unknown.put(4, 4, MAT.METAL);
  const index = unknown.index(4, 4);
  assert.equal(unknown.mat[index], MAT.METAL);
  field.releaseDistantSurfaces({ x: 7000, y: 7000 });
  field.materializeNear(ship);
  assert.equal(unknown.mat[index], MAT.METAL);
});

test('hidden orbital motion translates bodies physically and haulers deliver new persistent bodies', () => {
  const field = new World();
  const body = field.bodyById.get('bundle-0100');
  const moon = field.bodyById.get('selene');
  const x = body.x;
  const vx = body.vx;
  field.advance(0.25);
  assert.ok(Math.abs(body.x - x - vx * 0.25) < 0.5);
  assert.equal(moon.x, 0);
  assert.equal(moon.y, 0);
  const count = field.bodies.length;
  field.haulers[0].nextArrival = field.time;
  field.advance(0);
  assert.equal(field.bodies.length, count + 1);
  assert.equal(field.bodyById.size, count + 1);
});

test('scanning identifies unknown bodies and documented cave sites can be recovered', () => {
  const field = new World();
  const body = field.bodies.find((candidate) => candidate.id === 'bundle-0030');
  materializeBody(body);
  const found = field.scan(body.x, body.y, 10);
  assert.ok(found.includes(body));
  assert.equal(body.discovered, true);
  assert.ok(body.sites.length >= 2);
  assert.ok(body.sites.every((site) => site.scanned));
  const site = body.sites[0];
  const point = body.localToWorld(site.x, site.y);
  const ship = { credits: 0, cargo: {}, addCargo(commodity, units) { this.cargo[commodity] = (this.cargo[commodity] || 0) + units; } };
  const result = field.interact(point.x, point.y, 2, ship);
  assert.equal(result.type, site.type);
  assert.equal(site.visited, true);
  assert.equal(ship.credits, site.credits);
  assert.ok(Object.values(ship.cargo).some((units) => units > 0));
});
