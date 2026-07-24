import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandMacros } from '../server/agent/macroEngine.js';

test('expandMacros replaces {{user}} and {{char}}', () => {
  const result = expandMacros('{{user}} 向 {{char}} 拔剑', {
    user: '林青阳',
    characterCard: { name: '沈观澜' }
  });
  assert.equal(result, '林青阳 向 沈观澜 拔剑');
});

test('expandMacros expands persona fields', () => {
  const result = expandMacros('我是 {{persona_name}}，来自 {{persona_background}}', {
    persona: { name: '林青阳', background: '江南' }
  });
  assert.equal(result, '我是 林青阳，来自 江南');
});

test('expandMacros expands char_* fields', () => {
  const result = expandMacros('{{char_name}} 是 {{char_role}}', {
    characterCard: { name: '沈观澜', role: '剑客' }
  });
  assert.equal(result, '沈观澜 是 剑客');
});

test('expandMacros random picks from comma list', () => {
  const results = new Set();
  for (let i = 0; i < 50; i++) {
    const r = expandMacros('{{random:甲,乙,丙}}', {});
    results.add(r);
  }
  assert.ok(results.size >= 2);
  assert.ok(['甲', '乙', '丙'].every((x) => results.has(x)));
});

test('expandMacros random numeric range returns number in range', () => {
  for (let i = 0; i < 30; i++) {
    const r = Number(expandMacros('{{random:1-6}}', {}));
    assert.ok(r >= 1 && r <= 6);
  }
});

test('expandMacros roll d6 returns 1-6', () => {
  for (let i = 0; i < 30; i++) {
    const r = Number(expandMacros('{{roll:d6}}', {}));
    assert.ok(r >= 1 && r <= 6);
  }
});

test('expandMacros roll 3d6+5 has correct format', () => {
  const result = expandMacros('{{roll:3d6+5}}', {});
  assert.match(result, /^\d+ \(\d+\+\d+\+\d+ \+ 5\)$/);
});

test('expandMacros time macros return non-empty', () => {
  assert.ok(expandMacros('{{time}}', {}).length > 0);
  assert.ok(expandMacros('{{date}}', {}).length > 0);
  assert.ok(expandMacros('{{datetime}}', {}).length > 0);
  assert.ok(Number(expandMacros('{{timestamp}}', {})) > 0);
});

test('expandMacros message_count counts non-excluded messages', () => {
  const result = expandMacros('已对话 {{message_count}} 轮', {
    messages: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好啊' },
      { role: 'user', content: '再见', excluded: true }
    ]
  });
  assert.equal(result, '已对话 2 轮');
});

test('expandMacros last_user_message returns last user content', () => {
  const result = expandMacros('上句: {{last_user_message}}', {
    messages: [
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '回应' },
      { role: 'user', content: '第二句' }
    ]
  });
  assert.equal(result, '上句: 第二句');
});

test('expandMacros get_worldbook returns card content by title', () => {
  const result = expandMacros('夜市信息：{{get_worldbook:title:落雁夜市}}', {
    worldBook: [
      { title: '落雁夜市', content: '子时后开张' },
      { title: '墨香书坊', content: '卖书' }
    ]
  });
  assert.equal(result, '夜市信息：子时后开张');
});

test('expandMacros renders safe EJS and read-only community variables', () => {
  const context = {
    characterCard: { name: '沈观澜' },
    lightFrontendState: { values: { favor: 21, flags: { met: true } }, revision: 2 }
  };
  const result = expandMacros(
    '<% if (mvu.flags.met) { %>{{char}}信任度 <%= getvar("favor") %> / {{getvar::favor}}<% } %>',
    context
  );

  assert.equal(result, '沈观澜信任度 21 / 21');
  assert.equal(context.lightFrontendState.values.favor, 21);
});

test('expandMacros strips unsupported EJS code without executing it', () => {
  globalThis.__lightFrontendProbe = 0;
  const result = expandMacros('<% globalThis.__lightFrontendProbe = 1 %>正文', {});

  assert.equal(result, '正文');
  assert.equal(globalThis.__lightFrontendProbe, 0);
  delete globalThis.__lightFrontendProbe;
});

test('expandMacros pick selects from custom array', () => {
  const results = new Set();
  for (let i = 0; i < 30; i++) {
    const r = expandMacros('{{pick:names}}', {
      customArrays: { names: ['甲', '乙', '丙'] }
    });
    results.add(r);
  }
  assert.ok(results.size >= 2);
});

test('expandMacros template recursively expands nested macros', () => {
  const result = expandMacros('{{template:greeting}}', {
    user: '林青阳',
    templates: [
      { name: 'greeting', content: '你好 {{user}}，今天是 {{random:晴天,雨天}}' }
    ]
  });
  assert.match(result, /^你好 林青阳，今天是 (晴天|雨天)$/);
});

test('expandMacros leaves unknown macros unchanged', () => {
  const result = expandMacros('未知宏 {{unknown_macro}} 不变', {});
  assert.equal(result, '未知宏 {{unknown_macro}} 不变');
});

test('expandMacros handles empty/invalid input safely', () => {
  assert.equal(expandMacros('', {}), '');
  assert.equal(expandMacros(null, {}), null);
  assert.equal(expandMacros(undefined, {}), undefined);
  assert.equal(expandMacros('无宏文本', {}), '无宏文本');
});

test('expandMacros does not crash on invalid roll syntax', () => {
  assert.equal(expandMacros('{{roll:xyz}}', {}), '{{roll:xyz}}');
  assert.equal(expandMacros('{{roll:}}', {}), '{{roll:}}');
});
