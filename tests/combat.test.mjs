import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatSystem } from '../src/game/combat.js';
import { Ship } from '../src/game/ship.js';
import { World } from '../src/world/world.js';

test('hostiles patrol their assigned asteroid and only alert the player at close range', () => {
  const world = new World(0x51a7);
  const ship = new Ship(world);
  const combat = new CombatSystem(world, ship, { spawn() {} });
  const enemy = combat.enemies[0];
  const home = world.bodyById.get(enemy.homeId);

  combat.updateEnemies(0.1);
  assert.equal(enemy.alerted, false);
  assert.ok(Math.abs(Math.hypot(enemy.x - home.x, enemy.y - home.y) - enemy.patrolRadius) < 1e-6);

  world.advance(10);
  combat.updateEnemies(0.1);
  assert.ok(Math.hypot(enemy.x - home.x, enemy.y - home.y) < enemy.patrolRadius + 1);
  assert.equal(enemy.alerted, false, 'moving orbital patrols stay with their host asteroid');

  ship.x = enemy.x + 500;
  ship.y = enemy.y;
  combat.updateEnemies(1 / 60);
  assert.equal(enemy.alerted, true);
  assert.ok(ship.takeNotifications().some((note) => note.text.includes('HOSTILE CONTACT')));
});
