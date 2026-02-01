import { Plugin, Notice, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { Database } from './lib/database';
import { SyncEngine } from './lib/sync-engine';
import { PluginSettings, DEFAULT_SETTINGS, SyncStatus } from './lib/types';
import { ObsyncSettingTab } from './settings';
import { ObsyncStatusView, VIEW_TYPE_OBSYNC_STATUS } from './views/StatusView';

// Polyfill for minimatch in browser environment
import { minimatch } from 'minimatch';
(window as any).minimatch = minimatch;

export default class ObsyncPgPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private db: Database | null = null;
  private engine: SyncEngine | null = null;
  private statusCallbacks: ((status: SyncStatus) => void)[] = [];
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private retryInterval: ReturnType<typeof setInterval> | null = null;
  private pullInterval: ReturnType<typeof setInterval> | null = null;

  async onload(): Promise<void> {
    console.log('Loading Obsync PG plugin');

    await this.loadSettings();

    // Register the status view
    this.registerView(
      VIEW_TYPE_OBSYNC_STATUS,
      (leaf) => new ObsyncStatusView(leaf, this)
    );

    // Add settings tab
    this.addSettingTab(new ObsyncSettingTab(this.app, this));

    // Add ribbon icon
    this.addRibbonIcon('database', 'Obsync PG', () => {
      this.activateView();
    });

    // Add commands
    this.addCommand({
      id: 'sync-now',
      name: 'Sync Now',
      callback: () => this.syncNow(),
    });

    this.addCommand({
      id: 'pull-from-db',
      name: 'Pull from Database',
      callback: () => this.pullFromDB(),
    });

    this.addCommand({
      id: 'open-status',
      name: 'Open Status View',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'run-migrations',
      name: 'Run Migrations',
      callback: () => this.runMigrations(),
    });

    // Connect to database if settings are configured
    if (this.isConfigured()) {
      await this.connect();
    }
  }

  async onunload(): Promise<void> {
    console.log('Unloading Obsync PG plugin');

    // Stop intervals
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
    }
    if (this.pullInterval) {
      clearInterval(this.pullInterval);
    }

    // Flush pending events and save state
    if (this.engine) {
      this.engine.flush();
      if (this.engine.needsSave()) {
        await this.saveState();
      }
      this.engine.stop();
    }

    // Close database connection
    if (this.db) {
      await this.db.close();
    }

    // Detach leaves
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_OBSYNC_STATUS);
  }

  /**
   * Check if database is configured
   */
  isConfigured(): boolean {
    return !!(
      this.settings.host &&
      this.settings.database &&
      this.settings.user &&
      this.settings.password
    );
  }

  /**
   * Connect to database and initialize sync engine
   */
  async connect(): Promise<void> {
    try {
      // Initialize database
      this.db = new Database(this.settings);
      await this.db.connect();

      // Derive schema from vault name if not specified
      if (!this.settings.schema) {
        this.settings.schema = this.sanitizeIdentifier(this.app.vault.getName());
      }

      // Initialize sync engine
      this.engine = new SyncEngine(this.app, this.db, this.settings);

      // Load state
      const stateData = await this.loadData();
      if (stateData?.syncState) {
        this.engine.loadState(stateData.syncState);
      }

      // Set up status callback
      this.engine.onStatusChange((status) => {
        for (const callback of this.statusCallbacks) {
          callback(status);
        }
      });

      // Register file events if auto-sync is enabled
      if (this.settings.autoSync) {
        this.registerEvent(
          this.app.vault.on('modify', (file) => this.engine?.onFileModify(file))
        );
        this.registerEvent(
          this.app.vault.on('create', (file) => this.engine?.onFileCreate(file))
        );
        this.registerEvent(
          this.app.vault.on('delete', (file) => this.engine?.onFileDelete(file))
        );
        this.registerEvent(
          this.app.vault.on('rename', (file, oldPath) => this.engine?.onFileRename(file, oldPath))
        );
      }

      // Set up periodic state save
      this.saveInterval = setInterval(() => {
        if (this.engine?.needsSave()) {
          this.saveState();
        }
      }, 30000);

      // Set up retry interval
      this.retryInterval = setInterval(() => {
        this.engine?.retryFailed();
      }, 30000);

      // Set up periodic pull interval
      this.pullInterval = setInterval(() => {
        this.engine?.periodicPull();
      }, 30000);

      // Sync on startup if enabled
      if (this.settings.syncOnStartup) {
        // Delay a bit to let Obsidian finish loading
        setTimeout(() => {
          this.syncNow();
        }, 2000);
      }

      new Notice('Obsync PG: Connected to database');
      console.log('Obsync PG: Connected and ready');
    } catch (error) {
      console.error('Obsync PG: Connection failed:', error);
      new Notice(`Obsync PG: Connection failed - ${(error as Error).message}`);
    }
  }

  /**
   * Reconnect to database
   */
  async reconnect(): Promise<void> {
    // Disconnect existing connection
    if (this.engine) {
      this.engine.stop();
      this.engine = null;
    }
    if (this.db) {
      await this.db.close();
      this.db = null;
    }

    // Clear intervals
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }
    if (this.pullInterval) {
      clearInterval(this.pullInterval);
      this.pullInterval = null;
    }

    // Reconnect if configured
    if (this.isConfigured()) {
      await this.connect();
    }
  }

  /**
   * Test database connection with optional settings override
   */
  async testConnection(settings?: PluginSettings): Promise<boolean> {
    const testDb = new Database(settings || this.settings);
    try {
      await testDb.connect();
      await testDb.close();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run database migrations
   */
  async runMigrations(): Promise<void> {
    if (!this.db) {
      new Notice('Obsync PG: Not connected to database');
      return;
    }

    try {
      await this.db.runMigrations();
      new Notice('Obsync PG: Migrations completed');
    } catch (error) {
      console.error('Migration failed:', error);
      new Notice(`Obsync PG: Migration failed - ${(error as Error).message}`);
    }
  }

  /**
   * Perform full sync
   */
  async syncNow(): Promise<void> {
    if (!this.engine) {
      new Notice('Obsync PG: Not connected to database');
      return;
    }

    await this.engine.fullReconcile();
    await this.saveState();
  }

  /**
   * Pull from database
   */
  async pullFromDB(): Promise<void> {
    if (!this.engine) {
      new Notice('Obsync PG: Not connected to database');
      return;
    }

    await this.engine.pullFromDB();
  }

  /**
   * Refresh status
   */
  async refreshStatus(): Promise<void> {
    if (!this.db) return;

    try {
      const status = await this.db.getStatus();
      if (this.engine) {
        status.pendingChanges = this.engine.getPendingRetries();
      }
      for (const callback of this.statusCallbacks) {
        callback(status);
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Register status change callback
   */
  onStatusChange(callback: (status: SyncStatus) => void): void {
    this.statusCallbacks.push(callback);
  }

  /**
   * Activate the status view
   */
  async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_OBSYNC_STATUS);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_OBSYNC_STATUS, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * Load settings
   */
  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
  }

  /**
   * Save settings
   */
  async saveSettings(): Promise<void> {
    const data = await this.loadData() || {};
    data.settings = this.settings;
    await this.saveData(data);
  }

  /**
   * Save sync state
   */
  async saveState(): Promise<void> {
    if (!this.engine) return;

    const data = await this.loadData() || {};
    data.syncState = this.engine.serializeState();
    await this.saveData(data);
    this.engine.markSaved();
  }

  /**
   * Sanitize a string to be a valid PostgreSQL identifier
   */
  private sanitizeIdentifier(name: string): string {
    let result = name.toLowerCase();
    result = result.replace(/\s+/g, '_');
    result = result.replace(/-/g, '_');
    result = result.replace(/[^a-z0-9_]/g, '');
    result = result.replace(/_+/g, '_');
    result = result.replace(/^_+|_+$/g, '');

    if (!result) {
      result = 'vault';
    } else if (/^\d/.test(result)) {
      result = 'vault_' + result;
    }

    if (result.length > 63) {
      result = result.substring(0, 63).replace(/_+$/, '');
    }

    return result;
  }
}
