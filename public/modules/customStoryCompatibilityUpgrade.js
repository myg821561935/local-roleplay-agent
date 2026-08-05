export async function runCompatibilityUpgradeReview(preview = {}, {
  state,
  createDraft,
  originalBasePackId,
  invalidateInspection,
  persistDraft,
  openDialog,
  cancelInspection,
  buildPackRequest,
  renderBuilder,
  setStep,
  reportStatus
} = {}) {
  const input = preview.assemblyInput;
  if (preview.rebuildable !== true || !input || !preview.compatibilityReview?.fingerprint) return false;
  const title = `${preview.sourcePack?.title || '历史自定义剧本'} · 兼容复审版`;
  state.customStoryDraft = createDraft({
    ...input,
    basePackId: input.basePackId || originalBasePackId,
    title,
    titleCustomized: true,
    promptSelectionConfirmed: true,
    compatibilityReview: {}
  });
  invalidateInspection();
  persistDraft();
  await openDialog({ step: 'review', resetStatus: false });
  cancelInspection();
  const request = buildPackRequest({ title, includeCompatibilityReview: false });
  state.customStoryComposition = {
    key: JSON.stringify(request),
    status: 'ready',
    report: preview.composition,
    error: ''
  };
  state.customStoryCompatibilityUpgrade = {
    sourcePackId: String(preview.sourcePack?.id || ''),
    assemblySignature: createCompatibilityUpgradeAssemblySignature(request)
  };
  renderBuilder();
  setStep('review');
  const migration = preview.promptBundleMigration || {};
  reportStatus(
    [
      '这是历史剧本的兼容复审。请逐项查看第三方脚本；完成后会生成新剧本，旧剧本与已有故事不会迁移。',
      Number(migration.sourceResourceCount || 0)
        ? `${migration.sourceResourceCount} 个旧预设分片会折叠为 ${migration.targetBundleCount} 个预设包，内部模块顺序和启用状态保持不变。`
        : ''
    ].filter(Boolean).join(' '),
    'warning'
  );
  return true;
}

export function createCompatibilityUpgradeAssemblySignature(request = {}) {
  const {
    title: _title,
    sessionTitle: _sessionTitle,
    description: _description,
    compatibilityReview: _compatibilityReview,
    ...assembly
  } = request;
  return JSON.stringify(assembly);
}
