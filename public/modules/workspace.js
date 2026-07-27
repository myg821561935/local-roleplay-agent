export const WORK_MODES = {
  creative: { label: '创作', panelTitle: '检查器', defaultTab: 'status', activeView: 'chat' },
  immersive: { label: '沉浸', panelTitle: '检查器', defaultTab: 'status', activeView: 'chat' },
  settings: { label: '设定', panelTitle: '内容设定', defaultTab: 'worldbook', activeView: 'inspector' },
  debug: { label: '调试', panelTitle: '运行调试', defaultTab: 'memory', activeView: 'inspector' }
};

export function createWorkspaceController({
  els,
  activateTab
}) {
  function scrollInspectorIntoViewOnNarrowScreens() {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    document.querySelector('.inspector-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function isNarrowWorkspace() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function workspacePanelConfig(panelName) {
    if (panelName === 'provider') {
      return {
        panel: els.providerPanel,
        openButton: els.openProviderPanel,
        closeButton: els.toggleProviderPanel,
        view: 'provider'
      };
    }
    if (panelName === 'inspector') {
      return {
        panel: els.inspectorPanel,
        openButton: els.openInspectorPanel,
        closeButton: els.toggleInspectorPanel,
        view: 'inspector'
      };
    }
    return null;
  }

  function syncWorkspacePanelControls(panelName) {
    const config = workspacePanelConfig(panelName);
    if (!config?.panel) return;

    const expanded = !config.panel.classList.contains('collapsed');
    config.panel.dataset.expanded = String(expanded);
    config.openButton?.setAttribute('aria-expanded', String(expanded));
    config.closeButton?.setAttribute('aria-expanded', String(expanded));
  }

  function syncMobileNavForView(view, mode = els.workspace?.dataset.workMode || 'creative') {
    const mobileNavButtons = Array.from(document.querySelectorAll('[data-mobile-view]'));
    mobileNavButtons.forEach((button) => {
      const viewMatches = button.dataset.mobileView === view;
      const modeMatches = !button.dataset.mobileMode || button.dataset.mobileMode === mode;
      button.classList.toggle('active', viewMatches && modeMatches);
    });
  }

  function setWorkspaceActiveView(view) {
    const safeView = ['provider', 'chat', 'inspector'].includes(view) ? view : 'chat';
    if (els.workspace) els.workspace.dataset.activeView = safeView;
    syncMobileNavForView(safeView);
  }

  function setWorkspacePanelExpanded(panelName, expanded, options = {}) {
    const config = workspacePanelConfig(panelName);
    if (!config?.panel) return;

    config.panel.classList.toggle('collapsed', !expanded);
    syncWorkspacePanelControls(panelName);

    if (isNarrowWorkspace() || options.syncActiveView) {
      if (expanded) {
        const otherPanelName = panelName === 'provider' ? 'inspector' : 'provider';
        const otherConfig = workspacePanelConfig(otherPanelName);
        otherConfig?.panel?.classList.add('collapsed');
        syncWorkspacePanelControls(otherPanelName);
        setWorkspaceActiveView(config.view);
      } else if (els.workspace?.dataset.activeView === config.view) {
        setWorkspaceActiveView('chat');
      }
    }
  }

  function loadWorkMode() {
    try {
      const saved = localStorage.getItem('local-roleplay-agent-work-mode');
      return WORK_MODES[saved] ? saved : 'creative';
    } catch {
      return 'creative';
    }
  }

  function syncMobileNavForWorkMode(mode) {
    syncMobileNavForView(els.workspace?.dataset.activeView || WORK_MODES[mode]?.activeView || 'chat', mode);
  }

  function activateWorkMode(mode, options = {}) {
    const safeMode = WORK_MODES[mode] ? mode : 'creative';
    const config = WORK_MODES[safeMode];
    document.documentElement.dataset.workMode = safeMode;
    if (els.workspace) {
      els.workspace.dataset.workMode = safeMode;
      els.workspace.dataset.activeView = config.activeView;
    }

    els.workModeButtons.forEach((button) => {
      const active = button.dataset.workMode === safeMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (els.inspectorPanelTitle) els.inspectorPanelTitle.textContent = config.panelTitle;

    if (safeMode === 'creative' || safeMode === 'immersive') {
      setWorkspacePanelExpanded('provider', false);
      setWorkspacePanelExpanded('inspector', false);
      setWorkspaceActiveView('chat');
    } else {
      setWorkspacePanelExpanded('provider', false);
      setWorkspacePanelExpanded('inspector', true);
      setWorkspaceActiveView('inspector');
    }

    if (options.activateDefaultTab !== false) activateTab(config.defaultTab);
    if (options.syncMobileNav !== false) syncMobileNavForWorkMode(safeMode);
    if (options.persist !== false) {
      try {
        localStorage.setItem('local-roleplay-agent-work-mode', safeMode);
      } catch {
        // The mode still applies for the current page when storage is unavailable.
      }
    }
  }

  function openProviderSettings(sectionId = '') {
    activateWorkMode('creative', { activateDefaultTab: false });
    setWorkspacePanelExpanded('provider', true, { syncActiveView: true });
    const section = sectionId ? document.getElementById(sectionId) : null;
    if (section instanceof HTMLDetailsElement) section.open = true;
    requestAnimationFrame(() => {
      (section || els.providerPanel)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const focusTarget = section?.querySelector('input, select, button') || els.providerPreset;
      focusTarget?.focus({ preventScroll: true });
    });
  }

  return {
    activateWorkMode,
    loadWorkMode,
    openProviderSettings,
    scrollInspectorIntoViewOnNarrowScreens,
    setWorkspaceActiveView,
    setWorkspacePanelExpanded,
    syncMobileNavForWorkMode,
    syncMobileNavForView,
    syncWorkspacePanelControls
  };
}
