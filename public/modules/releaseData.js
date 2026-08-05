export function formatBackupTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '未知时间');
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function createReleaseDataController({
  els = {},
  apiRequest = async () => ({}),
  reloadAppState = async () => {},
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  confirmAction = () => true,
  documentObject = globalThis.document
} = {}) {
  let eventsBound = false;
  let operationPending = false;
  let backupsById = new Map();

  function getSelectedBackupId() {
    return String(els.backupSelect?.value || '');
  }

  function syncBackupActions() {
    const backupId = getSelectedBackupId();
    if (els.createBackup) els.createBackup.disabled = operationPending;
    if (els.restoreBackup) els.restoreBackup.disabled = operationPending || !backupId;
    if (els.downloadBackup) {
      els.downloadBackup.href = backupId
        ? `/api/backups/${encodeURIComponent(backupId)}/download`
        : '#';
      const disabled = operationPending || !backupId;
      els.downloadBackup.classList.toggle('is-disabled', disabled);
      els.downloadBackup.setAttribute('aria-disabled', String(disabled));
    }
  }

  function beginOperation() {
    if (operationPending) {
      setStatus(els.backupStatus, '上一项备份操作仍在处理中', 'busy');
      return false;
    }
    operationPending = true;
    syncBackupActions();
    return true;
  }

  function endOperation() {
    operationPending = false;
    syncBackupActions();
  }

  function renderBackupOptions(backups = []) {
    if (!els.backupSelect) return;
    const items = Array.isArray(backups) ? backups : [];
    backupsById = new Map(items.map((backup) => [backup.id, backup]));
    const current = els.backupSelect.value;
    els.backupSelect.innerHTML = '';
    if (!items.length) {
      const option = documentObject.createElement('option');
      option.value = '';
      option.textContent = '暂无备份';
      els.backupSelect.append(option);
      els.backupSelect.value = '';
    } else {
      items.forEach((backup) => {
        const option = documentObject.createElement('option');
        option.value = backup.id;
        const scopeLabel = backup.scope === 'selected' ? '范围备份' : '完整备份';
        option.textContent = `${formatBackupTime(backup.createdAt)} · ${scopeLabel} · ${formatBytes(backup.totalBytes)} · ${backup.reason || 'manual'}`;
        els.backupSelect.append(option);
      });
      els.backupSelect.value = items.some((backup) => backup.id === current)
        ? current
        : items[0].id;
    }
    syncBackupActions();
  }

  async function loadReleaseState() {
    try {
      const [health, backupPayload] = await Promise.all([
        apiRequest('/api/health'),
        apiRequest('/api/backups')
      ]);
      if (els.releaseVersion) {
        els.releaseVersion.textContent = `v${health.version || '-'} · 数据 v${health.dataSchemaVersion ?? '-'}`;
      }
      renderBackupOptions(backupPayload.backups || []);
      if (backupPayload.invalidCount) {
        setStatus(els.backupStatus, `发现 ${backupPayload.invalidCount} 个无效快照，已忽略`, 'error');
      }
      return { health, backups: backupPayload.backups || [] };
    } catch (error) {
      setStatus(els.backupStatus, `备份状态读取失败：${humanizeApiError(error)}`, 'error');
      return null;
    }
  }

  async function createBackup() {
    if (!beginOperation()) return null;
    setStatus(els.backupStatus, '正在校验并生成快照...', 'busy');
    try {
      const { backup } = await apiRequest('/api/backups', {
        method: 'POST',
        body: { reason: 'manual' }
      });
      setStatus(
        els.backupStatus,
        `备份完成：${backup.fileCount} 个文件，${formatBytes(backup.totalBytes)}`,
        'ok'
      );
      await loadReleaseState();
      if (els.backupSelect) els.backupSelect.value = backup.id;
      syncBackupActions();
      return backup;
    } catch (error) {
      setStatus(els.backupStatus, `备份失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      endOperation();
    }
  }

  async function restoreBackup() {
    const backupId = getSelectedBackupId();
    if (!backupId || !beginOperation()) return null;
    const selectedBackup = backupsById.get(backupId);
    const confirmed = confirmAction(selectedBackup?.scope === 'selected'
      ? '这是删除前生成的范围备份，只会还原其中列出的项目、剧本和会话文件。恢复前仍会为这些文件创建安全备份，是否继续？'
      : '恢复会覆盖当前全部本地数据。系统会先自动创建安全备份，请确认当前没有正在生成的对话。');
    if (!confirmed) {
      endOperation();
      return null;
    }

    setStatus(els.backupStatus, '正在创建安全备份并恢复...', 'busy');
    try {
      const result = await apiRequest(`/api/backups/${encodeURIComponent(backupId)}/restore`, {
        method: 'POST',
        body: {}
      });
      setStatus(els.backupStatus, `恢复完成；安全备份：${result.safetyBackup.id}`, 'ok');
      await reloadAppState();
      await loadReleaseState();
      return result;
    } catch (error) {
      setStatus(els.backupStatus, `恢复失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      endOperation();
    }
  }

  function handleDownloadClick(event) {
    if (els.downloadBackup?.classList.contains('is-disabled')) event.preventDefault();
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.createBackup?.addEventListener('click', () => { void createBackup(); });
    els.backupSelect?.addEventListener('change', syncBackupActions);
    els.restoreBackup?.addEventListener('click', () => { void restoreBackup(); });
    els.downloadBackup?.addEventListener('click', handleDownloadClick);
  }

  return {
    bindEvents,
    createBackup,
    getSelectedBackupId,
    isOperationPending: () => operationPending,
    loadReleaseState,
    renderBackupOptions,
    restoreBackup,
    syncBackupActions
  };
}
