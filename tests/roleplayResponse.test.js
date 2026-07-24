import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoleplayResponse } from '../server/agent/roleplayResponse.js';
import { extractRoleplayPresentation, splitCharacterStatus } from '../public/modules/roleplayResponse.js';

const structuredReply = `<descriptive_analysis>
这里是导演分析，不应显示。
</descriptive_analysis>
<normal_status>
\`\`\`yaml
时间: 嘉宁十六年秋
地点: 江陵府
\`\`\`
</normal_status>
<plot>
暮鼓落下时，你踏进江陵府的长街。雨水沿着青石缝流向城门，一封没有署名的密信正在袖中发烫。
</plot>
<plot>
茶棚里有人抬眼看你，又很快压低斗笠。你知道，第一步已经被人看见了。
</plot>
<relationship_status>
<details><summary>点击查看关系</summary>
叶惊弦：陌路人，警惕上升。
</details>
</relationship_status>
<special_status>
『沈砚状态』
身份：游学士子

『叶惊弦状态』
身份：巡检司暗桩
</special_status>
<NextCharacterPanel>
推荐：叶惊弦。她与当前冲突直接相关。
</NextCharacterPanel>`;

test('roleplay protocol keeps only plot text in the main response', () => {
  const parsed = parseRoleplayResponse(structuredReply);
  assert.match(parsed.content, /暮鼓落下时/);
  assert.match(parsed.content, /第一步已经被人看见/);
  assert.doesNotMatch(parsed.content, /导演分析|normal_status|叶惊弦：陌路人/);
  assert.equal(parsed.panels.sceneStatus, '时间: 嘉宁十六年秋\n地点: 江陵府');
  assert.equal(parsed.panels.relationshipStatus, '叶惊弦：陌路人，警惕上升。');
  assert.match(parsed.panels.characterStatus, /沈砚状态/);
  assert.match(parsed.panels.nextCharacter, /推荐：叶惊弦/);
});

test('plain assistant replies remain unchanged', () => {
  const parsed = parseRoleplayResponse('雨停了，远处传来三声梆子。');
  assert.equal(parsed.content, '雨停了，远处传来三声梆子。');
  assert.deepEqual(parsed.panels, {});
});

test('partial protocol prefixes and hidden analysis do not leak during streaming', () => {
  assert.equal(parseRoleplayResponse('<descrip').content, '');
  assert.equal(parseRoleplayResponse('<descriptive_analysis>内部推演').content, '');
  assert.equal(
    parseRoleplayResponse('<descriptive_analysis>内部推演</descriptive_analysis><plot>城门').content,
    '城门'
  );
  assert.equal(parseRoleplayResponse('城门外雨声渐急。\n```lra-mvu-patch\n{"operations":').content, '城门外雨声渐急。');
  assert.equal(parseRoleplayResponse('城门外雨声渐急。\n```lra-mvu').content, '城门外雨声渐急。');
  assert.equal(parseRoleplayResponse('<lra-mvu').content, '');
});

test('frontend legacy parser recovers panels from saved raw messages', () => {
  const parsed = extractRoleplayPresentation(structuredReply);
  assert.equal(parsed.content, parseRoleplayResponse(structuredReply).content);
  const sections = splitCharacterStatus(parsed.panels.characterStatus, ['沈砚']);
  assert.match(sections.protagonist, /沈砚状态/);
  assert.doesNotMatch(sections.protagonist, /叶惊弦状态/);
  assert.match(sections.interactive, /叶惊弦状态/);
});

test('frontend legacy parser converts control-only output into sidebar data and action buttons', () => {
  const raw = `<NextCharacterPanel>
推荐霍银铃登场，并保留叶拭雪在场。
</NextCharacterPanel>

<recommended_actions>
["拾手接住那枚碎瓷片", "不动声色，任由瓷片掠过身旁", "主动起身，介入两女之间的对话", "继续饮酒，当作无事发生"]
</recommended_actions>`;
  const parsed = extractRoleplayPresentation(raw);
  assert.equal(parsed.content, '');
  assert.match(parsed.panels.nextCharacter, /霍银铃/);
  assert.deepEqual(parsed.recommendedActions, [
    '拾手接住那枚碎瓷片',
    '不动声色，任由瓷片掠过身旁',
    '主动起身，介入两女之间的对话',
    '继续饮酒，当作无事发生'
  ]);
});
