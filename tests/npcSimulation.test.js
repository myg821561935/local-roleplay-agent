import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceSimulationClock,
  createSimulationState,
  ensureSimulationMemory,
  projectSimulation,
  renderSimulationPrompt
} from '../server/simulation/npcSimulation.js';

test('simulation seeds actors with separate public and private knowledge', () => {
  const memory = ensureSimulationMemory({}, {
    characterCard: { id: 'keeper', name: '守库人', publicKnowledge: ['仓门夜间关闭'], privateKnowledge: ['第三把钥匙已经遗失'] }
  });
  assert.equal(memory.simulation.actors.length, 1);
  assert.deepEqual(memory.simulation.actors[0].privateKnowledge, ['第三把钥匙已经遗失']);
  assert.equal(projectSimulation(memory.simulation, { director: false }).actors[0].privateKnowledge, undefined);
  assert.deepEqual(projectSimulation(memory.simulation, { director: true }).actors[0].privateKnowledge, ['第三把钥匙已经遗失']);
});

test('simulation deduplicates the protagonist repeated in character presets', () => {
  const memory = ensureSimulationMemory({}, {
    characterCard: { id: 'hero-card', name: '陈默', role: '调查员' },
    characterPresets: [
      { id: 'hero-preset', characterCard: { id: 'hero-preset-card', name: '陈默', role: '调查员' } },
      { id: 'partner', characterCard: { id: 'partner-card', name: '唐月', role: '刑警' } }
    ]
  });
  assert.deepEqual(memory.simulation.actors.map((actor) => actor.name), ['陈默', '唐月']);
});

test('simulation does not repopulate a roster that the creator intentionally cleared', () => {
  const memory = ensureSimulationMemory({
    simulation: {
      ...createSimulationState(),
      revision: 1,
      actors: []
    }
  }, {
    characterCard: { id: 'keeper', name: '守库人' }
  });
  assert.equal(memory.simulation.actors.length, 0);
  assert.equal(memory.simulation.settings.rosterInitialized, true);
});

test('simulation advances the clock and executes crossed NPC schedules', () => {
  const simulation = createSimulationState({
    clock: { day: 1, minuteOfDay: 470 },
    actors: [{
      id: 'runner',
      name: '驿卒',
      location: '驿站',
      schedule: [{ id: 'morning-run', at: '08:00', location: '北城门', activity: '递送军报', visibility: 'private' }]
    }]
  });
  const advanced = advanceSimulationClock(simulation, {
    minutes: 20,
    now: () => new Date('2026-07-16T00:00:00.000Z')
  });
  assert.equal(advanced.simulation.clock.label, '第1日 08:10');
  assert.equal(advanced.simulation.actors[0].location, '北城门');
  assert.equal(advanced.events.length, 1);
  assert.equal(advanced.events[0].visibility, 'private');
  assert.equal(projectSimulation(advanced.simulation, { director: false }).backstageEvents.length, 0);
});

test('simulation retains structured world systems and hides director-only records from public views', () => {
  const memory = ensureSimulationMemory({}, {
    worldSystems: {
      topology: {
        nodes: [
          { id: 'capital', name: '大朔天京', summary: '门阀与寒门交错。', visibility: 'public' },
          { id: 'sealed', name: '封印内层', summary: '只供导演裁定。', visibility: 'director' }
        ]
      },
      economy: { currencies: ['白银', '灵石'], rules: [{ id: 'tax', name: '过境税', summary: '各地税率不同。' }] },
      cultivation: { scales: ['德亏值', '契约深度'], rules: [{ id: 'paths', name: '十道途', summary: '力量必须承担代价。' }] }
    }
  });

  const director = projectSimulation(memory.simulation, { director: true });
  const publicView = projectSimulation(memory.simulation, { director: false });
  assert.equal(director.systems.topology.nodes.length, 2);
  assert.equal(publicView.systems.topology.nodes.length, 1);
  assert.match(renderSimulationPrompt(memory), /地点拓扑/);
  assert.match(renderSimulationPrompt(memory), /契约深度/);
});
