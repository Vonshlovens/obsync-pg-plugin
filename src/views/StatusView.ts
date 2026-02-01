import { ItemView, WorkspaceLeaf } from 'obsidian';
import StatusViewComponent from '../components/StatusView.svelte';
import type { SyncStatus } from '../lib/types';
import type ObsyncPgPlugin from '../main';

export const VIEW_TYPE_OBSYNC_STATUS = 'obsync-pg-status';

export class ObsyncStatusView extends ItemView {
  private plugin: ObsyncPgPlugin;
  private component: StatusViewComponent | null = null;
  private status: SyncStatus = {
    connected: false,
    lastSyncTime: null,
    totalNotes: 0,
    totalAttachments: 0,
    pendingChanges: 0,
  };

  constructor(leaf: WorkspaceLeaf, plugin: ObsyncPgPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_OBSYNC_STATUS;
  }

  getDisplayText(): string {
    return 'Obsync PG Status';
  }

  getIcon(): string {
    return 'database';
  }

  async onOpen(): Promise<void> {
    this.component = new StatusViewComponent({
      target: this.contentEl,
      props: {
        status: this.status,
        onSync: () => this.plugin.syncNow(),
        onPull: () => this.plugin.pullFromDB(),
        onMigrate: () => this.plugin.runMigrations(),
      },
    });

    // Register for status updates
    this.plugin.onStatusChange((status) => {
      this.status = status;
      this.updateView();
    });

    // Initial status fetch
    await this.plugin.refreshStatus();
  }

  async onClose(): Promise<void> {
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }
  }

  private updateView(): void {
    if (this.component) {
      this.component.$set({ status: this.status });
    }
  }
}
