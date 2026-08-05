const STATUS_LABELS = Object.freeze({
  healthy: '健康',
  warning: '需留意',
  blocked: '需处理',
  pass: '通过',
  error: '异常'
});

export function createSessionHealthController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getSessionId = () => state.session?.id || 'main',
  setStatus = () => {},
  humanizeError = (error) => error?.message || String(error),
  onOpenScriptAudit = () => {},
  onCompatibilityUpgradeCreated = () => {},
  confirmAction = (message) => globalThis.confirm?.(message) === true,
  documentObject = globalThis.document
} = {}) {
  let eventsBound = false;
  let repairPending = false;
  let migrationPending = false;
  let compatibilityUpgradePending = false;

  function render() {
    const report = state.sessionHealth;
    if (els.sessionHealthSummary) {
      els.sessionHealthSummary.replaceChildren(createSummary(report));
    }
    if (els.sessionHealthList) {
      els.sessionHealthList.replaceChildren(...createCheckCards(report?.checks));
    }
    renderReferenceRepair();
    renderSessionConfigMigration();
    return report;
  }

  async function refresh({
    announce = true,
    includeRepairPlan = true,
    includeConfigMigrationPlan = true
  } = {}) {
    const sessionId = encodeURIComponent(String(getSessionId() || 'main'));
    if (announce) setStatus(els.sessionHealthStatus, '正在检查当前会话...', 'busy');
    try {
      const payload = await apiRequest(`/api/sessions/${sessionId}/health`);
      state.sessionHealth = payload?.health || null;
      render();
      if (includeRepairPlan) await previewReferenceRepair({ announce: false });
      if (includeConfigMigrationPlan) await previewSessionConfigMigration({ announce: false });
      if (announce) setStatus(els.sessionHealthStatus, '会话健康检查已刷新', 'ok');
      return state.sessionHealth;
    } catch (error) {
      if (announce) setStatus(els.sessionHealthStatus, `检查失败：${humanizeError(error)}`, 'error');
      return null;
    }
  }

  async function previewSessionConfigMigration({ announce = true } = {}) {
    if (announce) setStatus(els.sessionHealthStatus, '正在扫描历史会话配置...', 'busy');
    try {
      const payload = await apiRequest('/api/session-config-migrations/incomplete');
      state.sessionConfigMigrationPlan = payload?.plan || null;
      renderSessionConfigMigration();
      if (announce) {
        const updates = Number(state.sessionConfigMigrationPlan?.summary?.sessionUpdates || 0);
        const manual = Number(state.sessionConfigMigrationPlan?.summary?.manualReviewSessions || 0);
        const message = updates
          ? `发现 ${updates} 个可安全迁移的历史会话`
          : manual
            ? `仍有 ${manual} 个会话需要人工补全`
            : '全部会话都已持有独立配置';
        setStatus(els.sessionHealthStatus, message, updates || manual ? 'warning' : 'ok');
      }
      return state.sessionConfigMigrationPlan;
    } catch (error) {
      if (announce) setStatus(els.sessionHealthStatus, `扫描失败：${humanizeError(error)}`, 'error');
      return null;
    }
  }

  async function migrateSessionConfigs() {
    const plan = state.sessionConfigMigrationPlan
      || await previewSessionConfigMigration({ announce: false });
    if (!plan?.requiresConfirmation) {
      const manual = Number(plan?.summary?.manualReviewSessions || 0);
      setStatus(
        els.sessionHealthStatus,
        manual ? `仍有 ${manual} 个会话需要人工补全` : '当前没有需要迁移的历史会话配置',
        manual ? 'warning' : 'ok'
      );
      return null;
    }
    const sessions = Number(plan.summary?.sessionUpdates || 0);
    const fields = Number(plan.summary?.fieldChanges || 0);
    if (!confirmAction(
      `迁移 ${sessions} 个历史会话的 ${fields} 个缺失配置字段？\n\n只会补充当前会话持有的空人设或空轻前端配置，不会复制系统默认剧本，也不会改写角色卡、世界书、Prompt、正文和记忆。执行前会创建本地安全备份。`
    )) return null;
    migrationPending = true;
    renderSessionConfigMigration();
    setStatus(els.sessionHealthStatus, '正在创建备份并迁移历史会话配置...', 'busy');
    try {
      const result = await apiRequest('/api/session-config-migrations/incomplete/migrate', {
        method: 'POST',
        body: {
          expectedPlanId: plan.planId,
          confirmMigration: true
        }
      });
      state.sessionConfigMigrationPlan = result.remainingPlan || null;
      await refresh({
        announce: false,
        includeRepairPlan: false,
        includeConfigMigrationPlan: false
      });
      renderSessionConfigMigration();
      const backupNote = result.backup?.id ? `；本地备份：${result.backup.id}` : '';
      setStatus(
        els.sessionHealthStatus,
        `已迁移 ${result.migratedSessionIds?.length || 0} 个历史会话${backupNote}`,
        'ok'
      );
      return result;
    } catch (error) {
      if (error?.code === 'SESSION_CONFIG_MIGRATION_PLAN_CHANGED') {
        await previewSessionConfigMigration({ announce: false });
        setStatus(els.sessionHealthStatus, '历史会话已发生变化，迁移计划已刷新，请重新确认。', 'warning');
      } else {
        setStatus(els.sessionHealthStatus, `迁移失败：${humanizeError(error)}`, 'error');
      }
      return null;
    } finally {
      migrationPending = false;
      renderSessionConfigMigration();
    }
  }

  async function previewReferenceRepair({ announce = true } = {}) {
    if (announce) setStatus(els.sessionHealthStatus, '正在扫描全部历史引用...', 'busy');
    try {
      const payload = await apiRequest('/api/reference-repairs/orphans');
      state.referenceRepairPlan = payload?.plan || null;
      renderReferenceRepair();
      if (announce) {
        const updates = countRepairTargets(state.referenceRepairPlan);
        setStatus(
          els.sessionHealthStatus,
          updates ? `发现 ${updates} 个需要治理的历史对象` : '未发现需要修复的孤儿引用',
          updates ? 'warning' : 'ok'
        );
      }
      return state.referenceRepairPlan;
    } catch (error) {
      if (announce) setStatus(els.sessionHealthStatus, `扫描失败：${humanizeError(error)}`, 'error');
      return null;
    }
  }

  async function repairReferences() {
    const plan = state.referenceRepairPlan || await previewReferenceRepair({ announce: false });
    if (!plan?.requiresConfirmation) {
      setStatus(els.sessionHealthStatus, '当前没有需要修复的孤儿引用', 'ok');
      return null;
    }
    const sessions = Number(plan.summary?.sessionUpdates || 0);
    const projects = Number(plan.summary?.projectUpdates || 0);
    const changes = Number(plan.summary?.referenceChanges || 0);
    if (!confirmAction(
      `修复 ${sessions} 个会话和 ${projects} 个故事中的 ${changes} 处失效引用？\n\n正文、角色卡、世界书、Prompt、消息和记忆内容不会删除。执行前会创建本地安全备份。`
    )) return null;
    repairPending = true;
    renderReferenceRepair();
    setStatus(els.sessionHealthStatus, '正在创建备份并修复历史引用...', 'busy');
    try {
      const result = await apiRequest('/api/reference-repairs/orphans/repair', {
        method: 'POST',
        body: {
          expectedPlanId: plan.planId,
          confirmRepair: true
        }
      });
      state.referenceRepairPlan = result.remainingPlan || null;
      await refresh({
        announce: false,
        includeRepairPlan: false,
        includeConfigMigrationPlan: false
      });
      renderReferenceRepair();
      const backupNote = result.backup?.id ? `；本地备份：${result.backup.id}` : '';
      setStatus(
        els.sessionHealthStatus,
        `已治理 ${result.repairedSessionIds?.length || 0} 个会话和 ${result.repairedProjectIds?.length || 0} 个故事${backupNote}`,
        'ok'
      );
      return result;
    } catch (error) {
      if (error?.code === 'REFERENCE_REPAIR_PLAN_CHANGED') {
        await previewReferenceRepair({ announce: false });
        setStatus(els.sessionHealthStatus, '历史数据已发生变化，修复计划已刷新，请重新确认。', 'warning');
      } else {
        setStatus(els.sessionHealthStatus, `修复失败：${humanizeError(error)}`, 'error');
      }
      return null;
    } finally {
      repairPending = false;
      renderReferenceRepair();
    }
  }

  function bindEvents() {
    if (eventsBound) return false;
    eventsBound = true;
    els.refreshSessionHealth?.addEventListener('click', () => refresh());
    els.previewReferenceRepair?.addEventListener('click', () => previewReferenceRepair());
    els.applyReferenceRepair?.addEventListener('click', () => repairReferences());
    els.previewSessionConfigMigration?.addEventListener('click', () => previewSessionConfigMigration());
    els.applySessionConfigMigration?.addEventListener('click', () => migrateSessionConfigs());
    els.sessionHealthList?.addEventListener('click', (event) => {
      const scriptButton = event.target?.closest?.('[data-health-action="open-script-audit"]');
      if (scriptButton) {
        const scriptIds = String(scriptButton.dataset.scriptIds || '').split(',').filter(Boolean);
        onOpenScriptAudit(scriptIds.map((id) => ({ id })));
        return;
      }
      const upgradeButton = event.target?.closest?.('[data-health-action="upgrade-compatibility-audit"]');
      if (upgradeButton) void upgradeCompatibilityAudit(upgradeButton.dataset.packId || '');
    });
    return true;
  }

  async function upgradeCompatibilityAudit(packId) {
    const safePackId = String(packId || '').trim();
    if (!safePackId || compatibilityUpgradePending) return null;
    compatibilityUpgradePending = true;
    setStatus(els.sessionHealthStatus, '正在重新预检旧素材包...', 'busy');
    try {
      const payload = await apiRequest(
        `/api/resource-library/packs/${encodeURIComponent(safePackId)}/compatibility-upgrade`
      );
      const preview = payload?.preview;
      if (!preview?.rebuildable) {
        const issues = (preview?.issues || []).map((item) => item.message || item.code).filter(Boolean);
        setStatus(
          els.sessionHealthStatus,
          `无法自动复审：${issues.join('；') || '原组装素材或基线已缺失'}。旧剧本未修改。`,
          'warning'
        );
        return preview || null;
      }
      const review = preview.compatibilityReview;
      if (!review?.fingerprint) {
        setStatus(els.sessionHealthStatus, '复审结果缺少当前内容指纹，未创建新剧本。', 'error');
        return preview;
      }
      if (preview.requiresScriptApproval) {
        setStatus(
          els.sessionHealthStatus,
          `复审发现 ${review.rules?.length || 0} 个第三方脚本；必须回到剧本组装审核逐条查看源码和哈希，本入口不会批量批准。`,
          'warning'
        );
        return preview;
      }
      const disabled = Array.isArray(review.blockers) ? review.blockers : [];
      const changedRevisions = (preview.resourceRevisionChanges || []).filter((item) => item.changed).length;
      const fingerprintConfirmed = (preview.resourceRevisionChanges || [])
        .filter((item) => item.fingerprintConfirmed).length;
      const unknownRevisions = (preview.resourceRevisionChanges || []).filter((item) => item.revisionUnknown).length;
      const confirmation = [
        '生成一份新的兼容复审版剧本？',
        '',
        `源剧本：${preview.sourcePack?.title || safePackId}`,
        disabled.length
          ? `将明确禁用：${disabled.map((item) => item.label || item.id).join('、')}`
          : '当前未发现需要禁用的源运行时能力。',
        changedRevisions ? `${changedRevisions} 份素材已更新，将使用当前本地 revision。` : '',
        fingerprintConfirmed ? `${fingerprintConfirmed} 份历史素材已通过内容指纹确认未变化。` : '',
        unknownRevisions ? `${unknownRevisions} 份素材缺少历史 revision 记录，将以当前本地版本重新固定。` : '',
        '',
        '旧剧本、项目、会话和正文不会修改或迁移。'
      ].filter((value, index, values) => value || values[index - 1] !== '').join('\n');
      if (!confirmAction(confirmation)) return preview;
      const result = await apiRequest(
        `/api/resource-library/packs/${encodeURIComponent(safePackId)}/compatibility-upgrade`,
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
        await onCompatibilityUpgradeCreated(result);
      } catch {
        refreshFailed = true;
      }
      setStatus(
        els.sessionHealthStatus,
        `已生成“${result.pack?.title || '兼容复审版'}”；当前会话仍使用旧剧本，可在剧本书架主动选择新版。${refreshFailed ? '素材库刷新失败，请手动刷新后查看。' : ''}`,
        refreshFailed ? 'warning' : 'ok'
      );
      return result;
    } catch (error) {
      const message = error?.code === 'RESOURCE_PACK_REVIEW_STALE'
        ? '素材在确认期间已变化，请重新执行兼容复审。'
        : `兼容复审失败：${humanizeError(error)}`;
      setStatus(els.sessionHealthStatus, message, 'error');
      return null;
    } finally {
      compatibilityUpgradePending = false;
    }
  }

  function renderSessionConfigMigration() {
    const plan = state.sessionConfigMigrationPlan;
    const updates = Number(plan?.summary?.sessionUpdates || 0);
    const manual = Number(plan?.summary?.manualReviewSessions || 0);
    if (els.sessionConfigMigrationSummary) {
      els.sessionConfigMigrationSummary.textContent = !plan
        ? '尚未扫描历史会话配置，不会自动修改数据。'
        : updates
          ? `已扫描 ${plan.summary?.sessionsScanned || 0} 个会话；可安全迁移 ${updates} 个会话的 ${plan.summary?.fieldChanges || 0} 个字段${manual ? `，另有 ${manual} 个需要人工补全` : ''}。`
          : manual
            ? `已扫描 ${plan.summary?.sessionsScanned || 0} 个会话；没有可自动迁移项，仍有 ${manual} 个需要人工补全。`
            : `已扫描 ${plan.summary?.sessionsScanned || 0} 个会话，全部会话都已持有独立配置。`;
      const card = els.sessionConfigMigrationSummary.closest?.('.reference-repair-card');
      card?.classList?.toggle('has-repairs', updates > 0 || manual > 0);
      card?.classList?.toggle('is-clean', Boolean(plan) && updates === 0 && manual === 0);
    }
    if (els.applySessionConfigMigration) {
      els.applySessionConfigMigration.disabled = migrationPending || !plan?.requiresConfirmation;
    }
    if (els.previewSessionConfigMigration) {
      els.previewSessionConfigMigration.disabled = migrationPending;
    }
  }

  function renderReferenceRepair() {
    const plan = state.referenceRepairPlan;
    const targetCount = countRepairTargets(plan);
    if (els.referenceRepairSummary) {
      els.referenceRepairSummary.textContent = !plan
        ? '尚未扫描历史引用，不会自动修改数据。'
        : targetCount
          ? `已扫描 ${plan.summary?.sessionsScanned || 0} 个会话、${plan.summary?.projectsScanned || 0} 个故事；将治理 ${plan.summary?.sessionUpdates || 0} 个会话、${plan.summary?.projectUpdates || 0} 个故事，共 ${plan.summary?.referenceChanges || 0} 处引用。`
          : `已扫描 ${plan.summary?.sessionsScanned || 0} 个会话、${plan.summary?.projectsScanned || 0} 个故事，未发现孤儿引用。`;
      const card = els.referenceRepairSummary.closest?.('.reference-repair-card');
      card?.classList?.toggle('has-repairs', targetCount > 0);
      card?.classList?.toggle('is-clean', Boolean(plan) && targetCount === 0);
    }
    if (els.applyReferenceRepair) {
      els.applyReferenceRepair.disabled = repairPending || !plan?.requiresConfirmation;
    }
    if (els.previewReferenceRepair) els.previewReferenceRepair.disabled = repairPending;
  }

  function createSummary(report) {
    const root = documentObject.createElement('div');
    root.className = `session-health-summary-card is-${report?.status || 'unknown'}`;
    const heading = documentObject.createElement('div');
    const title = documentObject.createElement('strong');
    const badge = documentObject.createElement('span');
    title.textContent = report ? '当前会话检查结果' : '尚未取得检查结果';
    badge.className = 'session-health-badge';
    badge.textContent = STATUS_LABELS[report?.status] || '未检查';
    heading.append(title, badge);
    const detail = documentObject.createElement('p');
    detail.textContent = report
      ? `${report.summary?.errors || 0} 项异常 · ${report.summary?.warnings || 0} 项提醒 · ${report.summary?.passes || 0} 项通过`
      : '刷新后会检查剧本绑定、Prompt、脚本审核、对话协议与 Swipe 分支。';
    root.append(heading, detail);
    return root;
  }

  function createCheckCards(checks) {
    const values = Array.isArray(checks) ? checks : [];
    if (!values.length) {
      const empty = documentObject.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = '暂无检查结果。';
      return [empty];
    }
    return values.map((item) => {
      const card = documentObject.createElement('article');
      card.className = `session-health-check is-${item.status || 'warning'}`;
      const heading = documentObject.createElement('div');
      const title = documentObject.createElement('strong');
      const badge = documentObject.createElement('span');
      title.textContent = `${item.category || '检查'} · ${item.title || ''}`;
      badge.className = 'session-health-check-status';
      badge.textContent = STATUS_LABELS[item.status] || '提醒';
      heading.append(title, badge);
      const detail = documentObject.createElement('p');
      detail.textContent = String(item.detail || '');
      card.append(heading, detail);
      if (item.recommendation) {
        const recommendation = documentObject.createElement('small');
        recommendation.textContent = `建议：${item.recommendation}`;
        card.append(recommendation);
      }
      if (Array.isArray(item.evidence) && item.evidence.length) {
        const details = documentObject.createElement('details');
        details.className = 'session-health-evidence';
        const summary = documentObject.createElement('summary');
        summary.textContent = `查看记录（${item.evidence.length}）`;
        const list = documentObject.createElement('ul');
        item.evidence.forEach((value) => {
          const row = documentObject.createElement('li');
          row.textContent = String(value || '');
          list.append(row);
        });
        details.append(summary, list);
        card.append(details);
      }
      if (item.action?.kind === 'open-script-audit') {
        const button = documentObject.createElement('button');
        button.type = 'button';
        button.className = 'ghost-button compact';
        button.dataset.healthAction = 'open-script-audit';
        button.dataset.scriptIds = (item.action.scriptIds || []).join(',');
        button.textContent = '查看脚本审核';
        card.append(button);
      }
      if (item.action?.kind === 'upgrade-compatibility-audit' && item.action.packId) {
        const button = documentObject.createElement('button');
        button.type = 'button';
        button.className = 'ghost-button compact';
        button.dataset.healthAction = 'upgrade-compatibility-audit';
        button.dataset.packId = String(item.action.packId);
        button.textContent = '重新预检并生成新版';
        card.append(button);
      }
      return card;
    });
  }

  return {
    bindEvents,
    migrateSessionConfigs,
    previewReferenceRepair,
    previewSessionConfigMigration,
    refresh,
    render,
    repairReferences,
    upgradeCompatibilityAudit
  };
}

function countRepairTargets(plan) {
  return Number(plan?.summary?.sessionUpdates || 0) + Number(plan?.summary?.projectUpdates || 0);
}
