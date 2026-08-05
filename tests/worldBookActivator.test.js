import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateWorldBookEntries,
  finalizeWorldBookActivation
} from '../server/agent/worldBookActivator.js';

test('world book activation applies scan_depth per entry in message units', () => {
  const messages = [
    { id: 'u0', role: 'user', content: '旧线索提到了镇武司。' },
    { id: 'a0', role: 'assistant', content: '风雪掩住了脚印。' }
  ];
  const shallow = entry({ id: 'shallow', extensions: { scan_depth: 2 } });
  const deep = entry({ id: 'deep', extensions: { scan_depth: 3 } });

  const result = activateWorldBookEntries({
    worldBook: [shallow, deep],
    messages,
    userMessage: '我转身去城南。',
    maxCards: 5,
    maxRecursionDepth: 0,
    seed: 'scan-depth'
  });

  assert.deepEqual(result.entries.map((item) => item.id), ['deep']);
  assert.deepEqual(result.snapshot.directIds, ['deep']);
});

test('scan_depth zero disables direct keyword matching but still permits recursion', () => {
  const source = entry({
    id: 'source',
    keywords: ['客栈'],
    content: '掌柜提到了虞清寒。',
    extensions: { scan_depth: 1 }
  });
  const recursiveOnly = entry({
    id: 'recursive-only',
    keywords: ['虞清寒'],
    content: '虞清寒是镇武司暗探。',
    extensions: { scan_depth: 0 }
  });

  const result = activateWorldBookEntries({
    worldBook: [source, recursiveOnly],
    userMessage: '我走进客栈。',
    maxRecursionDepth: 1,
    seed: 'recursion'
  });

  assert.deepEqual(result.entries.map((item) => item.id), ['source', 'recursive-only']);
  assert.deepEqual(result.snapshot.recursiveIds, ['recursive-only']);
});

test('scan buffer includes SillyTavern message boundaries and participant names', () => {
  const named = entry({
    id: 'named-user',
    keywords: [String.raw`/\x01林舟:[^\x01]*?开门/`]
  });
  const args = {
    worldBook: [named],
    userMessage: '请替我开门。',
    userName: '林舟',
    maxRecursionDepth: 0
  };

  assert.deepEqual(
    activateWorldBookEntries({ ...args, includeNames: true }).entries.map((item) => item.id),
    ['named-user']
  );
  assert.deepEqual(activateWorldBookEntries({ ...args, includeNames: false }).entries, []);
});

test('whole-word and case-sensitive matching honor per-entry overrides', () => {
  const strictWord = entry({ id: 'strict-word', keywords: ['king'] });
  const substringWord = entry({
    id: 'substring-word',
    keywords: ['king'],
    extensions: { match_whole_words: false }
  });
  const strictCase = entry({ id: 'strict-case', keywords: ['Rose'] });
  const relaxedCase = entry({
    id: 'relaxed-case',
    keywords: ['Rose'],
    extensions: { case_sensitive: false }
  });

  const result = activateWorldBookEntries({
    worldBook: [strictWord, substringWord, strictCase, relaxedCase],
    userMessage: 'This is not to my liking; a rose is nearby.',
    matchWholeWords: true,
    caseSensitive: true,
    maxCards: 10,
    maxRecursionDepth: 0
  });

  assert.deepEqual(result.entries.map((item) => item.id), ['substring-word', 'relaxed-case']);
});

test('regex key flags override global plaintext case settings', () => {
  const exact = entry({ id: 'regex-exact', keywords: ['/Rose/'] });
  const insensitive = entry({ id: 'regex-insensitive', keywords: ['/Rose/i'] });

  const result = activateWorldBookEntries({
    worldBook: [exact, insensitive],
    userMessage: 'a rose is nearby',
    caseSensitive: false,
    maxCards: 10,
    maxRecursionDepth: 0
  });

  assert.deepEqual(result.entries.map((item) => item.id), ['regex-insensitive']);
});

test('minimum activations deepen only the global scan window and exclude recursion text', () => {
  const inherited = entry({
    id: 'inherited-depth',
    keywords: ['旧案'],
    extensions: { scan_depth: 1, scan_depth_inherited: true }
  });
  const fixed = entry({
    id: 'fixed-depth',
    keywords: ['旧案'],
    extensions: { scan_depth: 1 }
  });
  const messages = [
    { id: 'u0', role: 'user', content: '旧案发生在十年前。' },
    { id: 'a0', role: 'assistant', content: '卷宗已经封存。' },
    { id: 'u1', role: 'user', content: '先去别处看看。' }
  ];

  const result = activateWorldBookEntries({
    worldBook: [inherited, fixed],
    messages,
    userMessage: '我检查窗边。',
    defaultScanDepth: 1,
    minActivations: 1,
    minActivationsDepthMax: 4,
    maxRecursionDepth: 0
  });

  assert.deepEqual(result.entries.map((item) => item.id), ['inherited-depth']);
  assert.deepEqual(result.snapshot.minimumActivationIds, ['inherited-depth']);
  assert.equal(result.snapshot.scan.reachedDepth, 4);
});

test('delay_until_recursion activates numeric levels from shallow to deep', () => {
  const source = entry({ id: 'source', keywords: ['客栈'], content: '掌柜交出第一层口令。' });
  const levelOne = entry({
    id: 'level-one',
    keywords: ['第一层口令'],
    content: '第一层口令指向第二层暗号。',
    extensions: { delay_until_recursion: true }
  });
  const levelTwo = entry({
    id: 'level-two',
    keywords: ['第二层暗号'],
    content: '暗号背后是镇武司密库。',
    extensions: { delay_until_recursion: 2 }
  });

  const result = activateWorldBookEntries({
    worldBook: [source, levelOne, levelTwo],
    userMessage: '我走进客栈。',
    maxCards: 10,
    maxRecursionDepth: 3
  });

  assert.deepEqual(result.entries.map((item) => item.id), ['source', 'level-one', 'level-two']);
  assert.deepEqual(result.snapshot.recursiveIds, ['level-one', 'level-two']);
  assert.equal(result.snapshot.scan.recursionDelayLevel, 2);
});

test('probability checks are bounded and deterministic for a saved turn', () => {
  const never = entry({ id: 'never', extensions: { probability: 0, useProbability: true } });
  const maybe = entry({ id: 'maybe', extensions: { probability: 50, useProbability: true } });
  const args = {
    worldBook: [never, maybe],
    userMessage: '镇武司正在封街。',
    seed: 'same-session'
  };

  const first = activateWorldBookEntries(args);
  const second = activateWorldBookEntries(args);

  assert.equal(first.entries.some((item) => item.id === 'never'), false);
  assert.deepEqual(first.entries.map((item) => item.id), second.entries.map((item) => item.id));
  assert.equal(first.snapshot.seedHash, second.snapshot.seedHash);
});

test('inclusion groups keep one deterministic winner and honor prioritize inclusion', () => {
  const lower = entry({
    id: 'lower',
    priority: 50,
    extensions: { group: 'weather', group_override: true, group_weight: 100 }
  });
  const higher = entry({
    id: 'higher',
    priority: 200,
    extensions: { group: 'weather', group_override: true, group_weight: 1 }
  });
  const weightedA = entry({ id: 'weighted-a', extensions: { group: 'event', group_weight: 1 } });
  const weightedB = entry({ id: 'weighted-b', extensions: { group: 'event', group_weight: 100 } });
  const args = {
    worldBook: [lower, higher, weightedA, weightedB],
    userMessage: '镇武司传来消息。',
    seed: 'group-seed'
  };

  const first = activateWorldBookEntries(args);
  const second = activateWorldBookEntries(args);
  const ids = first.entries.map((item) => item.id);

  assert.equal(ids.includes('higher'), true);
  assert.equal(ids.includes('lower'), false);
  assert.equal(ids.filter((id) => id.startsWith('weighted-')).length, 1);
  assert.deepEqual(ids, second.entries.map((item) => item.id));
});

test('group scoring counts matched keys without leaking insertion priority into specificity', () => {
  const common = entry({
    id: 'common',
    priority: 2000,
    keywords: ['镇武司'],
    extensions: { group: 'clue', use_group_scoring: true }
  });
  const specific = entry({
    id: 'specific',
    priority: 1,
    keywords: ['镇武司', '暗线'],
    extensions: { group: 'clue', use_group_scoring: true }
  });

  const result = activateWorldBookEntries({
    worldBook: [common, specific],
    userMessage: '我追查镇武司暗线。',
    seed: 'group-score'
  });

  assert.deepEqual(result.entries.map((item) => item.id), ['specific']);
});

test('sticky, cooldown and delay advance using persisted message state', () => {
  const timed = entry({
    id: 'timed',
    keywords: ['密门'],
    extensions: { scan_depth: 1, sticky: 3, cooldown: 2, delay: 2 }
  });

  const delayed = activateWorldBookEntries({
    worldBook: [timed],
    messages: [],
    userMessage: '我寻找密门。',
    seed: 'timed'
  });
  assert.deepEqual(delayed.entries, []);
  assert.deepEqual(delayed.snapshot.suppressed.delayIds, ['timed']);

  const activated = activateWorldBookEntries({
    worldBook: [timed],
    messages: [{ id: 'a0', role: 'assistant', content: '开场。' }],
    userMessage: '我寻找密门。',
    seed: 'timed'
  });
  assert.deepEqual(activated.entries.map((item) => item.id), ['timed']);

  const sticky = activateWorldBookEntries({
    worldBook: [timed],
    messages: [
      { id: 'a0', role: 'assistant', content: '开场。' },
      { id: 'u1', role: 'user', content: '我寻找密门。' },
      activationMessage('a1', activated.snapshot)
    ],
    userMessage: '我检查墙壁。',
    seed: 'timed'
  });
  assert.deepEqual(sticky.entries.map((item) => item.id), ['timed']);
  assert.deepEqual(sticky.snapshot.stickyIds, ['timed']);

  const cooldown = activateWorldBookEntries({
    worldBook: [timed],
    messages: [
      { id: 'a0', role: 'assistant', content: '开场。' },
      { id: 'u1', role: 'user', content: '我寻找密门。' },
      activationMessage('a1', activated.snapshot),
      { id: 'u2', role: 'user', content: '我检查墙壁。' },
      activationMessage('a2', sticky.snapshot)
    ],
    userMessage: '我再次寻找密门。',
    seed: 'timed'
  });
  assert.deepEqual(cooldown.entries, []);
  assert.deepEqual(cooldown.snapshot.suppressed.cooldownIds, ['timed']);

  const availableAgain = activateWorldBookEntries({
    worldBook: [timed],
    messages: [
      { id: 'a0', role: 'assistant', content: '开场。' },
      { id: 'u1', role: 'user', content: '我寻找密门。' },
      activationMessage('a1', activated.snapshot),
      { id: 'u2', role: 'user', content: '我检查墙壁。' },
      activationMessage('a2', sticky.snapshot),
      { id: 'u3', role: 'user', content: '等待。' },
      activationMessage('a3', cooldown.snapshot)
    ],
    userMessage: '我再次寻找密门。',
    seed: 'timed'
  });
  assert.deepEqual(availableAgain.entries.map((item) => item.id), ['timed']);
});

test('generation type triggers suppress entries outside the active request kind', () => {
  const normalOnly = entry({
    id: 'normal-only',
    constant: true,
    extensions: { triggers: ['normal'] }
  });
  const continueOnly = entry({
    id: 'continue-only',
    constant: true,
    extensions: { triggers: ['continue'] }
  });
  const allTypes = entry({ id: 'all-types', constant: true });

  const result = activateWorldBookEntries({
    worldBook: [normalOnly, continueOnly, allTypes],
    userMessage: '继续。',
    generationType: 'continue'
  });

  assert.deepEqual(new Set(result.entries.map((item) => item.id)), new Set(['continue-only', 'all-types']));
  assert.deepEqual(result.snapshot.suppressed.generationTypeIds, ['normal-only']);
  assert.equal(result.snapshot.context.generationType, 'continue');
});

test('character filters require every configured include dimension and invert exclusions', () => {
  const includeNameAndTag = entry({
    id: 'include-name-tag',
    constant: true,
    extensions: {
      character_filter: { names: ['沈观澜'], tags: ['武侠'], isExclude: false }
    }
  });
  const missingTag = entry({
    id: 'missing-tag',
    constant: true,
    characterFilter: { names: ['沈观澜'], tags: ['灵异'], isExclude: false }
  });
  const excludedByName = entry({
    id: 'excluded-name',
    constant: true,
    characterFilter: { names: ['沈观澜'], isExclude: true }
  });
  const otherCharacter = entry({
    id: 'other-character',
    constant: true,
    characterFilter: { names: ['凌霜'], isExclude: true }
  });
  const sourceFileName = entry({
    id: 'source-file-name',
    constant: true,
    characterFilter: { names: ['shen'], isExclude: false }
  });
  const objectTag = entry({
    id: 'object-tag',
    constant: true,
    characterFilter: { tags: [{ id: 'tag-wuxia', name: '武侠分类' }], isExclude: false }
  });

  const result = activateWorldBookEntries({
    worldBook: [includeNameAndTag, missingTag, excludedByName, otherCharacter, sourceFileName, objectTag],
    userMessage: '继续。',
    characterCard: {
      name: '沈观澜',
      tags: ['武侠'],
      extensions: {
        tags: [{ id: 'tag-wuxia', name: '武侠分类' }],
        local_roleplay_agent: { sourceFileName: 'shen.png' }
      }
    }
  });

  assert.deepEqual(
    new Set(result.entries.map((item) => item.id)),
    new Set(['include-name-tag', 'other-character', 'source-file-name', 'object-tag'])
  );
  assert.deepEqual(
    new Set(result.snapshot.suppressed.characterFilterIds),
    new Set(['missing-tag', 'excluded-name'])
  );
  assert.deepEqual(result.snapshot.context.characterNames, ['沈观澜']);
});

test('additional matching sources scan only fields explicitly enabled by each entry', () => {
  const cards = [
    entry({ id: 'persona', keywords: ['银杏纹'], extensions: { match_persona_description: true } }),
    entry({ id: 'description', keywords: ['冷月印'], extensions: { match_character_description: true } }),
    entry({ id: 'personality', keywords: ['惜字如金'], extensions: { match_character_personality: true } }),
    entry({ id: 'depth-note', keywords: ['旧案优先'], extensions: { match_character_depth_prompt: true } }),
    entry({ id: 'scenario', keywords: ['北门雨夜'], extensions: { match_scenario: true } }),
    entry({ id: 'creator-notes', keywords: ['慢热关系'], extensions: { match_creator_notes: true } }),
    entry({ id: 'not-enabled', keywords: ['冷月印'] })
  ];

  const result = activateWorldBookEntries({
    worldBook: cards,
    userMessage: '继续眼前行动。',
    maxCards: 10,
    maxRecursionDepth: 0,
    persona: { enabled: true, description: '衣襟绣着银杏纹。' },
    characterCard: {
      name: '沈观澜',
      description: '左腕留有冷月印。',
      personality: '平日惜字如金。',
      postHistoryInstructions: '每轮追踪时旧案优先。',
      scenario: '故事开始于北门雨夜。',
      creatorNotes: '适合克制的慢热关系。'
    }
  });

  assert.deepEqual(
    new Set(result.entries.map((item) => item.id)),
    new Set(['persona', 'description', 'personality', 'depth-note', 'scenario', 'creator-notes'])
  );
  assert.deepEqual(result.snapshot.context.additionalSourceKinds, [
    'personaDescription',
    'characterDescription',
    'characterPersonality',
    'characterDepthPrompt',
    'scenario',
    'creatorNotes'
  ]);
});

test('scan depth zero does not activate from additional matching sources alone', () => {
  const result = activateWorldBookEntries({
    worldBook: [entry({
      id: 'zero-depth',
      keywords: ['冷月印'],
      extensions: { scan_depth: 0, match_character_description: true }
    })],
    userMessage: '继续。',
    characterCard: { name: '沈观澜', description: '左腕留有冷月印。' },
    maxRecursionDepth: 0
  });

  assert.deepEqual(result.entries, []);
});

test('prompt budget finalization does not start timed effects for omitted entries', () => {
  const timed = entry({ id: 'timed', extensions: { sticky: 3 } });
  const activated = activateWorldBookEntries({
    worldBook: [timed],
    userMessage: '镇武司封街。',
    seed: 'budget'
  });
  const finalized = finalizeWorldBookActivation(activated.snapshot, []);

  assert.deepEqual(finalized.activatedIds, []);
  assert.deepEqual(finalized.suppressed.budgetIds, ['timed']);
  assert.equal(finalized.effects.timed, undefined);
});

function entry(overrides = {}) {
  return {
    id: 'entry',
    title: '镇武司条目',
    keywords: ['镇武司'],
    content: '镇武司负责约束江湖武人。',
    priority: 80,
    enabled: true,
    ...overrides
  };
}

function activationMessage(id, worldBookActivation) {
  return {
    id,
    role: 'assistant',
    content: '旁白继续。',
    worldBookActivation
  };
}
