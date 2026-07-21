const MASKED_SECRET = '********';

function isLoopbackUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isProviderConfigured(providersConfig = {}) {
  const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];
  const activeId = String(providersConfig.activeProviderId || providers[0]?.id || '').trim();
  const provider = providers.find((item) => item?.id === activeId) || providers[0];
  if (!provider || !String(provider.id || '').trim()) return false;
  if (!String(provider.model || '').trim()) return false;

  const kind = String(provider.kind || 'openai-compatible').trim().toLowerCase();
  const usesProviderDefaultEndpoint = ['anthropic', 'gemini'].includes(kind);
  if (!usesProviderDefaultEndpoint && !String(provider.baseUrl || '').trim()) return false;

  const apiKey = String(provider.apiKey || '').trim();
  return (!usesProviderDefaultEndpoint && isLoopbackUrl(provider.baseUrl))
    || Boolean(apiKey && apiKey !== 'sk-...')
    || apiKey === MASKED_SECRET;
}

export function createProviderOnboardingBanner({ onConfigure } = {}) {
  const banner = document.createElement('div');
  banner.className = 'provider-onboarding-banner';
  banner.setAttribute('role', 'alert');

  const copy = document.createElement('div');
  copy.className = 'provider-onboarding-copy';
  const title = document.createElement('strong');
  title.textContent = '未配置 Provider';
  const description = document.createElement('span');
  description.textContent = '先连接一个模型，再开始生成剧情。';
  copy.append(title, description);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'provider-onboarding-action';
  button.textContent = '去配置';
  button.addEventListener('click', () => onConfigure?.());

  banner.append(copy, button);
  return banner;
}

export function createChatController(deps) {
  const {
    state,
    els,
    getCurrentSessionId,
    applyBackgroundImage,
    renderImmersiveSidebar,
    renderJourneyDraft,
    setStatus,
    resolvePrologueTemplate,
    renderOpeningWorkflow,
    startGuidedJourney,
    createMessageNode,
    openProviderSettings
  } = deps;

  function renderMessages() {
    const messages = Array.isArray(state.session?.messages) ? state.session.messages : [];
    const openingFocus = messages.length === 0 && !state.pendingJourneyDraft;
    document.body.classList.toggle('story-opening-focus', openingFocus);
    els.messages.innerHTML = '';
    els.messages.classList.remove('has-cover-page', 'has-journey-draft');
    applyBackgroundImage(state.session?.settings?.backgroundImage || '');
    renderImmersiveSidebar();

    if (!messages.length) {
      if (state.pendingJourneyDraft) {
        els.messages.classList.add('has-journey-draft');
        els.messages.append(renderJourneyDraft(state.pendingJourneyDraft));
        els.messages.scrollTop = 0;
        setStatus(els.sessionStatus, `${getCurrentSessionId()} · 开局稿待发送`, 'ok');
        return;
      }

      const empty = document.createElement('div');
      empty.className = 'epic-cover-page';
      els.messages.classList.add('has-cover-page');
      const { genre, tpl } = resolvePrologueTemplate();

      if (!isProviderConfigured(state.config?.providers)) {
        empty.append(createProviderOnboardingBanner({ onConfigure: openProviderSettings }));
      }

      if (tpl) {
        const title = document.createElement('h1');
        title.textContent = tpl.title;
        empty.dataset.prologueGenre = genre;

        const subtitle = document.createElement('h2');
        subtitle.textContent = tpl.subtitle;

        const tagline = document.createElement('p');
        tagline.className = 'epic-tagline';
        tagline.textContent = tpl.tagline;

        const workflow = renderOpeningWorkflow(genre, tpl);

        const startBtn = document.createElement('button');
        startBtn.className = 'epic-start-btn';
        startBtn.type = 'button';
        startBtn.dataset.helpKey = 'startJourney';
        startBtn.textContent = genre === 'xuanhuan'
          ? '[ 武破天穹 · 直入江湖 ]'
          : tpl.buttonText;
        startBtn.onclick = () => startGuidedJourney(genre);

        const actions = document.createElement('div');
        actions.className = 'epic-cover-actions';
        actions.append(startBtn);

        empty.append(title, subtitle, tagline, workflow, actions);
      } else {
        const error = document.createElement('p');
        error.textContent = '无法加载设定模板...';
        empty.append(error);
      }

      els.messages.append(empty);
    } else {
      const fragment = document.createDocumentFragment();
      messages
        .filter((message) => !isJourneySetupMessage(message))
        .forEach((message) => fragment.append(createMessageNode(message)));
      els.messages.append(fragment);
      els.messages.scrollTop = els.messages.scrollHeight;
    }

    const count = messages.length;
    setStatus(els.sessionStatus, `${getCurrentSessionId()} · ${count} 条消息`, '');
  }

  return { renderMessages };
}

function isJourneySetupMessage(message) {
  if (message?.role !== 'user') return false;
  if (message.kind === 'journey-setup') return true;
  return /^\s*\[\s*命途设定\s*[：:]?/u.test(String(message.content || ''));
}
