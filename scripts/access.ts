import { randomBytes } from 'node:crypto';
import { config } from '../server/config.js';
import { loadAccessCredential, saveAccessPassword } from '../server/access-password.js';

const [action, ...extra] = process.argv.slice(2);
try {
  if (!['init', 'reset', 'status'].includes(action) || extra.length) throw new Error('用法：npm run access -- init | reset | status；init/reset 前先停止服务，PICODING_DATA_DIR 决定数据目录');
  if (action === 'status') {
    const source = config.password ? 'environment' : await loadAccessCredential(config.dataDir) ? 'file' : 'none';
    console.log(JSON.stringify({ loginEnabled: source !== 'none', source }));
  } else {
    if (config.password) throw new Error('当前使用 PICODING_ACCESS_PASSWORD；请修改该环境变量并重启，或移除它后使用密码管理工具');
    const password = randomBytes(24).toString('base64url');
    await saveAccessPassword(config.dataDir, password, action === 'reset');
    console.log(`访问密码已${action === 'reset' ? '重置' : '初始化'}。启动或重启服务后生效。`);
    console.log(`访问密码：${password}`);
    console.log('请保存到密码管理器；后端只存储密码哈希，不保存明文。');
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
