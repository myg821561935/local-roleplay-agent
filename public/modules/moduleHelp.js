export const MODULE_HELP = Object.freeze({
  contentPack: {
    title: '题材内容包',
    body: '选择故事题材会预览对应舞台背景；点击“应用到会话”后，才会同步世界书、角色卡、Prompt 和规则系统。阅读模式是全局偏好，不随剧本切换。'
  },
  memory: {
    title: '记忆',
    body: '查看滚动摘要、短期记忆和世界状态。适合确认自动总结有没有抓住关键事实。'
  },
  status: {
    title: '状态',
    body: '展示当前规则系统、世界时钟、NPC 日程与事件账本。幕后视图用于创作审阅，公开视图只显示角色可见信息。'
  },
  facts: {
    title: '事实',
    body: '管理后台抽取出的动态事实。可以审阅、删改，再决定是否保留进长期上下文。'
  },
  usage: {
    title: '用量',
    body: '查看本轮和累计 token 消耗，帮助判断是否需要摘要、裁剪或切换便宜模型。'
  },
  worldbook: {
    title: '世界书',
    body: '存放地点、势力、功法、禁忌、历史和规则。条目会按关键词、正则和深度插入到上下文。'
  },
  character: {
    title: '角色卡',
    body: '编辑主角、NPC 或群聊成员。角色卡决定口吻、身份、动机、开局与创作边界。'
  },
  authoring: {
    title: '创作账本',
    body: '记录当前场景目标、必须揭示或隐藏的信息、伏笔承诺和创作决策，避免长篇推进时静默遗忘。'
  },
  sources: {
    title: '资源库',
    body: '统一管理本地角色卡、世界书与 Prompt，也可从社区来源采集素材，再在剧本工坊中组装为会话可用的自定义剧本。'
  },
  prompt: {
    title: 'Prompt',
    body: '管理系统提示、风格约束和输出格式。建议只放稳定规则，把临时要求放到作者注释。'
  },
  persona: {
    title: '人设',
    body: '配置用户/主角侧画像。它会影响叙事视角和互动关系，但不应覆盖角色卡核心设定。'
  },
  quickreplies: {
    title: '快捷',
    body: '保存常用行动指令或分支选择。适合放“继续推进”“查看状态”“快进时间”等高频操作。'
  },
  macro: {
    title: '宏',
    body: '把可复用文本片段做成变量模板，适合统一状态栏、战斗结算或章节开头。'
  },
  continue: {
    title: '继续',
    body: '让模型沿着上一轮自然推进。适合你没有新动作、只想让剧情继续流动时使用。'
  },
  rewrite: {
    title: '润色',
    body: '把输入框里的指令改写得更清楚、更像创作提示；不会直接发送。'
  },
  format: {
    title: '修复格式',
    body: '要求模型修正上一轮格式问题，尽量保持剧情不倒退。适合状态栏、选项栏乱掉时使用。'
  },
  targetSpeaker: {
    title: '指定发言',
    body: '在群聊或多角色场景中指定下一位说话者，避免模型随意切换视角。'
  },
  authorNote: {
    title: '作者注释',
    body: '临时追加本回合写作指令，例如天气、节奏、禁用桥段或需要突出某个伏笔。'
  },
  background: {
    title: '舞台背景',
    body: '切换会话舞台图，只影响沉浸感，不覆盖会话内容和题材规则。'
  },
  scrollBottom: {
    title: '回到底部',
    body: '快速回到最新回复。长文、多轮分支和状态卡较多时很有用。'
  },
  startJourney: {
    title: '封存卷轴',
    body: '将当前题材、主角、天命和世界书整理成第一轮开局稿，方便你检查后再发送。'
  }
});

const HELP_TRIGGER_SELECTOR = [
  '[data-help-key]',
  '[data-tab]',
  '[data-tab-shortcut]',
  '[data-action-template]',
  '[data-scroll-bottom]'
].join(',');

export function resolveModuleHelpKey(trigger) {
  if (!trigger) return '';
  if (trigger.dataset.helpKey) return trigger.dataset.helpKey;
  if (trigger.dataset.tab) return trigger.dataset.tab;
  if (trigger.dataset.tabShortcut) return trigger.dataset.tabShortcut;
  if (trigger.dataset.scrollBottom !== undefined) return 'scrollBottom';
  if (trigger.dataset.actionTemplate) return 'format';
  return '';
}

export function createModuleHelpController({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  requestFrame,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  autoCloseMs = 5200
} = {}) {
  let eventsBound = false;
  let moduleHintTimer = null;
  let renderVersion = 0;
  const scheduleFrame = requestFrame
    || windowObject?.requestAnimationFrame?.bind(windowObject)
    || ((callback) => callback());

  function closeModuleHint() {
    renderVersion += 1;
    if (moduleHintTimer !== null) {
      clearTimer(moduleHintTimer);
      moduleHintTimer = null;
    }
    documentObject?.querySelector?.('.module-hint-popover')?.remove();
  }

  function showModuleHint(helpKey, anchor) {
    const help = MODULE_HELP[helpKey];
    if (!help || !anchor || !documentObject?.body) return null;

    closeModuleHint();
    const version = renderVersion;
    const popover = documentObject.createElement('aside');
    popover.className = 'module-hint-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'false');
    popover.setAttribute('aria-live', 'polite');
    popover.dataset.helpKey = helpKey;

    const title = documentObject.createElement('div');
    title.className = 'module-hint-title';
    title.id = `module-hint-title-${version}`;
    title.textContent = help.title;
    popover.setAttribute('aria-labelledby', title.id);

    const body = documentObject.createElement('p');
    body.textContent = help.body;

    const close = documentObject.createElement('button');
    close.type = 'button';
    close.className = 'module-hint-close';
    close.dataset.moduleHintClose = 'true';
    close.setAttribute('aria-label', '关闭提示');
    close.textContent = '×';

    popover.append(close, title, body);
    documentObject.body.append(popover);

    const anchorRect = anchor.getBoundingClientRect();
    scheduleFrame(() => {
      if (version !== renderVersion || popover.isConnected === false) return;
      const popoverRect = popover.getBoundingClientRect();
      const gutter = 12;
      const viewportWidth = Number(windowObject?.innerWidth) || 0;
      const viewportHeight = Number(windowObject?.innerHeight) || 0;
      const maxLeft = Math.max(gutter, viewportWidth - popoverRect.width - gutter);
      let left = Math.min(Math.max(gutter, anchorRect.left), maxLeft);
      let top = anchorRect.bottom + 8;
      if (top + popoverRect.height > viewportHeight - gutter) {
        top = anchorRect.top - popoverRect.height - 8;
      }
      if (top < gutter) {
        top = gutter;
        left = Math.min(Math.max(gutter, anchorRect.right + 8), maxLeft);
      }
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.classList.add('visible');
    });

    moduleHintTimer = setTimer(() => {
      if (version === renderVersion) closeModuleHint();
    }, autoCloseMs);
    return popover;
  }

  function handleModuleHelpClick(event) {
    const target = event?.target;
    if (!target?.closest) return;
    if (target.closest('[data-module-hint-close]')) {
      closeModuleHint();
      return;
    }
    if (target.closest('.module-hint-popover')) return;

    const trigger = target.closest(HELP_TRIGGER_SELECTOR);
    const helpKey = resolveModuleHelpKey(trigger);
    if (helpKey && MODULE_HELP[helpKey]) {
      showModuleHint(helpKey, trigger);
    } else {
      closeModuleHint();
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    documentObject?.addEventListener?.('click', handleModuleHelpClick);
  }

  return {
    bindEvents,
    closeModuleHint,
    handleModuleHelpClick,
    showModuleHint
  };
}
