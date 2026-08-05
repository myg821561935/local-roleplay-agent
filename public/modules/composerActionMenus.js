export function createComposerActionMenusController({
  root,
  documentObject = globalThis.document,
  windowObject = globalThis.window
} = {}) {
  let eventsBound = false;

  function getMenus() {
    return Array.from(root?.querySelectorAll?.('[data-composer-menu]') || []);
  }

  function closeMenus({ except = null, focusTrigger = false } = {}) {
    const openMenus = getMenus().filter((menu) => menu.open && menu !== except);
    openMenus.forEach((menu) => {
      menu.open = false;
      menu.removeAttribute?.('open');
    });
    if (focusTrigger) openMenus[0]?.querySelector?.('summary')?.focus?.();
    return openMenus.length;
  }

  function positionMenu(menu) {
    const panel = menu?.querySelector?.('.composer-menu-panel');
    const trigger = menu?.querySelector?.('summary');
    const triggerRect = trigger?.getBoundingClientRect?.();
    const viewportWidth = Number(windowObject?.innerWidth) || 0;
    const viewportHeight = Number(windowObject?.innerHeight) || 0;
    if (!panel || !triggerRect || !viewportWidth || !viewportHeight) return;

    const gutter = 12;
    panel.style.left = '0px';
    panel.style.right = 'auto';
    panel.style.bottom = '0px';
    panel.style.maxHeight = `${Math.round(Math.min(420, Math.max(120, triggerRect.top - 24)))}px`;
    const originRect = panel.getBoundingClientRect?.();
    if (!originRect) return;

    const panelWidth = Math.min(originRect.width || 342, Math.max(0, viewportWidth - gutter * 2));
    const maxLeft = Math.max(gutter, viewportWidth - panelWidth - gutter);
    const preferredLeft = triggerRect.right - panelWidth;
    const desiredLeft = Math.min(Math.max(gutter, preferredLeft), maxLeft);
    const desiredBottom = Math.max(gutter, viewportHeight - triggerRect.top + 9);
    const containingLeftOffset = originRect.left;
    const containingBottomOffset = viewportHeight - originRect.bottom;
    panel.style.left = `${Math.round(desiredLeft - containingLeftOffset)}px`;
    panel.style.bottom = `${Math.round(desiredBottom - containingBottomOffset)}px`;
  }

  function positionOpenMenus() {
    getMenus().filter((menu) => menu.open).forEach(positionMenu);
  }

  function bindEvents() {
    if (eventsBound || !root) return false;
    eventsBound = true;
    getMenus().forEach((menu) => {
      menu.addEventListener?.('toggle', () => {
        if (!menu.open) return;
        closeMenus({ except: menu });
        positionMenu(menu);
        windowObject?.requestAnimationFrame?.(() => positionMenu(menu));
      });
    });
    root.addEventListener?.('click', (event) => {
      if (event.target?.closest?.('button')) closeMenus();
    });
    root.addEventListener?.('keydown', (event) => {
      if (event.key !== 'Escape' || !getMenus().some((menu) => menu.open)) return;
      event.preventDefault();
      event.stopPropagation?.();
      closeMenus({ focusTrigger: true });
    });
    documentObject?.addEventListener?.('click', (event) => {
      if (event.target?.closest?.('.stage-actions')) return;
      closeMenus();
    });
    windowObject?.addEventListener?.('resize', positionOpenMenus);
    return true;
  }

  return { bindEvents, closeMenus, getMenus, positionMenu, positionOpenMenus };
}
