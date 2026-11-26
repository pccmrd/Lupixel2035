import test from 'node:test';
import assert from 'node:assert/strict';
import { LUNAR_LANES, OrbitalLayer, ORBITAL_CONTEXT } from '../src/world/orbital.js';

test('orbital state is deterministic and preserves a hidden vertical component', () => {
  const first = new OrbitalLayer(0x2035);
  const second = new OrbitalLayer(0x2035);
  const elements = first.createElements({ a: 22000, e: 0.12, inclination: 0.3 });
  assert.deepEqual(elements, second.createElements({ a: 22000, e: 0.12, inclination: 0.3 }));
  const start = first.sample(elements, 0);
  const later = first.sample(elements, 80);
  assert.ok(Math.abs(start.z) > 1);
  assert.ok(Math.abs(later.z - start.z) > 1);
  assert.ok(Math.abs(Math.hypot(later.vx, later.vy)) > 1);
  assert.equal(ORBITAL_CONTEXT.year, 2035);
});

test('featured bodies keep their initial pixel-world pose when registered', () => {
  const layer = new OrbitalLayer(0x51a7);
  const body = { id: 'featured', x: -920, y: -560 };
  layer.register(body);
  assert.ok(Math.abs(body.x + 920) < 1e-9);
  assert.ok(Math.abs(body.y + 560) < 1e-9);
  assert.ok(body.hiddenPosition);
  layer.update(4, [body]);
  assert.notEqual(body.x, -920);
  assert.ok(Math.hypot(body.vx, body.vy) > 1);
});

test('haul population contains hundreds of bodies and exactly a five-percent catalogued prefix', () => {
  const layer = new OrbitalLayer(0x51a7);
  const configs = layer.createPopulation(288);
  assert.equal(configs.length, 288);
  assert.equal(configs.filter((body) => body.catalogued).length, 15);
  assert.ok(configs.filter((body) => !body.catalogued).every((body) => body.name === 'UNSURVEYED MASS'));
  assert.ok(configs.some((body) => body.radius > 100));
  assert.ok(configs.every((body) => body.radius <= 120), 'minor bodies stay visibly smaller than Luna');
  assert.ok(new Set(configs.map((body) => body.orbital.meanMotion)).size > 1,
    'different lunar lanes have different Keplerian speeds');
  const innerLane = configs.find((body) => body.orbital.lane === 0).orbital;
  const outerLane = configs.find((body) => body.orbital.lane === LUNAR_LANES.count - 1).orbital;
  assert.ok(innerLane.meanMotion > outerLane.meanMotion,
    'inner lanes move faster than outer lanes');
  assert.ok(configs.filter((body) => body.type === 'station')
    .every((body) => LUNAR_LANES.stationLanes.includes(body.orbital.lane)),
  'generated stations use protected orbital levels');
  assert.ok(configs.some((body) => body.type === 'comet'));
  assert.ok(configs.every((body) => Number.isFinite(body.x) && Number.isFinite(body.y)));
  assert.ok(configs.every((body) => body.orbital.a >= LUNAR_LANES.minKm && body.orbital.a <= LUNAR_LANES.maxKm));
  assert.ok(configs.every((body) => body.orbital.direction === 1 && body.orbital.e === 0));
  assert.ok(configs.every((body) => Number.isInteger(body.orbital.lane)));
  assert.ok(configs.every((body) => body.orbital.a * (1 + body.orbital.e) < 60000),
    'haul bodies remain inside Luna’s Hill sphere');

  const radii = configs.map((body) => Math.hypot(body.x, body.y));
  assert.ok(Math.max(...radii) - Math.min(...radii) > 3000,
    'the haul field is spread across a broad range of lunar orbital radii');
});
