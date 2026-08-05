const PRESENTATIONS = Object.freeze({
  native: {
    label: '原生内容包',
    tone: 'native',
    reason: '由项目内置并随当前版本共同发布。',
    canStartNewStory: true,
    action: 'none'
  },
  audited: {
    label: 'v2 已审核',
    tone: 'ok',
    reason: '组装记录符合当前酒馆兼容契约。',
    canStartNewStory: true,
    action: 'none'
  },
  'safe-derivative': {
    label: '安全派生已审核',
    tone: 'warning',
    reason: '源运行时含阻断能力，当前剧本只运行明确保留的安全能力。',
    canStartNewStory: true,
    action: 'none'
  },
  'upgrade-available': {
    label: '需要 v2 复审',
    tone: 'warning',
    reason: '历史包可以无损生成兼容新版。',
    canStartNewStory: false,
    action: 'upgrade'
  },
  'script-review-required': {
    label: '脚本待逐项审核',
    tone: 'review',
    reason: '必须查看第三方脚本源码，并按当前内容哈希逐项批准。',
    canStartNewStory: false,
    action: 'review-scripts'
  },
  blocked: {
    label: '无法自动复审',
    tone: 'error',
    reason: '原组装素材或基线缺失，需要人工重选素材。',
    canStartNewStory: false,
    action: 'inspect'
  },
  unavailable: {
    label: '兼容状态未知',
    tone: 'error',
    reason: '未取得当前兼容总览，新建故事已暂时阻断。',
    canStartNewStory: false,
    action: 'refresh'
  }
});

export function mergePackCompatibilityOverview(packs = [], overview = null) {
  const byId = new Map(
    (Array.isArray(overview?.packs) ? overview.packs : [])
      .map((item) => [String(item?.packId || ''), item])
      .filter(([id]) => id)
  );
  return (Array.isArray(packs) ? packs : []).map((pack) => {
    const status = pack?.custom === true
      ? byId.get(String(pack.id || '')) || { status: 'unavailable' }
      : { status: 'native' };
    return {
      ...pack,
      compatibilityAudit: normalizePackCompatibilityAudit(status)
    };
  });
}

export function normalizePackCompatibilityAudit(value = {}) {
  const status = PRESENTATIONS[value.status] ? value.status : 'unavailable';
  const defaults = PRESENTATIONS[status];
  return {
    ...defaults,
    ...value,
    status,
    label: String(value.label || defaults.label),
    tone: String(value.tone || defaults.tone),
    reason: String(value.reason || defaults.reason),
    canStartNewStory: value.canStartNewStory === undefined
      ? defaults.canStartNewStory
      : value.canStartNewStory === true,
    action: String(value.action || defaults.action),
    issues: Array.isArray(value.issues) ? value.issues.map(String) : []
  };
}

export function getPackCompatibilityAudit(pack = {}) {
  if (pack.custom !== true) return normalizePackCompatibilityAudit({ status: 'native' });
  return normalizePackCompatibilityAudit(pack.compatibilityAudit || { status: 'unavailable' });
}

export function isPackStartBlocked(pack = {}) {
  const dependencyBlocked = pack.compatibility?.compatible === false
    && Number(pack.compatibility?.blockingCount || 0) > 0;
  return dependencyBlocked || !getPackCompatibilityAudit(pack).canStartNewStory;
}

export function compatibilityActionLabel(audit = {}) {
  return {
    upgrade: '生成兼容新版',
    'review-scripts': '逐项审核脚本',
    inspect: '查看阻断原因',
    refresh: '刷新兼容状态'
  }[String(audit.action || '')] || '';
}

export function createPackCompatibilityManager({
  apiRequest = async () => ({}),
  onRefresh = async () => {},
  onOpenScriptReview = async () => false,
  confirmAction = (message) => globalThis.confirm?.(message) === true,
  humanizeError = (error) => error?.message || String(error)
} = {}) {
  let pendingPackId = '';

  async function act(pack, { reportStatus = () => {} } = {}) {
    const packId = String(pack?.id || '').trim();
    if (!packId || pendingPackId) return null;
    const audit = getPackCompatibilityAudit(pack);
    if (audit.action === 'none') {
      reportStatus(audit.reason, audit.tone);
      return { kind: 'already-audited', audit };
    }
    if (audit.action === 'refresh') {
      await onRefresh();
      reportStatus('兼容总览已刷新。', 'ok');
      return { kind: 'refreshed' };
    }
    if (audit.action === 'inspect' && audit.issues.length) {
      reportStatus(`无法自动复审：${audit.issues.join('；')}`, 'error');
      return { kind: 'blocked', audit };
    }

    pendingPackId = packId;
    reportStatus(`正在预检《${pack.title || packId}》...`, 'busy');
    try {
      const payload = await apiRequest(
        `/api/resource-library/packs/${encodeURIComponent(packId)}/compatibility-upgrade`
      );
      const preview = payload?.preview;
      if (!preview?.rebuildable) {
        const issues = (preview?.issues || []).map((item) => item.message || item.code).filter(Boolean);
        reportStatus(`无法自动复审：${issues.join('；') || '原组装素材或基线缺失'}。`, 'error');
        return { kind: 'blocked', preview };
      }
      if (preview.requiresScriptApproval) {
        const opened = await onOpenScriptReview(preview);
        reportStatus(
          opened === false
            ? '脚本必须在完整组装审核中逐项查看；本入口没有批量批准。'
            : '已打开完整组装审核；请逐项查看脚本源码与内容哈希。',
          'warning'
        );
        return { kind: 'script-review', preview };
      }
      const review = preview.compatibilityReview;
      if (!review?.fingerprint) {
        reportStatus('复审结果缺少当前组装指纹，未创建新剧本。', 'error');
        return { kind: 'invalid-preview', preview };
      }
      const disabled = Array.isArray(review.blockers) ? review.blockers : [];
      const changed = (preview.resourceRevisionChanges || []).filter((item) => item.changed).length;
      const fingerprintConfirmed = (preview.resourceRevisionChanges || [])
        .filter((item) => item.fingerprintConfirmed).length;
      const unknown = (preview.resourceRevisionChanges || []).filter((item) => item.revisionUnknown).length;
      const promptBundleMigration = preview.promptBundleMigration || {};
      const message = [
        `为《${preview.sourcePack?.title || pack.title || packId}》生成新的兼容复审版？`,
        disabled.length ? `明确禁用：${disabled.map((item) => item.label || item.id).join('、')}` : '',
        Number(promptBundleMigration.sourceResourceCount || 0)
          ? `${promptBundleMigration.sourceResourceCount} 个旧预设分片将折叠为 ${promptBundleMigration.targetBundleCount} 个预设包；内部顺序、启用状态与运行伴侣保持不变。`
          : '',
        changed ? `${changed} 份素材将固定到当前 revision。` : '',
        fingerprintConfirmed ? `${fingerprintConfirmed} 份历史素材已通过内容指纹确认未变化。` : '',
        unknown ? `${unknown} 份素材缺少历史 revision，将以当前本地版本重新固定。` : '',
        '旧剧本、项目、会话、正文和存档不会修改或迁移。'
      ].filter(Boolean).join('\n\n');
      if (!confirmAction(message)) return { kind: 'cancelled', preview };
      const result = await apiRequest(
        `/api/resource-library/packs/${encodeURIComponent(packId)}/compatibility-upgrade`,
        {
          method: 'POST',
          body: {
            compatibilityReview: {
              fingerprint: review.fingerprint,
              approvedScriptHashes: [],
              acknowledgeCompatibility: review.requiresCompatibilityAcknowledgement === true
            }
          }
        }
      );
      let refreshFailed = false;
      try {
        await onRefresh(result);
      } catch {
        refreshFailed = true;
      }
      reportStatus(
        `已生成《${result.pack?.title || '兼容复审版'}》；旧剧本和现有故事保持不变。${refreshFailed ? '列表刷新失败，请手动刷新。' : ''}`,
        refreshFailed ? 'warning' : 'ok'
      );
      return { kind: 'created', preview, result, refreshFailed };
    } catch (error) {
      reportStatus(`兼容复审失败：${humanizeError(error)}`, 'error');
      return null;
    } finally {
      pendingPackId = '';
    }
  }

  return { act };
}
