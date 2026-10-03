const storageKey = 'picoding.workspace-drafts.v1';
const newTaskKey = 'new';
const taskIdPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

interface DraftState { activeId?: string; drafts: Readonly<Record<string, string>>; }
export interface DraftSubmission { taskId?: string; text: string; version: number; navigation: number; }
type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function browserDraftStorage(): DraftStorage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}

export class WorkspaceDrafts {
  private state: DraftState = { drafts: {} };
  private listeners = new Set<() => void>();
  private versions = new Map<string, number>();
  private navigation = 0;
  private restored = false;
  private persisted: boolean;

  constructor(private readonly storage?: DraftStorage) {
    this.persisted = Boolean(storage);
    try {
      const value = storage?.getItem(storageKey);
      if (!value) return;
      const saved = JSON.parse(value);
      if (saved?.version !== 1 || !saved.drafts || typeof saved.drafts !== 'object' || Array.isArray(saved.drafts)) return;
      const drafts: Record<string, string> = {};
      for (const [key, text] of Object.entries(saved.drafts)) {
        if ((key === newTaskKey || taskIdPattern.test(key)) && typeof text === 'string' && text.length <= 50_000) drafts[key] = text;
      }
      this.state = { drafts, ...(typeof saved.activeId === 'string' && taskIdPattern.test(saved.activeId) ? { activeId: saved.activeId } : {}) };
    } catch { this.persisted = false; }
  }

  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get hasUnpersistedDrafts() { return !this.persisted && Object.values(this.state.drafts).some(text => Boolean(text.trim())); }

  private publish(state: DraftState) {
    this.state = state;
    try {
      if (!this.storage) throw new Error('Draft storage unavailable');
      this.storage.setItem(storageKey, JSON.stringify({ version: 1, ...state })); this.persisted = true;
    } catch { this.persisted = false; }
    for (const listener of this.listeners) listener();
  }

  selectTask(activeId?: string) {
    this.navigation++;
    this.publish({ ...this.state, activeId });
  }

  restoreAvailableTasks(ids: string[]) {
    if (this.restored) return;
    this.restored = true;
    // A late initial task list must not override navigation already performed.
    if (!this.navigation && this.state.activeId && !ids.includes(this.state.activeId)) this.selectTask();
  }

  setDraft(text: string) {
    const key = this.state.activeId || newTaskKey;
    if ((this.state.drafts[key] || '') === text) return;
    const drafts = { ...this.state.drafts };
    if (text) drafts[key] = text; else delete drafts[key];
    this.versions.set(key, (this.versions.get(key) || 0) + 1);
    this.publish({ ...this.state, drafts });
  }

  submission(): DraftSubmission {
    const taskId = this.state.activeId, key = taskId || newTaskKey;
    return { taskId, text: this.state.drafts[key] || '', version: this.versions.get(key) || 0, navigation: this.navigation };
  }

  completeSubmission(submission: DraftSubmission, createdId?: string) {
    const key = submission.taskId || newTaskKey;
    const drafts = { ...this.state.drafts };
    if ((this.versions.get(key) || 0) === submission.version) {
      delete drafts[key]; this.versions.set(key, submission.version + 1);
    }
    let activeId = this.state.activeId;
    if (createdId && !activeId && this.navigation === submission.navigation) {
      // Continued typing during creation belongs to the new task only while the
      // user remains in the original composer. Other task drafts stay untouched.
      if (drafts[newTaskKey]) drafts[createdId] = drafts[newTaskKey];
      delete drafts[newTaskKey]; activeId = createdId; this.navigation++;
      this.versions.set(newTaskKey, (this.versions.get(newTaskKey) || 0) + 1);
    }
    this.publish({ activeId, drafts });
  }

  removeTask(id: string) {
    const drafts = { ...this.state.drafts }; delete drafts[id]; this.versions.delete(id);
    const activeId = this.state.activeId === id ? undefined : this.state.activeId;
    if (activeId !== this.state.activeId) this.navigation++;
    this.publish({ activeId, drafts });
  }
}
