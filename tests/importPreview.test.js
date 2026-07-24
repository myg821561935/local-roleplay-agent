import test from 'node:test';
import assert from 'node:assert/strict';
import { importWorldBookFromPayload } from '../server/character/worldBookImport.js';
import { previewImportPayload } from '../server/character/importPreview.js';

test('previews Character Card V2 with embedded character book', () => {
  const preview = previewImportPayload({
    fileName: 'shen.json',
    mimeType: 'application/json',
    data: JSON.stringify(createV2CardPayload())
  });

  assert.equal(preview.kind, 'character-card');
  assert.equal(preview.summary.characterName, '沈观澜');
  assert.equal(preview.summary.firstMessage, '夜雨打在刀鞘上。');
  assert.deepEqual(preview.summary.tags, ['武侠']);
  assert.equal(preview.summary.worldBookCount, 1);
  assert.deepEqual(preview.summary.keywordSamples, ['镇武司']);
  assert.deepEqual(preview.summary.declaredContentPacks, ['yingxiongzhi']);
  assert.equal(preview.summary.declaredGenre, '武侠群像 · 武侠');
  assert.equal(preview.summary.selfContained, true);
  assert.equal(preview.importData.characterCard.name, '沈观澜');
  assert.equal(preview.importData.worldBook[0].title, '镇武司暗线');
});

test('imports SillyTavern world book JSON object entries', () => {
  const entries = importWorldBookFromPayload({
    fileName: 'world.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      entries: {
        '1': {
          comment: '听雨楼',
          key: ['听雨楼'],
          keysecondary: ['秘密'],
          content: '听雨楼贩卖秘密。',
          enabled: true,
          depth: 5,
          order: 20,
          selective: true,
          selectiveLogic: 0,
          constant: false,
          caseSensitive: false,
          position: 0
        }
      }
    })
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, '听雨楼');
  assert.deepEqual(entries[0].keywords, ['听雨楼']);
  assert.deepEqual(entries[0].secondaryKeywords, ['秘密']);
  assert.equal(entries[0].content, '听雨楼贩卖秘密。');
  assert.equal(entries[0].depth, 5);
  assert.equal(entries[0].insertionOrder, 20);
  assert.equal(entries[0].logic, 'all');
  assert.equal(entries[0].source, 'sillytavern-worldbook');
});

test('previews standalone world book imports', () => {
  const preview = previewImportPayload({
    fileName: 'world.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      entries: [
        { name: '黑虎帮', keys: ['黑虎帮'], content: '黑虎帮盘踞巷陌。', enabled: true },
        { name: '空条目', keys: ['空'], content: '', enabled: true }
      ]
    })
  });

  assert.equal(preview.kind, 'world-book');
  assert.equal(preview.summary.worldBookCount, 1);
  assert.deepEqual(preview.summary.titles, ['黑虎帮']);
  assert.deepEqual(preview.summary.keywordSamples, ['黑虎帮']);
  assert.equal(preview.importData.worldBook[0].title, '黑虎帮');
});

test('imports tutorial style text world book entries', () => {
  const entries = importWorldBookFromPayload({
    fileName: 'worldbook.txt',
    mimeType: 'text/plain',
    data: `条目名：星斗大森林
触发词：星斗大森林, 星斗森林, 大森林
内容：
名称: "星斗大森林"
简介: "大陆最大最危险的魂兽栖息地。"
特殊规则: "外围百年至千年级魂兽；核心区域极少有人类能活着进出。"`
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, '星斗大森林');
  assert.deepEqual(entries[0].keywords, ['星斗大森林', '星斗森林', '大森林']);
  assert.match(entries[0].content, /核心区域/);
  assert.equal(entries[0].source, 'text-worldbook');
});

test('imports YAML-like world document id blocks as world book entries', () => {
  const entries = importWorldBookFromPayload({
    fileName: 'douluo.yaml',
    mimeType: 'text/yaml',
    data: `主要地点:
- id: "loc_star_dou_forest"
名称: "星斗大森林"
简介: "大陆最大最危险的魂兽栖息地。"
信息层级: "公开"
- id: "loc_sunset_forest"
名称: "落日森林"
简介: "大陆知名魂兽栖息地。"
信息层级: "公开"`
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, '星斗大森林');
  assert.deepEqual(entries[0].keywords, ['星斗大森林', 'loc_star_dou_forest']);
  assert.match(entries[1].content, /落日森林/);
  assert.equal(entries[0].source, 'yaml-worldbook');
});

test('previews YAML-like character card imports', () => {
  const preview = previewImportPayload({
    fileName: 'xiaowu.yaml',
    mimeType: 'text/yaml',
    data: `character:
name: "小舞"
first_message: "夕阳把索托城的石板街染成橘红色。"
identity:
impression: "扎着黑色蝎子辫、蹦蹦跳跳永远静不下来的灵动少女"
psychology:
values:
ranking: "唐三的安全 > 同伴的生命 > 自身生存 > 身份隐匿"
behavior:
rules:
- trigger: "唐三面临致命威胁"
action: "解除所有限制，保护唐三"
anti_ooc:
never:
- "绝不主动向外人暴露魂兽身份"`
  });

  assert.equal(preview.kind, 'character-card');
  assert.equal(preview.summary.characterName, '小舞');
  assert.match(preview.summary.firstMessage, /索托城/);
  assert.equal(preview.importData.characterCard.sourceSpec, 'yaml-character-card');
  assert.match(preview.importData.characterCard.description, /蝎子辫/);
  assert.match(preview.importData.characterCard.personality, /唐三的安全/);
  assert.match(preview.importData.characterCard.systemPrompt, /绝不主动/);
});

test('previews lra content pack and declarative plugin manifests before generic card parsing', () => {
  const contentPack = previewImportPayload({
    mimeType: 'application/json',
    data: JSON.stringify({
      spec: 'lra.content-pack/v1',
      manifest: { spec: 'lra.content-pack/v1', id: 'rain-night', version: '1.0.0', title: '听雨夜', engine: '>=0.2.2' },
      content: { characterCard: { name: '沈观澜' }, worldBook: [], promptModules: [], memory: {}, ruleSystem: {} }
    })
  });
  const plugin = previewImportPayload({
    mimeType: 'application/json',
    data: JSON.stringify({
      spec: 'lra.plugin/v1',
      id: 'community.rain-night',
      version: '1.0.0',
      name: '雨夜适配',
      adapters: [{ id: 'rain-night-lore', kinds: ['worldbook'], formats: ['json'] }]
    })
  });

  assert.equal(contentPack.kind, 'content-pack');
  assert.equal(contentPack.summary.characterName, '沈观澜');
  assert.equal(plugin.kind, 'plugin-manifest');
  assert.equal(plugin.summary.adapterCount, 1);
});

test('previews Tavern Helper normalized prompt presets without executing extensions', () => {
  const preview = previewImportPayload({
    fileName: 'story-preset.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      name: '长篇叙事预设',
      settings: {
        max_context: 32000,
        max_completion_tokens: 4096,
        should_stream: true,
        temperature: 0.8
      },
      prompts: [
        {
          id: 'main',
          name: '主提示',
          enabled: true,
          role: 'system',
          content: '保持角色身份与世界边界。',
          position: { type: 'relative' }
        },
        {
          id: 'worldInfoBefore',
          name: '世界书前置锚点',
          enabled: true,
          role: 'system',
          content: '',
          position: { type: 'relative' }
        },
        {
          id: 'after-history',
          name: '历史后约束',
          enabled: true,
          role: 'user',
          content: '延续当前场景，不跳出角色。',
          position: { type: 'in_chat', depth: 2, order: 7 }
        }
      ],
      extensions: {
        regex_scripts: [{ scriptName: '隐藏状态标签' }],
        tavern_helper: {
          scripts: [{ id: 'unsafe-runtime-hook' }],
          variables: { affection: 0 }
        }
      }
    })
  });

  assert.equal(preview.kind, 'prompt-preset');
  assert.equal(preview.title, '长篇叙事预设');
  assert.equal(preview.summary.sourceFormat, 'tavern-helper-preset');
  assert.equal(preview.summary.promptModuleCount, 2);
  assert.equal(preview.summary.placeholderCount, 1);
  assert.equal(preview.summary.regexScriptCount, 1);
  assert.equal(preview.summary.tavernHelperScriptCount, 1);
  assert.equal(preview.summary.generationSettings.maxContext, 32000);
  assert.equal(preview.summary.generationSettings.stream, true);
  assert.equal(preview.importData.promptModules[1].position, 'in_chat');
  assert.equal(preview.importData.promptModules[1].depth, 2);
  assert.equal(preview.importData.promptModules[1].role, 'user');
  assert.equal(
    preview.importData.promptModules[0].extensions.sillyTavernPreset.dependencySignals.tavern_helper.execution,
    'disabled'
  );
});

test('previews native SillyTavern presets using prompt_order as the canonical order', () => {
  const preview = previewImportPayload({
    fileName: 'native-st.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      openai_max_context: 65536,
      openai_max_tokens: 3000,
      stream_openai: false,
      temperature: 0.72,
      prompts: [
        { identifier: 'main', name: '主提示', role: 'system', content: '主提示内容' },
        { identifier: 'nsfw', name: '题材约束', role: 'system', content: '题材约束内容' },
        { identifier: 'chatHistory', name: '聊天历史', role: 'system', content: '' }
      ],
      prompt_order: [{
        character_id: 100001,
        order: [
          { identifier: 'nsfw', enabled: true },
          { identifier: 'main', enabled: true },
          { identifier: 'chatHistory', enabled: true }
        ]
      }]
    })
  });

  assert.equal(preview.kind, 'prompt-preset');
  assert.equal(preview.summary.sourceFormat, 'sillytavern-preset');
  assert.deepEqual(preview.importData.promptModules.map((item) => item.title), ['题材约束', '主提示']);
  assert.equal(preview.summary.generationSettings.maxContext, 65536);
  assert.equal(preview.summary.generationSettings.maxCompletionTokens, 3000);
  assert.equal(preview.summary.generationSettings.stream, false);
  assert.equal(preview.importData.promptPreset.promptLayout.at(-1).id, 'chatHistory');
});

function createV2CardPayload() {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '沈观澜',
      description: '初入江湖的刀客。',
      personality: '沉稳，重诺。',
      scenario: '正在调查镇武司旧案。',
      first_mes: '夜雨打在刀鞘上。',
      alternate_greetings: ['雨还没停。'],
      tags: ['武侠'],
      system_prompt: '保持武侠叙事。',
      extensions: {
        contentPack: 'yingxiongzhi',
        genre: '武侠群像'
      },
      character_book: {
        scan_depth: 6,
        entries: [{
          id: 7,
          name: '镇武司暗线',
          keys: ['镇武司'],
          secondary_keys: ['暗线'],
          selective: true,
          content: '镇武司旧案背后另有朝堂暗线。',
          enabled: true,
          insertion_order: 10
        }]
      }
    }
  };
}
