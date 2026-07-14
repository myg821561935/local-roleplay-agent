import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackupService } from '../server/services/backupService.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const service = new BackupService({ rootDir });
const [command = 'list', backupId, confirmation] = process.argv.slice(2);

if (command === 'backup') {
  const backup = await service.createBackup({ reason: 'cli' });
  console.log(`备份完成：${backup.id}，${backup.fileCount} 个文件，${backup.totalBytes} bytes`);
} else if (command === 'list') {
  const { backups, invalidCount } = await service.listBackups();
  if (!backups.length) console.log('暂无备份。');
  for (const backup of backups) {
    console.log(`${backup.id}\t${backup.createdAt}\t${backup.totalBytes} bytes\t${backup.reason}`);
  }
  if (invalidCount) console.log(`已忽略 ${invalidCount} 个无效备份。`);
} else if (command === 'restore') {
  if (!backupId || confirmation !== '--yes') {
    console.error('恢复需要明确确认：npm run restore -- <backup-id> --yes');
    process.exitCode = 2;
  } else {
    const result = await service.restoreBackup(backupId);
    console.log(`恢复完成：${result.restored.id}`);
    console.log(`安全备份：${result.safetyBackup.id}`);
    console.log('请重启本地角色扮演 Agent。');
  }
} else {
  console.error(`未知命令：${command}`);
  process.exitCode = 2;
}
