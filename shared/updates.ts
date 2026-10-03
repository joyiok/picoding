export interface AppVersion { version: string; commit: string | null; dirty: boolean; }
export interface UpdateRelease { commit: string; title: string; date: string; url: string; }
export type UpdatePhase = 'queued' | 'preparing' | 'backing-up' | 'restarting' | 'rolling-back' | 'succeeded' | 'failed';
export interface UpdateJob {
  id: string; commit: string; phase: UpdatePhase; message: string;
  startedAt: string; updatedAt: string;
}
export interface UpdateStatus {
  current: AppVersion; latest?: UpdateRelease; available: boolean;
  enabled: boolean; disabledReason?: string; checkedAt?: string; job?: UpdateJob;
}
export const updateActive = (job?: UpdateJob) => Boolean(job && !['succeeded', 'failed'].includes(job.phase));
