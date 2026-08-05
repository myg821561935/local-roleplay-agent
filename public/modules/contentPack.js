import { getPackCompatibilityAudit, isPackStartBlocked } from './packCompatibility.js';

export function createContentPackController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  getCurrentSessionId = () => 'main',
  updateSession = () => {},
  getOpeningGenreIds = () => [],
  getOpeningGenreOption = (packId) => ({ title: packId }),
  loadContentPackCharacterPresets = async () => {},
  getStoryStageBackground = () => null,
  linkContentPackVisuals = async (packId) => ({ label: packId }),
  renderAll = () => {},
  renderImmersiveSidebar = () => {},
  renderMessages = () => {},
  renderResourcePackBuilder = () => {},
  getBackgroundContentPackId = () => '',
  getBackgroundLabelForUrl = () => '',
  documentObject = globalThis.document
} = {}) {
  function bindEvents() {
    els.applyContentPack?.addEventListener('click', () => applyContentPack());
    els.contentPackSelect?.addEventListener('change', () => handleContentPackSelectionChange());
  }

  function renderContentPackOptions() {
    const packs = Array.isArray(state.contentPacks) ? state.contentPacks : [];
    if (!packs.length) return;
    const contentPackControls = els.contentPackSelect?.closest('.content-pack-controls');
    if (contentPackControls) {
      contentPackControls.hidden = Boolean(state.session?.storyProjectId);
    }
    const appliedPack = state.session?.memory?.resourcePackId
      || state.session?.memory?.ruleSystem?.contentPackId
      || '';
    const currentPack = appliedPack || els.contentPackSelect?.value || 'xuanhuan';
    const newSessionPack = els.newSessionPack?.value ?? '';

    if (els.contentPackSelect) {
      populateContentPackSelect(els.contentPackSelect, packs, { includeEmpty: false });
      els.contentPackSelect.value = packs.some((pack) => pack.id === currentPack) ? currentPack : 'xuanhuan';
    }
    if (els.newSessionPack) {
      populateContentPackSelect(els.newSessionPack, packs, { includeEmpty: true });
      els.newSessionPack.value = packs.some((pack) => pack.id === newSessionPack) ? newSessionPack : '';
    }
    renderResourcePackBuilder();
  }

  function populateContentPackSelect(select, packs, { includeEmpty }) {
    select.innerHTML = '';
    if (includeEmpty) {
      const empty = documentObject.createElement('option');
      empty.value = '';
      empty.textContent = '（不使用题材包，从下方资产拼装）';
      select.append(empty);
    }

    const builtIn = packs.filter((pack) => pack.custom !== true);
    const custom = packs.filter((pack) => pack.custom === true);
    appendContentPackOptionGroup(select, '内置题材', builtIn);
    appendContentPackOptionGroup(select, '我的剧本', custom);
  }

  function appendContentPackOptionGroup(select, label, packs) {
    if (!packs.length) return;
    const group = documentObject.createElement('optgroup');
    group.label = label;
    for (const pack of packs) {
      const option = documentObject.createElement('option');
      option.value = pack.id;
      const audit = getPackCompatibilityAudit(pack);
      option.textContent = pack.custom === true
        ? `${pack.title || pack.id} · ${audit.label}`
        : pack.title || pack.id;
      option.disabled = isPackStartBlocked(pack);
      option.title = option.disabled ? audit.reason : '';
      group.append(option);
    }
    select.append(group);
  }

  function getAppliedContentPackId() {
    const candidates = [
      state.session?.memory?.resourcePackId,
      state.session?.memory?.ruleSystem?.contentPackId,
      state.session?.memory?.worldState?.flags?.genre,
      state.config?.characterCard?.extensions?.contentPack
    ];
    const knownPackIds = new Set((state.contentPacks || []).map((pack) => pack.id));
    return candidates.find((packId) => knownPackIds.has(packId) || getOpeningGenreIds().includes(packId)) || '';
  }

  function getContentPackTitle(packId, fallback = '自定义') {
    const pack = (state.contentPacks || []).find((item) => item.id === packId);
    if (pack) return pack.title || packId;
    return getOpeningGenreIds().includes(packId) ? getOpeningGenreOption(packId).title : fallback;
  }

  function setContentPackPreviewStatus(packId) {
    const appliedPack = getAppliedContentPackId();
    const previewTitle = getContentPackTitle(packId);
    if (packId === appliedPack) {
      setStatus(els.contentPackStatus, `视觉预览：${previewTitle} · 会话内容已同步`, 'ok');
    } else {
      const appliedTitle = getContentPackTitle(appliedPack, '尚未绑定内容包');
      setStatus(els.contentPackStatus, `仅预览：${previewTitle} · 当前会话：${appliedTitle}`, 'warning');
    }
    renderContentStack();
  }

  async function handleContentPackSelectionChange() {
    const packId = els.contentPackSelect?.value || 'xuanhuan';
    if (els.contentPackSelect) els.contentPackSelect.dataset.userSelected = 'true';
    setStatus(els.contentPackStatus, '正在同步规则、世界书、角色卡和舞台背景...', 'busy');
    try {
      const payload = await applyContentPack();
      if (!payload) return null;
      setContentPackPreviewStatus(packId);
      return payload;
    } catch (error) {
      setStatus(els.contentPackStatus, `题材同步失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      renderImmersiveSidebar();
      if (!Array.isArray(state.session?.messages) || state.session.messages.length === 0) {
        renderMessages();
      }
    }
  }

  function setOpeningGenre(genre, options = {}) {
    const genreIds = getOpeningGenreIds();
    const safeGenre = genreIds.includes(genre) ? genre : 'xuanhuan';
    if (els.contentPackSelect) {
      els.contentPackSelect.value = safeGenre;
      els.contentPackSelect.dataset.userSelected = 'true';
    }
    if (els.randomProtagonistGenre && genreIds.includes(safeGenre)) {
      els.randomProtagonistGenre.value = safeGenre;
    }
    if (options.linkVisuals !== false) {
      void linkContentPackVisuals(safeGenre, {
        persist: true
      }).then(() => {
        setContentPackPreviewStatus(safeGenre);
      }).catch((error) => {
        setStatus(els.contentPackStatus, `视觉联动失败：${humanizeApiError(error)}`, 'error');
      });
    }
    if (options.render !== false && (!Array.isArray(state.session?.messages) || state.session.messages.length === 0)) {
      renderMessages();
    }
    return safeGenre;
  }

  function renderContentStack() {
    if (!els.contentStackStatus || !els.contentStackItems) return;
    const selectedPack = els.contentPackSelect?.value || '';
    const appliedPack = getAppliedContentPackId();
    const characterPack = state.config?.characterCard?.extensions?.contentPack || '';
    const visualPack = state.session?.settings?.visualContentPack || getBackgroundContentPackId();
    const characterName = state.config?.characterCard?.name || '未命名角色';
    const worldBookCount = Array.isArray(state.config?.worldBook) ? state.config.worldBook.length : 0;
    const narrativeState = state.session?.memory?.narrativeState || {};
    const activeArc = narrativeState.activeArc || '未锁定主线';
    const inspirationRefs = Array.isArray(state.config?.characterCard?.extensions?.inspirationRefs)
      ? state.config.characterCard.extensions.inspirationRefs
      : [];
    const referenceSummary = inspirationRefs.length ? inspirationRefs.slice(0, 3).join(' / ') : '原创自定义';
    const previewOnly = Boolean(selectedPack && appliedPack && selectedPack !== appliedPack);
    const mixed = Boolean(appliedPack && [characterPack, visualPack].some((packId) => packId && packId !== appliedPack));

    const status = previewOnly ? '仅视觉预览' : (mixed ? '混合创作栈' : '已同步');
    els.contentStackStatus.textContent = status;
    els.contentStackStatus.className = `stack-status ${previewOnly ? 'is-preview' : (mixed ? 'is-mixed' : 'is-synced')}`;

    const items = [
      ['规则', getContentPackTitle(appliedPack, '未绑定')],
      ['角色', `${characterName} · ${getContentPackTitle(characterPack)}`],
      ['世界书', `${worldBookCount} 条 · ${getContentPackTitle(appliedPack, '自定义')}`],
      ['舞台', getContentPackTitle(visualPack, getBackgroundLabelForUrl(state.session?.settings?.backgroundImage || '') || '自定义')],
      ['主线', activeArc],
      ['参考', referenceSummary]
    ];
    els.contentStackItems.innerHTML = '';
    items.forEach(([label, value]) => {
      const item = documentObject.createElement('div');
      item.className = 'content-stack-item';
      const labelElement = documentObject.createElement('span');
      labelElement.textContent = label;
      const valueElement = documentObject.createElement('strong');
      valueElement.textContent = value;
      valueElement.title = value;
      item.append(labelElement, valueElement);
      els.contentStackItems.append(item);
    });

    if (els.applyContentPack) {
      const needsApply = Boolean(selectedPack && selectedPack !== appliedPack);
      els.applyContentPack.textContent = needsApply ? '应用到会话' : '重新应用';
      els.applyContentPack.classList.toggle('primary-button', needsApply);
      els.applyContentPack.classList.toggle('ghost-button', !needsApply);
    }
  }

  async function applyContentPack() {
    const packId = els.contentPackSelect?.value || 'xuanhuan';
    const selectedPack = (state.contentPacks || []).find((pack) => pack.id === packId);
    if (selectedPack && isPackStartBlocked(selectedPack)) {
      const audit = getPackCompatibilityAudit(selectedPack);
      setStatus(
        els.contentPackStatus,
        audit.canStartNewStory
          ? '这个内容包的依赖不完整，暂时不能应用。'
          : `${audit.label}：${audit.reason}`,
        'error'
      );
      return null;
    }
    setStatus(els.contentPackStatus, '正在应用题材包...', 'busy');
    if (els.applyContentPack) els.applyContentPack.disabled = true;
    try {
      const payload = await apiRequest(`/api/content-packs/${encodeURIComponent(packId)}/apply`, {
        method: 'POST',
        body: { sessionId: getCurrentSessionId() }
      });
      state.config.promptModules = payload.promptModules || state.config.promptModules;
      state.config.worldBook = payload.worldBook || state.config.worldBook;
      state.config.characterCard = payload.characterCard || state.config.characterCard;
      updateSession(payload.session, { fallback: state.session });
      state.simulationPublicSnapshot = null;
      const visualPackId = payload.appliedPack?.visualPackId || packId;
      if (els.randomProtagonistGenre && getOpeningGenreIds().includes(visualPackId)) {
        els.randomProtagonistGenre.value = visualPackId;
      }
      await loadContentPackCharacterPresets(packId, { silent: true });
      const stageBackground = getStoryStageBackground(payload.appliedPack);
      const visualPreset = await linkContentPackVisuals(visualPackId, {
        persist: true,
        backgroundImage: stageBackground?.url,
        backgroundFit: stageBackground?.fit,
        backgroundSource: stageBackground?.source
      });
      renderAll();
      setStatus(els.contentPackStatus, `已应用到会话：${payload.appliedPack?.title || packId} · 舞台背景：${visualPreset.label}`, 'ok');
      return payload;
    } catch (error) {
      setStatus(els.contentPackStatus, `应用失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      if (els.applyContentPack) els.applyContentPack.disabled = false;
    }
  }

  return {
    applyContentPack,
    bindEvents,
    getAppliedContentPackId,
    getContentPackTitle,
    renderContentPackOptions,
    renderContentStack,
    setContentPackPreviewStatus,
    setOpeningGenre
  };
}
