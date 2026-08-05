import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthoringController } from '../public/modules/authoring.js';

function createState() {
  return {
    session: {
      id: 'story-a',
      settings: { activeAgentProfileId: 'story-director' },
      authoring: {
        scene: {
          title: '旧场景',
          objective: '',
          pov: '',
          location: '',
          time: '',
          tone: '',
          mustReveal: [],
          mustHide: [],
          forbidden: [],
          endingHook: ''
        },
        promises: [],
        decisions: [],
        updatedAt: ''
      }
    }
  };
}

test('authoring save replaces session state through the injected coordinator boundary', async () => {
  const state = createState();
  const savedSession = {
    ...state.session,
    authoring: {
      ...state.session.authoring,
      scene: { ...state.session.authoring.scene, title: '新场景' }
    }
  };
  const calls = { api: [], replacements: [], statuses: [] };
  const controller = createAuthoringController({
    state,
    els: {},
    apiRequest: async (...args) => {
      calls.api.push(args);
      return {
        session: savedSession,
        ledger: savedSession.authoring,
        agentProfileId: 'story-director'
      };
    },
    setStatus: (_element, text, tone) => calls.statuses.push([text, tone]),
    getSessionId: () => 'story-a',
    replaceSession: (session, options) => {
      calls.replacements.push([session, options]);
      state.session = session || options.fallback;
      return state.session;
    }
  });

  await controller.save();

  assert.equal(calls.api[0][0], '/api/sessions/story-a/authoring');
  assert.equal(calls.api[0][1].method, 'PUT');
  assert.equal(calls.replacements.length, 1);
  assert.equal(calls.replacements[0][0], savedSession);
  assert.equal(calls.replacements[0][1].fallback.id, 'story-a');
  assert.equal(state.session, savedSession);
  assert.deepEqual(calls.statuses.at(-1), ['已保存，后续生成将遵循此账本', 'ok']);
});

test('authoring save fails closed when the session replacement dependency is missing', async () => {
  const state = createState();
  const original = state.session;
  const statuses = [];
  const controller = createAuthoringController({
    state,
    els: {},
    apiRequest: async () => ({
      session: { ...original, id: 'unexpected' },
      ledger: original.authoring
    }),
    setStatus: (_element, text, tone) => statuses.push([text, tone]),
    getSessionId: () => 'story-a'
  });

  await controller.save();

  assert.equal(state.session, original);
  assert.match(statuses.at(-1)[0], /SESSION_REPLACE_REQUIRED/);
  assert.equal(statuses.at(-1)[1], 'error');
});
