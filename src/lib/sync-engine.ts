import { App, TFile, TAbstractFile, Notice, normalizePath } from 'obsidian';
import { Database } from './database';
import { StateTracker } from './state';
import { Debouncer } from './debouncer';
import { parseContent, mergeTags } from './parser';
import { hashContent, hashArrayBuffer } from './hasher';
import { PluginSettings, VaultNote, VaultAttachment, EventType, FileEvent, SyncStatus } from './types';
import { minimatch } from 'minimatch';

/**
 * Sync engine handles file synchronization logic
 */
export class SyncEngine {
  private app: App;
  private db: Database;
  private settings: PluginSettings;
  private state: StateTracker;
  private debouncer: Debouncer;
  private retryQueue: Map<string, number> = new Map();
  private isRunning = false;
  private statusCallback: ((status: SyncStatus) => void) | null = null;

  constructor(app: App, db: Database, settings: PluginSettings) {
    this.app = app;
    this.db = db;
    this.settings = settings;
    this.state = new StateTracker(this.app.vault.getName());
    this.debouncer = new Debouncer(settings.debounceMs);

    // Set up debouncer callback
    this.debouncer.onEvent((event) => this.handleFileEvent(event));
  }

  /**
   * Load state from plugin data
   */
  loadState(json: string): void {
    this.state.load(json);
  }

  /**
   * Get serialized state for saving
   */
  serializeState(): string {
    return this.state.serialize();
  }

  /**
   * Check if state needs saving
   */
  needsSave(): boolean {
    return this.state.isDirty();
  }

  /**
   * Mark state as saved
   */
  markSaved(): void {
    this.state.markSaved();
  }

  /**
   * Set status callback
   */
  onStatusChange(callback: (status: SyncStatus) => void): void {
    this.statusCallback = callback;
  }

  /**
   * Update status to listeners
   */
  private async updateStatus(): Promise<void> {
    if (this.statusCallback) {
      try {
        const status = await this.db.getStatus();
        status.pendingChanges = this.debouncer.pendingCount() + this.retryQueue.size;
        this.statusCallback(status);
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Check if a path should be ignored
   */
  private shouldIgnore(path: string): boolean {
    for (const pattern of this.settings.ignorePatterns) {
      if (minimatch(path, pattern, { dot: true })) {
        return true;
      }
    }
    return false;
  }

  /**
   * Handle a file modification event from Obsidian
   */
  onFileModify(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    if (this.shouldIgnore(file.path)) return;
    this.debouncer.add(file.path, EventType.Modify);
  }

  /**
   * Handle a file creation event from Obsidian
   */
  onFileCreate(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    if (this.shouldIgnore(file.path)) return;
    this.debouncer.add(file.path, EventType.Create);
  }

  /**
   * Handle a file deletion event from Obsidian
   */
  onFileDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    if (this.shouldIgnore(file.path)) return;
    this.debouncer.add(file.path, EventType.Delete);
  }

  /**
   * Handle a file rename event from Obsidian
   */
  onFileRename(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFile)) return;

    // Delete old path
    if (!this.shouldIgnore(oldPath)) {
      this.debouncer.add(oldPath, EventType.Delete);
    }

    // Create new path
    if (!this.shouldIgnore(file.path)) {
      this.debouncer.add(file.path, EventType.Create);
    }
  }

  /**
   * Handle debounced file event
   */
  private async handleFileEvent(event: FileEvent): Promise<void> {
    try {
      await this.syncFile(event.path, event.eventType);
      await this.updateStatus();
    } catch (error) {
      console.error(`Sync failed for ${event.path}:`, error);
      // Add to retry queue
      this.retryQueue.set(event.path, 0);
    }
  }

  /**
   * Sync a single file
   */
  async syncFile(path: string, eventType: EventType): Promise<void> {
    switch (eventType) {
      case EventType.Delete:
        await this.removeFile(path);
        break;
      case EventType.Create:
      case EventType.Modify:
        await this.upsertFile(path);
        break;
    }
  }

  /**
   * Upsert a file to the database
   */
  private async upsertFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;

    // Check if file should be ignored
    if (this.shouldIgnore(path)) return;

    // Determine file type
    if (file.extension === 'md') {
      await this.syncNote(file);
    } else {
      await this.syncAttachment(file);
    }
  }

  /**
   * Sync a markdown note
   */
  private async syncNote(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const hash = hashContent(content);

    // Check if sync is needed
    if (!this.state.needsSync(file.path, hash)) {
      return;
    }

    const parsed = parseContent(content, file.basename);
    const allTags = mergeTags(parsed.frontmatter.tags, parsed.inlineTags);

    // Get file stats
    const stat = await this.app.vault.adapter.stat(file.path);
    const created = parsed.frontmatter.created || (stat?.ctime ? new Date(stat.ctime) : null);
    const modified = parsed.frontmatter.modified || (stat?.mtime ? new Date(stat.mtime) : null);

    const note: VaultNote = {
      path: file.path,
      filename: file.basename,
      title: parsed.frontmatter.title,
      tags: allTags,
      aliases: parsed.frontmatter.aliases,
      createdAt: created,
      modifiedAt: modified,
      publish: parsed.frontmatter.publish || false,
      frontmatter: parsed.frontmatter.extra,
      body: parsed.body,
      rawContent: parsed.rawContent,
      contentHash: hash,
      fileSizeBytes: stat?.size || 0,
      outgoingLinks: parsed.outgoingLinks,
    };

    await this.db.upsertNote(note);

    // Update state
    this.state.setFileState(file.path, {
      hash,
      lastSynced: new Date(),
      lastModified: modified || new Date(),
      sizeBytes: stat?.size || 0,
    });

    console.log(`Synced note: ${file.path}`);
  }

  /**
   * Sync an attachment (non-markdown file)
   */
  private async syncAttachment(file: TFile): Promise<void> {
    const stat = await this.app.vault.adapter.stat(file.path);
    const size = stat?.size || 0;

    // Skip if too large
    const maxSize = this.settings.maxBinarySizeMB * 1024 * 1024;
    if (size > maxSize) {
      console.warn(`Attachment too large, skipping: ${file.path} (${(size / 1024 / 1024).toFixed(2)} MB)`);
      return;
    }

    const data = await this.app.vault.readBinary(file);
    const hash = hashArrayBuffer(data);

    // Check if sync is needed
    if (!this.state.needsSync(file.path, hash)) {
      return;
    }

    // Detect MIME type
    const mimeType = this.getMimeType(file.extension);

    const attachment: VaultAttachment = {
      path: file.path,
      filename: file.basename,
      extension: file.extension,
      mimeType,
      fileSizeBytes: size,
      contentHash: hash,
      data,
    };

    await this.db.upsertAttachment(attachment);

    // Update state
    this.state.setFileState(file.path, {
      hash,
      lastSynced: new Date(),
      lastModified: stat?.mtime ? new Date(stat.mtime) : new Date(),
      sizeBytes: size,
    });

    console.log(`Synced attachment: ${file.path}`);
  }

  /**
   * Remove a file from the database
   */
  private async removeFile(path: string): Promise<void> {
    if (path.endsWith('.md')) {
      await this.db.deleteNote(path);
    } else {
      await this.db.deleteAttachment(path);
    }

    this.state.removeFileState(path);
    console.log(`Removed: ${path}`);
  }

  /**
   * Perform a full reconciliation sync
   */
  async fullReconcile(): Promise<void> {
    if (this.isRunning) {
      new Notice('Sync already in progress');
      return;
    }

    this.isRunning = true;
    new Notice('Starting full sync...');

    try {
      // Get all local files
      const localFiles = this.app.vault.getFiles().filter((f) => !this.shouldIgnore(f.path));

      // Get hashes from database
      const dbNoteHashes = await this.db.getAllNoteHashes();
      const dbAttachHashes = await this.db.getAllAttachmentHashes();
      const dbHashes = new Map([...dbNoteHashes, ...dbAttachHashes]);

      // Compute local hashes and find files to sync
      const toSync: TFile[] = [];
      const localPaths = new Set<string>();

      for (const file of localFiles) {
        localPaths.add(file.path);

        let hash: string;
        if (file.extension === 'md') {
          const content = await this.app.vault.read(file);
          hash = hashContent(content);
        } else {
          const data = await this.app.vault.readBinary(file);
          hash = hashArrayBuffer(data);
        }

        const dbHash = dbHashes.get(file.path);
        if (!dbHash || dbHash !== hash) {
          toSync.push(file);
        }
      }

      // Find files to delete from DB
      const toDelete: string[] = [];
      for (const dbPath of dbHashes.keys()) {
        if (!localPaths.has(dbPath)) {
          toDelete.push(dbPath);
        }
      }

      // Sync changed/new files
      let synced = 0;
      for (const file of toSync) {
        try {
          if (file.extension === 'md') {
            await this.syncNote(file);
          } else {
            await this.syncAttachment(file);
          }
          synced++;
        } catch (error) {
          console.error(`Failed to sync ${file.path}:`, error);
          this.retryQueue.set(file.path, 0);
        }
      }

      // Delete removed files
      const notesToDelete = toDelete.filter((p) => p.endsWith('.md'));
      const attachToDelete = toDelete.filter((p) => !p.endsWith('.md'));

      if (notesToDelete.length > 0) {
        await this.db.batchDeleteNotes(notesToDelete);
        for (const path of notesToDelete) {
          this.state.removeFileState(path);
        }
      }

      if (attachToDelete.length > 0) {
        await this.db.batchDeleteAttachments(attachToDelete);
        for (const path of attachToDelete) {
          this.state.removeFileState(path);
        }
      }

      this.state.setLastFullSync(new Date());
      await this.updateStatus();

      new Notice(`Sync complete: ${synced} files synced, ${toDelete.length} deleted`);
      console.log(`Full reconciliation: synced=${synced}, deleted=${toDelete.length}`);
    } catch (error) {
      console.error('Full reconciliation failed:', error);
      new Notice('Sync failed. Check console for details.');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Pull files from database to local vault
   */
  async pullFromDB(): Promise<void> {
    if (this.isRunning) {
      new Notice('Sync already in progress');
      return;
    }

    this.isRunning = true;
    new Notice('Pulling from database...');

    try {
      const notes = await this.db.getAllNotes();
      const attachments = await this.db.getAllAttachments();

      let pulled = 0;

      // Write notes
      for (const note of notes) {
        const file = this.app.vault.getAbstractFileByPath(note.path);

        // Check if file exists and has same hash
        if (file instanceof TFile) {
          const content = await this.app.vault.read(file);
          if (hashContent(content) === note.contentHash) {
            continue;
          }
        }

        // Create directory if needed
        const dir = note.path.substring(0, note.path.lastIndexOf('/'));
        if (dir) {
          await this.ensureFolder(dir);
        }

        // Write file
        await this.app.vault.adapter.write(note.path, note.rawContent);
        pulled++;
      }

      // Write attachments
      for (const att of attachments) {
        const file = this.app.vault.getAbstractFileByPath(att.path);

        // Check if file exists and has same hash
        if (file instanceof TFile) {
          const data = await this.app.vault.readBinary(file);
          if (hashArrayBuffer(data) === att.contentHash) {
            continue;
          }
        }

        // Create directory if needed
        const dir = att.path.substring(0, att.path.lastIndexOf('/'));
        if (dir) {
          await this.ensureFolder(dir);
        }

        // Write file
        await this.app.vault.adapter.writeBinary(att.path, att.data);
        pulled++;
      }

      new Notice(`Pulled ${pulled} files from database`);
      console.log(`Pull complete: ${pulled} files`);
    } catch (error) {
      console.error('Pull failed:', error);
      new Notice('Pull failed. Check console for details.');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Ensure a folder exists
   */
  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const folder = this.app.vault.getAbstractFileByPath(normalized);
    if (!folder) {
      await this.app.vault.createFolder(normalized);
    }
  }

  /**
   * Retry failed sync operations
   */
  async retryFailed(): Promise<void> {
    const maxRetries = this.settings.retryAttempts;

    for (const [path, count] of Array.from(this.retryQueue.entries())) {
      if (count >= maxRetries) {
        console.error(`Max retries exceeded for: ${path}`);
        this.retryQueue.delete(path);
        continue;
      }

      this.retryQueue.set(path, count + 1);

      try {
        await this.upsertFile(path);
        this.retryQueue.delete(path);
        console.log(`Retry succeeded for: ${path}`);
      } catch (error) {
        console.warn(`Retry failed for ${path} (attempt ${count + 1}):`, error);
      }
    }

    await this.updateStatus();
  }

  /**
   * Flush pending events
   */
  flush(): void {
    this.debouncer.flush();
  }

  /**
   * Stop the sync engine
   */
  stop(): void {
    this.debouncer.stop();
    this.isRunning = false;
  }

  /**
   * Get MIME type for a file extension
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      mp4: 'video/mp4',
      webm: 'video/webm',
      json: 'application/json',
      css: 'text/css',
      js: 'application/javascript',
      html: 'text/html',
      xml: 'application/xml',
      zip: 'application/zip',
    };

    return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
  }

  /**
   * Get pending retry count
   */
  getPendingRetries(): number {
    return this.retryQueue.size;
  }
}
