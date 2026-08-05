import test from 'node:test';
import assert from 'node:assert/strict';
import { getContentPack, listContentPackCharacters, listContentPackSummaries } from '../server/config/contentPacks.js';

test('content packs expose linked prompt world character and memory payloads', () => {
  const summaries = listContentPackSummaries();
  const xuanhuan = getContentPack('xuanhuan');
  const lingyi = getContentPack('lingyi');
  const mingmo = getContentPack('mingmo');
  const xianxia = getContentPack('xianxia');
  const yingxiongzhi = getContentPack('yingxiongzhi');

  assert.ok(summaries.find((pack) => pack.id === 'xuanhuan'));
  assert.ok(summaries.find((pack) => pack.id === 'lingyi'));
  assert.ok(summaries.find((pack) => pack.id === 'mingmo'));
  assert.ok(summaries.find((pack) => pack.id === 'xianxia'));
  assert.ok(summaries.find((pack) => pack.id === 'yingxiongzhi'));
  assert.equal(xuanhuan.characterCard.name, '叶沉舟');
  assert.equal(xuanhuan.memory.worldState.flags.genre, 'xuanhuan');
  assert.equal(xuanhuan.ruleSystem.contentPackId, 'xuanhuan');
  assert.match(JSON.stringify(xuanhuan.ruleSystem), /武道境界/);
  assert.equal(lingyi.characterCard.name, '陈默');
  assert.equal(lingyi.memory.worldState.flags.genre, 'lingyi');
  assert.equal(lingyi.ruleSystem.contentPackId, 'lingyi');
  assert.match(JSON.stringify(lingyi.ruleSystem), /案件与禁忌/);
  assert.equal(ruleLabels(lingyi.ruleSystem).includes('武道境界'), false);
  assert.equal(ruleLabels(lingyi.ruleSystem).some((label) => label.includes('银粮')), false);
  assert.equal(mingmo.characterCard.name, '顾怀砚');
  assert.equal(mingmo.memory.worldState.flags.genre, 'mingmo');
  assert.equal(mingmo.ruleSystem.contentPackId, 'mingmo');
  assert.match(JSON.stringify(mingmo.ruleSystem), /文书\/银粮\/物品/);
  assert.equal(ruleLabels(mingmo.ruleSystem).includes('武道境界'), false);
  assert.equal(ruleLabels(mingmo.ruleSystem).some((label) => label.includes('法器')), false);
  assert.ok(lingyi.promptModules.find((module) => module.id === 'lingyi-fear-pacing'));
  assert.ok(lingyi.worldBook.find((entry) => entry.id === 'location-yongan-building'));
  assert.ok(lingyi.memory.memoryCards.find((fact) => fact.id === 'fact-lingyi-current-case'));
  assert.equal(lingyi.worldBook.length >= 16, true);
  assert.ok(lingyi.worldBook.find((entry) => entry.id === 'npc-tang-yue'));
  assert.ok(lingyi.worldBook.find((entry) => entry.id === 'event-midnight-countdown'));
  assert.ok(lingyi.worldBook.find((entry) => entry.id === 'rule-spirit-price'));
  assert.ok(lingyi.worldBook.find((entry) => entry.id === 'event-midnight-broadcast-room'));
  assert.ok(mingmo.promptModules.find((module) => module.id === 'mingmo-history-pacing'));
  assert.ok(mingmo.worldBook.find((entry) => entry.id === 'event-chongzhen-last-years'));
  assert.ok(mingmo.worldBook.find((entry) => entry.id === 'npc-chongzhen-emperor'));
  assert.ok(mingmo.worldBook.find((entry) => entry.id === 'event-capital-grain-price'));
  assert.ok(mingmo.worldBook.find((entry) => entry.id === 'npc-lu-yiniang'));
  assert.ok(mingmo.worldBook.find((entry) => entry.id === 'rule-county-six-offices'));
  assert.ok(mingmo.worldBook.find((entry) => entry.id === 'faction-gentry-lineage'));
  assert.ok(mingmo.memory.memoryCards.find((fact) => fact.id === 'fact-mingmo-current-crisis'));
  assert.equal(mingmo.worldBook.length >= 18, true);
  assert.ok(xuanhuan.worldBook.find((entry) => entry.id === 'board-heavenly-omen'));
  assert.ok(xuanhuan.worldBook.find((entry) => entry.id === 'npc-lingshuang'));
  assert.ok(xuanhuan.worldBook.find((entry) => entry.id === 'rule-hidden-system-pressure'));
  assert.ok(xuanhuan.worldBook.find((entry) => entry.id === 'location-ancient-road-remnant'));
  assert.ok(xuanhuan.worldBook.find((entry) => entry.id === 'board-three-heaven-lists'));
  assert.ok(xuanhuan.worldBook.find((entry) => entry.id === 'faction-great-thunder-monastery'));
  assert.ok(xuanhuan.worldBook.find((entry) => entry.id === 'npc-youquan-demon'));
  assert.equal(xuanhuan.worldBook.length >= 54, true);
  assert.equal(xianxia.characterCard.name, '闻雪照');
  assert.equal(xianxia.memory.worldState.flags.genre, 'xianxia');
  assert.equal(xianxia.ruleSystem.contentPackId, 'xianxia');
  assert.match(JSON.stringify(xianxia.ruleSystem), /仙门因果/);
  assert.equal(ruleLabels(xianxia.ruleSystem).some((label) => label.includes('银粮')), false);
  assert.equal(ruleLabels(xianxia.ruleSystem).some((label) => label.includes('死亡倒计时')), false);
  assert.ok(xianxia.worldBook.find((entry) => entry.id === 'sect-qingxu'));
  assert.ok(xianxia.worldBook.find((entry) => entry.id === 'event-falling-thunder-secret-realm'));
  assert.ok(xianxia.worldBook.find((entry) => entry.id === 'rule-heavenly-tribulation'));
  assert.ok(xianxia.worldBook.find((entry) => entry.id === 'faction-cultivation-clans'));
  assert.ok(xianxia.worldBook.find((entry) => entry.id === 'rule-immortal-court-documents'));
  assert.ok(xianxia.worldBook.find((entry) => entry.id === 'board-xianji-ranking'));
  assert.ok(xianxia.worldBook.find((entry) => entry.id === 'rule-xianxia-art-ranks'));
  assert.ok(xianxia.worldBook.find((entry) => entry.id === 'rule-sect-contribution-ledger'));
  assert.ok(xianxia.worldBook.find((entry) => entry.id === 'rule-clan-lineage-ledger'));
  assert.ok(xianxia.worldBook.find((entry) => entry.id === 'bible-xianxia-lineage-governance'));
  assert.ok(xianxia.promptModules.find((module) => module.id === 'xianxia-lineage-governance'));
  assert.equal(xianxia.memory.narrativeState.lockedGenre, 'xianxia');
  assert.equal(xianxia.memory.worldState.resourceLedger.length >= 2, true);
  assert.equal(xianxia.worldBook.length >= 46, true);
  assert.equal(yingxiongzhi.characterCard.name, '卢云');
  assert.equal(yingxiongzhi.memory.worldState.flags.genre, 'yingxiongzhi');
  assert.equal(yingxiongzhi.ruleSystem.contentPackId, 'yingxiongzhi');
  assert.equal(yingxiongzhi.source.characterCount, 96);
  assert.equal(yingxiongzhi.source.nodeCount, 45);
  assert.equal(yingxiongzhi.worldBook.length >= 155, true);
  assert.equal(yingxiongzhi.worldBook.filter((entry) => entry.type === 'story-node').length, 45);
  assert.ok(yingxiongzhi.worldBook.find((entry) => entry.extensions?.agentId === 'wu_chonghua'));
  assert.ok(yingxiongzhi.worldBook.find((entry) => entry.id === 'opening-yingxiongzhi-e02'));
  assert.ok(yingxiongzhi.worldBook.find((entry) => entry.extensions?.visibility === 'gm'));
  assert.ok(yingxiongzhi.worldBook.find((entry) => entry.extensions?.visibility === 'player'));
  assert.equal(listContentPackCharacters('yingxiongzhi').length, 12);
  assert.ok(listContentPackCharacters('yingxiongzhi').find((preset) => preset.characterCard.name === '顾倩兮'));
  [
    ['xuanhuan', '叶沉舟'],
    ['lingyi', '陈默'],
    ['mingmo', '顾怀砚'],
    ['xianxia', '闻雪照']
  ].forEach(([packId, characterName]) => {
    const presets = listContentPackCharacters(packId);
    assert.equal(presets.length >= 4, true);
    assert.equal(presets[0].id, `${packId}_default_character`);
    assert.equal(presets[0].characterCard.name, characterName);
    assert.ok(presets.slice(1).every((preset) => preset.characterCard.extensions?.npcCard === true));
    assert.ok(presets.slice(1).some((preset) => preset.characterCard.extensions?.privateKnowledge?.length));
  });

  assert.ok(xuanhuan.worldBook.find((entry) => entry.id === 'event-heaven-list-challenge'));
  assert.ok(lingyi.worldBook.find((entry) => entry.id === 'rule-witness-contamination'));
  assert.ok(lingyi.worldBook.find((entry) => entry.id === 'rule-true-name-response'));
  assert.ok(lingyi.worldBook.find((entry) => entry.id === 'npc-bai-qiao'));
  assert.ok(lingyi.worldBook.find((entry) => entry.id === 'event-posthumous-autopsy-report'));
  assert.equal(lingyi.worldBook.length >= 53, true);
  assert.ok(mingmo.worldBook.find((entry) => entry.id === 'event-canal-quarantine'));
  assert.ok(mingmo.worldBook.find((entry) => entry.id === 'rule-official-document-lifecycle'));
  assert.ok(mingmo.worldBook.find((entry) => entry.id === 'event-bailiang-warehouse-fire'));
  assert.ok(mingmo.worldBook.find((entry) => entry.id === 'rule-mingmo-event-clocks'));
  assert.equal(mingmo.worldBook.length >= 57, true);
  assert.ok(xianxia.worldBook.find((entry) => entry.id === 'event-sect-rationing'));
});

test('built-in packs declare explicit inheritance boundaries for custom derivatives', () => {
  for (const packId of ['xuanhuan', 'lingyi', 'mingmo', 'xianxia', 'yingxiongzhi']) {
    const pack = getContentPack(packId);
    assert.ok(pack.worldBook.length > 0);
    assert.ok(pack.worldBook.every((entry) => entry.extensions?.inheritanceScope === 'story'));
    assert.ok(pack.promptModules.every((module) => ['genre', 'story'].includes(module.extensions?.inheritanceScope)));
    assert.equal(
      pack.promptModules.find((module) => module.id === 'world-premise')?.extensions?.inheritanceScope,
      'story'
    );
    assert.equal(
      pack.promptModules.find((module) => module.id.endsWith('-core-route-contract'))?.extensions?.inheritanceScope,
      'story'
    );
    assert.equal(
      pack.promptModules.find((module) => module.id === 'core-rules')?.extensions?.inheritanceScope,
      'genre'
    );
  }
});

test('genre packs include long-form world bibles and distinct prose contracts', () => {
  const expectedNarrativeModules = {
    xuanhuan: ['xuanhuan-longform-scene-engine', 'xuanhuan-dialogue-registers', 'xuanhuan-chapter-contract', 'xuanhuan-core-route-contract'],
    lingyi: ['lingyi-longform-scene-engine', 'lingyi-dialogue-registers', 'lingyi-chapter-contract', 'lingyi-core-route-contract'],
    mingmo: ['mingmo-longform-scene-engine', 'mingmo-dialogue-registers', 'mingmo-chapter-contract', 'mingmo-core-route-contract'],
    xianxia: ['xianxia-longform-scene-engine', 'xianxia-dialogue-registers', 'xianxia-chapter-contract', 'xianxia-lineage-governance', 'xianxia-core-route-contract'],
    yingxiongzhi: ['hero-longform-scene-engine', 'hero-dialogue-registers', 'hero-chapter-contract', 'yingxiongzhi-core-route-contract']
  };

  for (const [packId, moduleIds] of Object.entries(expectedNarrativeModules)) {
    const pack = getContentPack(packId);
    const bibleEntries = pack.worldBook.filter((entry) => entry.extensions?.bibleSection === true);
    const ids = pack.worldBook.map((entry) => entry.id);

    assert.equal(new Set(ids).size, ids.length, `${packId} world book ids must be unique`);
    assert.equal(bibleEntries.length >= 7, true, `${packId} needs a substantial world bible`);
    assert.equal(bibleEntries.every((entry) => entry.content.length >= 150), true);
    assert.equal(bibleEntries.every((entry) => entry.extensions?.originalSetting === true), true);
    assert.equal(bibleEntries.some((entry) => entry.type === 'campaign'), true);
    assert.equal(bibleEntries.some((entry) => ['rule', 'realm'].includes(entry.type)), true);
    moduleIds.forEach((moduleId) => assert.ok(pack.promptModules.find((item) => item.id === moduleId)));
    assert.equal(pack.memory.narrativeState.lockedGenre, packId);
    assert.equal(pack.memory.narrativeState.corePillars.length >= 4, true);
    assert.equal(pack.memory.narrativeState.supportingElements.length >= 5, true);
    assert.equal(pack.memory.narrativeState.forbiddenDominance.length >= 3, true);
    assert.equal(pack.memory.narrativeState.referenceFocus.length >= 4, true);
    assert.match(pack.memory.narrativeState.routeReturnRule, /回流|必须/);
  }

  assert.deepEqual(getContentPack('yingxiongzhi').characterCard.extensions.inspirationRefs, [
    '英雄志', '鹿鼎记', '笑傲江湖', '将夜', '雪中悍刀行', '庆余年'
  ]);
});

test('content packs declare original genre inspirations without copying source casts', () => {
  const expectedRefs = {
    xuanhuan: ['斗破苍穹', '遮天', '完美世界', '夜无疆', '元始法则', '苟在武道世界成圣', '诡秘之主', '剑来', '帝霸'],
    lingyi: ['鬼吹灯', '盗墓笔记', '捞尸人', '异度旅社', '诡秘之主', '我有一座恐怖屋', '神秘复苏', '我当阴阳先生的那几年', '地狱公寓', '茅山后裔', '最后一个道士', '镇妖博物馆', '超级惊悚直播', '诡舍'],
    mingmo: ['庆余年', '赘婿', '大明王朝1566', '回到明朝当王爷', '宰执天下', '极品家丁', '穷鬼的上下两千年', '覆汉', '秦吏', '唐砖', '绍宋', '高门庶子', '状元郎', '朕'],
    xianxia: ['凡人修仙传', '仙逆', '诛仙', '遮天', '玄鉴仙族', '赤心巡天', '山河稷', '没钱修什么仙', '光阴之外'],
    yingxiongzhi: ['英雄志', '鹿鼎记', '笑傲江湖', '将夜', '雪中悍刀行', '庆余年']
  };
  const expectedTechniques = {
    xuanhuan: /体系升级|长篇群像|隐秘规则|东方玄幻气象/,
    lingyi: /民俗法脉|驭鬼代价|公寓规则|直播探险/,
    mingmo: /制度穿越|财政官场|基层治理|宋明政务/,
    xianxia: /凡人流|家族流|庙堂修真|道心热血|代际传承|资源权属/,
    yingxiongzhi: /群像|身份错位|江湖庙堂|信息差/
  };

  const summaries = listContentPackSummaries();
  for (const [packId, refs] of Object.entries(expectedRefs)) {
    const pack = getContentPack(packId);
    const summary = summaries.find((item) => item.id === packId);
    const referenceEntry = pack.worldBook.find((entry) => entry.id === `reference-${packId}-genre-methods`);
    const referencePrompt = pack.promptModules.find((module) => module.id === `${packId}-genre-methods`);

    assert.ok(referenceEntry);
    assert.ok(referencePrompt);
    assert.deepEqual(pack.characterCard.extensions.inspirationRefs, refs);
    assert.deepEqual(summary.inspirationRefs, refs);
    assert.equal(summary.narrative.corePillars.length >= 4, true);
    assert.equal(summary.narrative.referenceFocus.length >= 4, true);
    assert.equal(summary.narrative.activeArc, pack.memory.narrativeState.activeArc);
    assert.match(referenceEntry.content, /方法论参考/);
    assert.match(referenceEntry.content, /参考拆解/);
    assert.match(referenceEntry.content, expectedTechniques[packId]);
    assert.ok(pack.characterCard.extensions.genreTechniques.length >= 7);
    if (packId === 'yingxiongzhi') {
      assert.match(referenceEntry.content, /资料包中的人物、关系与阶段状态可按用户提供资料使用/);
      assert.match(pack.characterCard.creatorNotes, /资料包/);
    } else {
      assert.match(referenceEntry.content, /不复刻原作人物、势力、剧情或专有名词/);
      assert.match(pack.characterCard.creatorNotes, /原创角色/);
    }
    for (const ref of refs) {
      assert.match(referenceEntry.content, new RegExp(ref));
    }
  }
});

function ruleLabels(ruleSystem) {
  return ruleSystem.panels.flatMap((panel) => panel.fields.map((field) => field.label));
}
