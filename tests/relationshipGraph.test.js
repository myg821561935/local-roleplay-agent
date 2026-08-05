import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImmersiveRelationshipGraph,
  collectImmersiveCharacterMembers
} from '../public/modules/relationshipGraph.js';
import { extractCharacterPanelExcerpt } from '../public/modules/immersiveSidebar.js';

test('interactive character collection recognizes materialized status panels and prior encounters', () => {
  const members = collectImmersiveCharacterMembers({
    protagonistNames: ['刘一'],
    relationships: [
      { name: '江小鲤', role: '凌霄山庄小姐', encountered: true, relationship: '已结识' },
      { name: '苏师兄', role: '杂役院前辈', encountered: false, relationship: '间接关联，尚未见面' }
    ],
    messages: [{
      role: 'assistant',
      roleplayPanels: {
        characterStatus: '『张三·角色状态』\n身份：杂役\n『刘一·主角状态』\n身份：炉鼎体质',
        relationshipStatus: '刘一→张三：交换了西门消息'
      }
    }],
    interactiveStatus: '『江小鲤·状态』\n身份：庄主之女',
    relationshipStatus: '刘一→江小鲤：获得帮助'
  });

  assert.deepEqual(members.map((member) => member.name).sort(), ['张三', '江小鲤']);
  assert.match(extractCharacterPanelExcerpt('『江小鲤·状态』\n身份：庄主之女', '江小鲤'), /庄主之女/);
});

test('relationship graph distinguishes direct encounters, indirect links and factions', () => {
  const graph = buildImmersiveRelationshipGraph({
    protagonistName: '刘一',
    relationships: [
      { name: '江小鲤', role: '凌霄山庄小姐', encountered: true, relationship: '救命之恩' },
      { name: '苏师兄', encountered: false, status: '仅从他人口中得知，尚未见面' }
    ],
    factions: [{ name: '凌霄山庄', status: '当前所在势力' }],
    relationshipStatus: '刘一→江小鲤：信任增加'
  });

  assert.equal(graph.nodes.find((node) => node.id === '刘一').type, 'protagonist');
  assert.equal(graph.nodes.find((node) => node.id === '江小鲤').direct, true);
  assert.equal(graph.nodes.find((node) => node.id === '苏师兄').direct, false);
  assert.equal(graph.nodes.find((node) => node.id === '凌霄山庄').type, 'faction');
  assert.ok(graph.edges.some((edge) => edge.source === '刘一' && edge.target === '江小鲤'));
});

test('relationship graph consumes the server knowledge-graph projection', () => {
  const graph = buildImmersiveRelationshipGraph({
    protagonistName: '刘一',
    graphProjection: {
      nodes: [
        { id: 'c1', type: 'Character', label: '刘一', properties: { protagonist: true } },
        { id: 'c2', type: 'Character', label: '江小鲤', properties: { role: '庄主之女', encountered: true } },
        { id: 'f1', type: 'Faction', label: '凌霄山庄', properties: {} }
      ],
      edges: [
        { source: 'c1', target: 'c2', type: 'TRUSTS', label: '逐渐信任', properties: {} },
        { source: 'c2', target: 'f1', type: 'MEMBER_OF', properties: {} }
      ]
    }
  });

  assert.equal(graph.nodes.find((node) => node.id === '江小鲤').role, '庄主之女');
  assert.ok(graph.edges.some((edge) => edge.source === '江小鲤' && edge.target === '凌霄山庄'));
});
