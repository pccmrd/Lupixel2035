import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentInterface } from '../src/game/agentInterface.js';

function mockGame() {
  const game = {
    input: { pressed: new Set(), justPressed: new Set() },
    ship: { fuel: 100, hull: 100 },
    world: { gravityScale: 1 },
    mission: { stage: 0 },
    objectiveTexts: ['One', 'Two'],
    objectiveText: 'One'
  };
  return game;
}

test('agent flight controls are deterministic and releasable', () => {
  const game = mockGame(); const agent = new AgentInterface(game);
  agent.setControls({ thrust: true, rotateLeft: true });
  assert.deepEqual([...game.input.pressed].sort(), ['KeyA', 'KeyW']);
  agent.setControls({ thrust: true });
  assert.deepEqual([...game.input.pressed], ['KeyW']);
  agent.releaseControls();
  assert.equal(game.input.pressed.size, 0);
});

test('agent parameters are validated and story updates use authored objective text', () => {
  const game = mockGame(); const agent = new AgentInterface(game);
  assert.deepEqual(agent.action('set_parameter', { name: 'shipFuel', value: 42 }), { name: 'shipFuel', value: 42 });
  assert.equal(game.ship.fuel, 42);
  assert.equal(agent.action('set_parameter', { name: 'gravityScale', value: 99 }).value, 10);
  assert.deepEqual(agent.action('set_story_stage', { stage: 1 }), { stage: 1, objective: 'Two' });
  assert.throws(() => agent.action('set_parameter', { name: 'prototypeHack', value: 1 }), /Unsupported/);
});
