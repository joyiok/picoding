import type { UpdateJob, UpdatePhase } from '../shared/updates.js';

export interface UpdateOperations {
  prepare(): Promise<void>;
  stop(): Promise<void>;
  backup(): Promise<void>;
  activate(): Promise<void>;
  start(): Promise<void>;
  healthy(): Promise<void>;
  rollback(): Promise<void>;
}
// Keep the old service running throughout download/build; stop only after a usable release exists.
export async function runUpdate(job: UpdateJob, operations: UpdateOperations, save: (job: UpdateJob) => Promise<void>) {
  let stopped = false, activated = false;
  const report = async (phase: UpdatePhase, message: string) => { job = { ...job, phase, message, updatedAt: new Date().toISOString() }; await save(job); };
  try {
    await report('preparing', '正在下载代码、安装依赖并构建任务环境');
    await operations.prepare();
    await report('backing-up', '正在停止任务环境并完整备份配置、对话和项目');
    stopped = true; await operations.stop(); await operations.backup();
    await report('restarting', '正在启动新版本并检查服务');
    activated = true; await operations.activate(); await operations.start(); await operations.healthy();
    await report('succeeded', '更新完成，请重新登录；任务环境可在任务中重新启动');
    return job;
  } catch (error) {
    const reason = error instanceof Error ? error.message : '更新失败';
    if (stopped) {
      try {
        await report('rolling-back', '更新失败，正在恢复原程序和任务镜像');
        await operations.stop();
        if (activated) await operations.rollback();
        await operations.start(); await operations.healthy();
      } catch { await report('failed', '更新失败且原服务未能恢复，请联系服务器管理员查看更新日志与备份'); return job; }
    }
    await report('failed', `${reason}。${stopped ? '原程序已恢复，请按服务器日志检查备份。' : '原程序仍在运行。'}`);
    return job;
  }
}
