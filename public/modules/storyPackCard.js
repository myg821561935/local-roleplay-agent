import {
  compatibilityActionLabel,
  getPackCompatibilityAudit,
  isPackStartBlocked
} from './packCompatibility.js';

export function createStoryPackCardView(pack, {
  documentObject = globalThis.document,
  getStoryPackVisualId,
  getContentPackVisualPreset,
  storyPackPresentation = {},
  getStoryStageBackground,
  createCharacterPortraitImage = () => null
} = {}) {
  const visualPackId = getStoryPackVisualId(pack);
  const visual = getContentPackVisualPreset(visualPackId);
  const presentation = storyPackPresentation[visual.packId]
    || storyPackPresentation.neutral
    || { badge: '故事', accent: '#6b8afd' };
  const counts = pack.counts || pack.manifest?.counts || {};
  const audit = getPackCompatibilityAudit(pack);
  const blocked = isPackStartBlocked(pack);
  const stageBackground = getStoryStageBackground(pack);

  const card = documentObject.createElement('article');
  card.className = 'story-script-card';
  card.classList.add(`compatibility-${audit.tone}`);
  card.dataset.storyPackCard = pack.id;
  card.dataset.visualPackId = visual.packId;
  const cardBackground = stageBackground?.url || visual.backgroundImage;
  card.style.setProperty('--story-card-image', `url("${cardBackground}")`);
  card.classList.toggle('has-character-stage', Boolean(stageBackground));
  card.style.setProperty('--story-card-accent', presentation.accent);

  const top = documentObject.createElement('div');
  top.className = 'story-card-top';
  const identity = documentObject.createElement('div');
  identity.className = 'story-card-identity';
  const portrait = createCharacterPortraitImage(
    pack.characterPortrait,
    'story-card-portrait',
    pack.characterName
  );
  const badge = documentObject.createElement('span');
  badge.className = 'story-card-badge';
  badge.textContent = pack.custom ? '我的剧本' : presentation.badge;
  const version = documentObject.createElement('span');
  version.className = 'story-card-version';
  version.textContent = `v${pack.version || pack.manifest?.version || '1.0.0'}`;
  if (portrait) identity.append(portrait);
  identity.append(badge);
  const compatibilityBadge = documentObject.createElement('span');
  compatibilityBadge.className = `story-card-compatibility is-${audit.tone}`;
  compatibilityBadge.textContent = audit.label;
  compatibilityBadge.title = audit.reason;
  top.append(identity, compatibilityBadge, version);

  const body = documentObject.createElement('div');
  body.className = 'story-card-body';
  const title = documentObject.createElement('h4');
  title.textContent = pack.title || pack.id;
  const description = documentObject.createElement('p');
  description.textContent = pack.description || '从这个内容包建立新的故事工程。';
  const compatibilityNote = documentObject.createElement('p');
  compatibilityNote.className = `story-card-compatibility-note is-${audit.tone}`;
  compatibilityNote.textContent = audit.reason;
  const stats = documentObject.createElement('div');
  stats.className = 'story-card-stats';
  stats.append(
    createStoryStat(documentObject, '世界书', counts.worldBook || 0),
    createStoryStat(documentObject, '角色', counts.characterPresets || (pack.characterName ? 1 : 0)),
    createStoryStat(documentObject, '规则', counts.promptModules || 0)
  );
  const actions = documentObject.createElement('div');
  actions.className = 'story-card-actions';
  const action = documentObject.createElement('button');
  action.type = 'button';
  action.className = 'story-card-action';
  action.dataset.startStoryPack = pack.id;
  action.disabled = blocked;
  action.textContent = blocked
    ? (audit.canStartNewStory ? '依赖不完整，暂不可开局' : audit.label)
    : '以此剧本新开一局';
  const manage = documentObject.createElement('div');
  manage.className = 'story-card-manage';
  appendManagementActions(documentObject, manage, pack, audit);
  actions.append(action, manage);
  body.append(title, description, compatibilityNote, stats, actions);
  card.append(top, body);
  return card;
}

function appendManagementActions(documentObject, manage, pack, audit) {
  const edit = documentObject.createElement('button');
  edit.type = 'button';
  edit.className = 'story-card-secondary-action';
  if (pack.custom) {
    edit.dataset.editStoryPack = pack.id;
    edit.textContent = '编辑';
    edit.title = '修改剧本名称和说明';
  } else {
    edit.dataset.deriveStoryPack = pack.id;
    edit.textContent = '派生修改';
    edit.title = '以此内置剧本为基线创建副本';
  }
  manage.append(edit);
  const actionLabel = compatibilityActionLabel(audit);
  if (pack.custom && actionLabel) {
    const review = documentObject.createElement('button');
    review.type = 'button';
    review.className = `story-card-secondary-action compatibility is-${audit.tone}`;
    review.dataset.reviewStoryPackCompatibility = pack.id;
    review.textContent = actionLabel;
    review.title = audit.reason;
    manage.append(review);
  }
  if (pack.custom) {
    const remove = documentObject.createElement('button');
    remove.type = 'button';
    remove.className = 'story-card-secondary-action danger';
    remove.dataset.deleteStoryPack = pack.id;
    remove.textContent = '删除';
    remove.title = '移除本地剧本，保留原始素材和存档';
    manage.append(remove);
  }
}

function createStoryStat(documentObject, label, value) {
  const item = documentObject.createElement('span');
  const number = documentObject.createElement('strong');
  number.textContent = String(value);
  item.append(number, documentObject.createTextNode(label));
  return item;
}
