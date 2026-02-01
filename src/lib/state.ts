import { FileState, SyncState } from './types';
import { hashContent } from './hasher';

/**
 * State tracker manages local sync state
 */
export class StateTracker {
  private state: SyncState;
  private dirty = false;

  constructor(vaultPath: string) {
    this.state = {
      vaultPath,
      lastFullSync: null,
      files: {},
    };
  }

  /**
   * Load state from JSON string
   */
  load(json: string): void {
    try {
      const parsed = JSON.parse(json) as SyncState;
      if (parsed.vaultPath === this.state.vaultPath) {
        this.state = {
          ...parsed,
          lastFullSync: parsed.lastFullSync ? new Date(parsed.lastFullSync) : null,
          files: Object.fromEntries(
            Object.entries(parsed.files || {}).map(([path, state]) => [
              path,
              {
                ...state,
                lastSynced: new Date(state.lastSynced),
                lastModified: new Date(state.lastModified),
              },
            ])
          ),
        };
      }
    } catch (error) {
      console.warn('Failed to load state:', error);
    }
  }

  /**
   * Serialize state to JSON string
   */
  serialize(): string {
    return JSON.stringify(this.state, null, 2);
  }

  /**
   * Check if state needs to be saved
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Mark state as saved
   */
  markSaved(): void {
    this.dirty = false;
  }

  /**
   * Get file state for a specific path
   */
  getFileState(path: string): FileState | null {
    return this.state.files[path] || null;
  }

  /**
   * Set file state for a specific path
   */
  setFileState(path: string, state: FileState): void {
    this.state.files[path] = state;
    this.dirty = true;
  }

  /**
   * Remove file state for a path
   */
  removeFileState(path: string): void {
    delete this.state.files[path];
    this.dirty = true;
  }

  /**
   * Get all tracked file paths
   */
  getAllPaths(): string[] {
    return Object.keys(this.state.files);
  }

  /**
   * Set last full sync time
   */
  setLastFullSync(time: Date): void {
    this.state.lastFullSync = time;
    this.dirty = true;
  }

  /**
   * Get last full sync time
   */
  getLastFullSync(): Date | null {
    return this.state.lastFullSync;
  }

  /**
   * Check if a file needs to be synced based on hash comparison
   */
  needsSync(path: string, currentHash: string): boolean {
    const state = this.state.files[path];
    if (!state) return true;
    return state.hash !== currentHash;
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.state.files = {};
    this.state.lastFullSync = null;
    this.dirty = true;
  }

  /**
   * Get file count
   */
  fileCount(): number {
    return Object.keys(this.state.files).length;
  }
}
