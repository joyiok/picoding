import { config } from '../server/config.js';
import { backupWorkspace, restoreWorkspace } from '../server/backup.js';

const [action, path, ...extra] = process.argv.slice(2);
try {
  if (!['create', 'restore'].includes(action) || !path || extra.length) throw new Error('用法：npm run backup -- create <新备份目录> 或 npm run backup -- restore <备份目录>；先停止工作台，PICODING_DATA_DIR 决定数据目录');
  const result = action === 'create' ? await backupWorkspace(config.dataDir, path) : await restoreWorkspace(config.dataDir, path);
  console.log(JSON.stringify({ operation: action, ...result }));
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
