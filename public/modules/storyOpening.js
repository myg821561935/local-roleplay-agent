export function createStoryOpeningController({
  state,
  els,
  renderStoryContinuePanel,
  renderStoryProjects,
  renderStoryImportBaseOptions,
  renderCustomStoryBuilder,
  renderStoryCatalogFilters,
  renderStoryPackGrid,
  getAppliedContentPackId,
  getMostRecentSessionSummary,
  setStoryLauncherBackground
} = {}) {
  function renderStoryLauncher() {
    if (!els.storyLauncher) return;
    renderStoryContinuePanel();
    renderStoryProjects();
    renderStoryImportBaseOptions();
    renderCustomStoryBuilder();
    renderStoryCatalogFilters();
    renderStoryPackGrid();
  }

  function openStoryLauncher(options = {}) {
    if (!els.storyLauncher) return;
    renderStoryLauncher();
    const packId = getAppliedContentPackId()
      || getMostRecentSessionSummary()?.packId
      || state.contentPacks?.[0]?.id
      || 'xuanhuan';
    setStoryLauncherBackground(packId);
    els.storyLauncher.classList.remove('is-hidden');
    els.storyLauncher.setAttribute('aria-hidden', 'false');
    document.body.classList.add('story-launcher-open');
    if (options.focusSearch !== false) {
      window.setTimeout(() => els.storyPackSearch?.focus(), 0);
    }
  }

  function closeStoryLauncher() {
    if (!els.storyLauncher) return;
    if (els.storyCustomDialog?.open) els.storyCustomDialog.close();
    els.storyLauncher.classList.add('is-hidden');
    els.storyLauncher.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('story-launcher-open');
  }

  function initializeStoryLauncherVisibility() {
    if (state.storyLauncherInitialized) return;
    state.storyLauncherInitialized = true;
    const messages = Array.isArray(state.session?.messages) ? state.session.messages : [];
    if (!state.session?.storyProjectId && messages.length === 0) {
      openStoryLauncher({ focusSearch: false });
    }
  }

  return {
    closeStoryLauncher,
    initializeStoryLauncherVisibility,
    openStoryLauncher,
    renderStoryLauncher
  };
}
