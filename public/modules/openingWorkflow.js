export function createOpeningWorkflowController({
  state = {},
  els = {},
  visualPresets = {},
  getOpeningGenreIds = () => [],
  getOpeningGenreOption = (genre) => ({ id: genre, title: genre, hint: '' }),
  getCurrentSessionId = () => 'main',
  getAppliedContentPackId = () => '',
  getContentPackTitle = (packId) => String(packId || ''),
  setOpeningGenre = () => {},
  applyContentPack = async () => null,
  renderSetupPanel = () => {},
  buildJourneyDraft = () => ({ promptText: '' }),
  setComposerInputValue = () => {},
  sendMessage = async () => {},
  renderMessages = () => {},
  applyBackgroundImage = () => {},
  saveSettingsPatch = async () => ({}),
  mergeSession = () => {},
  setStatus = () => {},
  openProviderSettings = () => {},
  backgroundUrlsMatch = (left, right) => left === right,
  documentObject = globalThis.document
} = {}) {
  function getBoundStoryPackId() {
    const projectId = state.session?.storyProjectId;
    const project = (state.storyProjects || []).find((item) => item.id === projectId);
    return state.session?.basePackId || project?.basePackId || '';
  }

  function getCurrentContentPackSummary() {
    const packIds = [
      getBoundStoryPackId(),
      state.session?.memory?.resourcePackId,
      state.session?.memory?.ruleSystem?.contentPackId
    ].filter(Boolean);
    return packIds
      .map((packId) => (state.contentPacks || []).find((pack) => pack.id === packId))
      .find(Boolean) || null;
  }

  function getCurrentStoryPresentation(tpl, genre) {
    const pack = getCurrentContentPackSummary();
    const custom = tpl?.source === 'custom-pack' || pack?.custom === true;
    const genreTitle = getOpeningGenreOption(genre).title;
    return {
      custom,
      pack,
      title: custom
        ? (pack?.title || tpl?.title || state.session?.title || state.config?.characterCard?.name || '角色卡原生剧本')
        : genreTitle,
      sourceLabel: custom ? (tpl?.genreLabel || '角色卡原生剧本') : genreTitle
    };
  }

  function getContentPackVisualPreset(packId) {
    const key = String(packId || '').trim();
    const fallbackId = visualPresets.neutral ? 'neutral' : (Object.keys(visualPresets)[0] || '');
    const resolvedId = visualPresets[key] ? key : fallbackId;
    return {
      packId: resolvedId,
      ...(visualPresets[resolvedId] || {})
    };
  }

  function getBackgroundContentPackId() {
    const backgroundImage = state.session?.settings?.backgroundImage || '';
    return Object.entries(visualPresets)
      .find(([, preset]) => backgroundUrlsMatch(backgroundImage, preset.backgroundImage))?.[0] || '';
  }

  function applyContentPackVisualState(packId, options = {}) {
    const preset = getContentPackVisualPreset(packId);
    const backgroundImage = String(options.backgroundImage || preset.backgroundImage || '');
    const backgroundFit = options.backgroundFit === 'portrait' ? 'portrait' : 'cover';
    const backgroundSource = String(
      options.backgroundSource
      || (backgroundFit === 'portrait' ? 'character-portrait' : 'content-pack')
    );
    applyBackgroundImage(backgroundImage, backgroundFit);
    const base = state.session || { id: getCurrentSessionId(), messages: [] };
    mergeSession({
      settings: {
        ...(base.settings || {}),
        backgroundImage,
        backgroundFit,
        backgroundSource,
        visualContentPack: preset.packId
      }
    });
    return { backgroundFit, backgroundImage, backgroundSource, preset };
  }

  function restoreVisualState(settings) {
    mergeSession({ settings });
    applyBackgroundImage(settings.backgroundImage || '', settings.backgroundFit || 'cover');
  }

  async function linkContentPackVisuals(packId, options = {}) {
    const previousSettings = { ...(state.session?.settings || {}) };
    const visualState = applyContentPackVisualState(packId, options);
    if (options.persist !== false) {
      try {
        await saveSettingsPatch({
          backgroundImage: visualState.backgroundImage,
          backgroundFit: visualState.backgroundFit,
          backgroundSource: visualState.backgroundSource,
          visualContentPack: visualState.preset.packId
        });
      } catch (error) {
        restoreVisualState(previousSettings);
        throw error;
      }
    }
    if (options.statusTarget) {
      setStatus(
        options.statusTarget,
        `${options.statusText || '舞台背景已联动'}：${visualState.preset.label}`,
        'ok'
      );
    }
    return visualState.preset;
  }

  function getEnabledWorldBookCount() {
    return Array.isArray(state.config?.worldBook)
      ? state.config.worldBook.filter((entry) => entry?.enabled !== false).length
      : 0;
  }

  function renderOpeningWorkflow(genre, tpl) {
    const genreIds = getOpeningGenreIds();
    const safeGenre = genreIds.includes(genre)
      ? genre
      : (genreIds.includes('xuanhuan') ? 'xuanhuan' : (genreIds[0] || 'xuanhuan'));
    const selected = getOpeningGenreOption(safeGenre);
    const boundPackId = getBoundStoryPackId() || getAppliedContentPackId() || safeGenre;
    const boundPack = (state.contentPacks || []).find((item) => item.id === boundPackId);
    const counts = boundPack?.counts || boundPack?.manifest?.counts || {};
    const wrapper = documentObject.createElement('div');
    wrapper.className = 'epic-start-flow';

    const steps = documentObject.createElement('ol');
    steps.className = 'epic-flow-steps';
    const choiceStepLabel = tpl?.destinyCards?.stepLabel
      || (tpl?.source === 'custom-pack' ? '开局要素' : '天命抉择');
    const hasOpeningChoices = Array.isArray(tpl?.destinyCards?.cards) && tpl.destinyCards.cards.length > 0;
    [
      '剧本已定',
      tpl?.source === 'custom-pack' ? '主角确认' : '主角塑成',
      ...(hasOpeningChoices ? [choiceStepLabel] : []),
      '生成开局',
      '进入第一幕'
    ].forEach((label, index) => {
      const item = documentObject.createElement('li');
      item.className = index === 0 ? 'complete' : (index === 1 ? 'active' : '');
      const mark = documentObject.createElement('span');
      mark.textContent = String(index + 1);
      item.append(mark, documentObject.createTextNode(label));
      steps.append(item);
    });

    const currentScript = documentObject.createElement('section');
    currentScript.className = 'epic-current-script';
    const scriptCopy = documentObject.createElement('div');
    scriptCopy.className = 'epic-current-script-copy';
    const scriptLabel = documentObject.createElement('span');
    scriptLabel.className = 'epic-current-script-label';
    scriptLabel.textContent = '当前剧本';
    const scriptTitle = documentObject.createElement('strong');
    scriptTitle.textContent = boundPack?.title || selected.title;
    const scriptDescription = documentObject.createElement('p');
    scriptDescription.textContent = boundPack?.description || selected.hint;
    scriptCopy.append(scriptLabel, scriptTitle, scriptDescription);

    const scriptStats = documentObject.createElement('div');
    scriptStats.className = 'epic-current-script-stats';
    const characterFallback = Array.isArray(state.config?.characterPresets) && state.config.characterPresets.length
      ? state.config.characterPresets.length
      : (boundPack?.characterName ? 1 : 0);
    [
      ['世界书', counts.worldBook ?? getEnabledWorldBookCount()],
      ['角色', counts.characterPresets ?? characterFallback],
      ['规则', counts.promptModules ?? state.config?.promptModules?.length ?? 0]
    ].forEach(([label, value]) => {
      const stat = documentObject.createElement('span');
      const number = documentObject.createElement('strong');
      number.textContent = String(value);
      stat.append(number, documentObject.createTextNode(label));
      scriptStats.append(stat);
    });
    currentScript.append(scriptCopy, scriptStats);
    wrapper.append(steps, currentScript);

    const errorPanel = createOpeningErrorPanel();
    if (errorPanel) wrapper.append(errorPanel);

    const status = documentObject.createElement('div');
    status.className = 'epic-flow-status';
    [
      `当前题材：${selected.title}`,
      `开局模板：${tpl?.title || '未载入'}`,
      `已启用世界书：${getEnabledWorldBookCount()} 条`
    ].forEach((text) => {
      const chip = documentObject.createElement('span');
      chip.textContent = text;
      status.append(chip);
    });
    wrapper.append(status);
    return wrapper;
  }

  function createOpeningErrorPanel() {
    if (!state.openingError) return null;
    const errorPanel = documentObject.createElement('div');
    errorPanel.className = 'epic-opening-error';
    errorPanel.setAttribute('role', 'alert');
    const errorCopy = documentObject.createElement('span');
    errorCopy.textContent = state.openingError;
    const providerButton = documentObject.createElement('button');
    providerButton.type = 'button';
    providerButton.textContent = '检查接口';
    providerButton.addEventListener('click', openProviderSettings);
    errorPanel.append(errorCopy, providerButton);
    return errorPanel;
  }

  function getCurrentPrologueGenre() {
    const templates = state.prologueTemplate?.genres || {};
    const sessionGenre = state.session?.memory?.worldState?.flags?.genre;
    const visualContentPack = state.session?.settings?.visualContentPack;
    const cardGenre = state.config?.characterCard?.extensions?.contentPack
      || state.config?.characterCard?.extensions?.genre;
    const selectedPack = els.contentPackSelect?.dataset.userSelected === 'true'
      ? els.contentPackSelect.value
      : '';
    const candidates = [
      selectedPack,
      visualContentPack,
      sessionGenre,
      cardGenre,
      els.contentPackSelect?.value,
      'xuanhuan'
    ];
    return candidates.find((candidate) => candidate && templates[candidate]) || 'xuanhuan';
  }

  function resolvePrologueTemplate() {
    const templates = state.prologueTemplate?.genres || {};
    const genre = getCurrentPrologueGenre();
    const boundPackId = getBoundStoryPackId();
    const boundPack = (state.contentPacks || []).find((item) => item.id === boundPackId);
    const customTemplate = boundPack?.custom === true
      && boundPack.openingTemplate
      && typeof boundPack.openingTemplate === 'object'
      ? boundPack.openingTemplate
      : null;
    if (customTemplate) {
      const customGenre = getOpeningGenreIds().includes(customTemplate.genre)
        ? customTemplate.genre
        : genre;
      return { genre: customGenre, tpl: customTemplate };
    }
    return {
      genre,
      tpl: templates[genre] || templates.xuanhuan
    };
  }

  function inferPrologueGenreFromTemplate(tpl) {
    const genres = state.prologueTemplate?.genres || {};
    if (getOpeningGenreIds().includes(tpl?.genre)) return tpl.genre;
    const direct = Object.entries(genres).find(([, candidate]) => candidate === tpl);
    if (direct) return direct[0];
    const title = `${tpl?.title || ''} ${tpl?.subtitle || ''} ${tpl?.tagline || ''}`;
    if (/仙|太虚|飞升|天道/.test(title)) return 'xianxia';
    if (/英雄志|乱世文章|群像旧账/.test(title)) return 'yingxiongzhi';
    if (/明末|崇祯|银粮|密诏/.test(title)) return 'mingmo';
    if (/灵异|微笑|禁忌|永安|阴阳/.test(title)) return 'lingyi';
    if (/神荒|武界|江湖|雁回/.test(title)) return 'xuanhuan';
    return getCurrentPrologueGenre();
  }

  async function startGuidedJourney(genre) {
    const boundPackId = getBoundStoryPackId();
    if (boundPackId) {
      setStatus(els.sessionStatus, `当前剧本：${getContentPackTitle(boundPackId)}`, 'ok');
      renderSetupPanel(resolvePrologueTemplate().tpl);
      return true;
    }
    setOpeningGenre(genre || getCurrentPrologueGenre(), { render: false, linkVisuals: false });
    setStatus(els.sessionStatus, '正在同步题材内容包...', 'busy');
    const applied = await applyContentPack();
    if (!applied) return false;
    renderSetupPanel(resolvePrologueTemplate().tpl);
    return true;
  }

  async function startJourney(formData, tpl, destinyCards = [], options = {}) {
    const draft = buildJourneyDraft(formData, tpl, destinyCards);
    state.pendingJourneyDraft = draft;
    state.openingError = '';
    setComposerInputValue(draft.promptText);
    if (options.autoSend) {
      await sendMessage();
      return draft;
    }
    renderMessages();
    els.chatInput?.focus();
    return draft;
  }

  return {
    createOpeningErrorPanel,
    getBackgroundContentPackId,
    getBoundStoryPackId,
    getContentPackVisualPreset,
    getCurrentContentPackSummary,
    getCurrentPrologueGenre,
    getCurrentStoryPresentation,
    inferPrologueGenreFromTemplate,
    linkContentPackVisuals,
    renderOpeningWorkflow,
    resolvePrologueTemplate,
    startGuidedJourney,
    startJourney
  };
}
