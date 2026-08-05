import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildJourneyOpeningProse,
  buildJourneyPrompt,
  cleanJourneySettingBeat,
  createJourneyDraftController,
  detectJourneyOpeningGenre,
  getJourneyTabSummaries
} from '../public/modules/journeyDraft.js';

const TEMPLATE = {
  title: '神荒武界',
  subtitle: '九重天阙',
  tagline: '雁回旧案',
  fields: {
    name: { label: '角色大名' },
    role: { label: '门派/出身' },
    goal: { label: '当前目标' },
    secret: { label: '隐秘牵连' }
  },
  tabs: {
    world: {
      label: '乾坤定界',
      content: '【落雁城】落雁城位于中州与北荒交界，今夜城门提前落锁。'
    },
    crisis: {
      label: '当前危机',
      content: '【粮仓灯火】城东粮仓地下旧军道出现灯火，证物正在被转移。'
    }
  }
};

test('journey draft snapshot keeps GM entries hidden and preserves priority order', () => {
  const state = {
    config: {
      worldBook: [
        {
          id: 'public-high',
          title: '公开高优先级',
          content: '  公开   内容  ',
          priority: 90,
          keywords: ['一', '二', '三', '四', '五', '六']
        },
        {
          id: 'constant',
          title: '常驻条目',
          content: '常驻内容',
          priority: 10,
          constant: true,
          depth: 8
        },
        {
          id: 'gm',
          title: 'GM 机密',
          content: '绝不能展示',
          visibility: 'gm',
          priority: 100
        },
        {
          id: 'gm-only',
          title: '扩展机密',
          content: '也不能展示',
          extensions: { gmOnly: true }
        },
        {
          id: 'disabled',
          title: '停用条目',
          content: '不计入快照',
          enabled: false
        }
      ]
    }
  };
  const controller = createJourneyDraftController({ state });
  const snapshot = controller.buildJourneyWorldbookSnapshot(2);

  assert.equal(snapshot.total, 4);
  assert.equal(snapshot.publicTotal, 2);
  assert.equal(snapshot.hiddenTotal, 2);
  assert.deepEqual(snapshot.entries.map((entry) => entry.title), ['常驻条目', '公开高优先级']);
  assert.equal(snapshot.entries[1].content, '公开 内容');
  assert.deepEqual(snapshot.entries[1].keywords, ['一', '二', '三', '四', '五']);
  assert.equal(snapshot.entries.some((entry) => entry.content.includes('不能展示')), false);
});

test('journey draft builds prose and prompt without copying worldbook payload into visible input', () => {
  const state = {
    config: {
      worldBook: [
        {
          id: 'public',
          title: '神荒大陆总纲',
          content: '这是应该留在系统上下文中的完整公开条目。',
          priority: 80
        },
        {
          id: 'secret',
          title: '幕后真相',
          content: 'GM 机密正文绝不能进入输入框。',
          visibility: 'gm',
          priority: 100
        }
      ]
    }
  };
  const controller = createJourneyDraftController({ state });
  const formData = {
    name: '叶沉舟',
    role: '前镇武司影卫',
    goal: '查清雁回关旧案',
    secret: '左肩旧伤会在雨夜复发'
  };
  const destinyCards = [{
    id: 'survivor',
    title: '雁回活口',
    content: '第七名活口已改名换姓，并被听雨楼标价。'
  }];
  const draft = controller.buildJourneyDraft(formData, TEMPLATE, destinyCards);

  assert.equal(draft.title, '神荒武界');
  assert.equal(draft.worldbookSnapshot.total, 2);
  assert.equal(draft.worldbookSnapshot.hiddenTotal, 1);
  assert.equal(draft.fields[0].label, '角色大名');
  assert.match(draft.openingProse.join('\n'), /叶沉舟以前镇武司影卫的身份，此行只为查清雁回关旧案/);
  assert.match(draft.openingProse.join('\n'), /第七名活口已改名换姓/);
  assert.match(draft.promptText, /已加载 World Book：2 条（含 1 条 GM 隐藏层）/);
  assert.match(draft.promptText, /\*\*当前目标\*\*：查清雁回关旧案/);
  assert.match(draft.promptText, /雁回活口：第七名活口已改名换姓/);
  assert.doesNotMatch(draft.promptText, /完整公开条目|GM 机密正文/);
});

test('journey draft pure helpers normalize settings and classify opening genre', () => {
  assert.equal(cleanJourneySettingBeat('【危机】 **雨夜** 旧刀开封。'), '雨夜 旧刀开封。');
  assert.equal(detectJourneyOpeningGenre({ title: '太虚仙途' }), 'xianxia');
  assert.equal(detectJourneyOpeningGenre({ title: '永安夜录' }), 'lingyi');
  assert.deepEqual(getJourneyTabSummaries({
    tabs: {
      world: { label: '世界', content: '设定正文' },
      empty: {},
      unlabeled: { content: '补充正文' }
    }
  }), [
    { label: '世界', content: '设定正文' },
    { label: '设定', content: '补充正文' }
  ]);

  const snapshot = {
    total: 1,
    publicTotal: 1,
    hiddenTotal: 0,
    entries: [{ title: '旧案总纲' }]
  };
  const prose = buildJourneyOpeningProse({ name: '无名客' }, TEMPLATE, [], snapshot);
  const prompt = buildJourneyPrompt({ name: '无名客' }, TEMPLATE, [], snapshot);

  assert.match(prose.at(-1), /旧案总纲/);
  assert.match(prompt, /具体内容已由系统上下文提供，此处不再重复/);
  assert.doesNotMatch(prompt, /旧案总纲/);
});
