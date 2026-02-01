import type { PluginSettings, VaultNote, VaultAttachment, SyncStatus } from './types';

/**
 * PostgreSQL database client using node-postgres
 * Works in Electron's Node.js environment
 */
export class Database {
  private pool: any = null;
  private settings: PluginSettings;
  private pg: any = null;

  constructor(settings: PluginSettings) {
    this.settings = settings;
  }

  /**
   * Initialize the connection pool
   */
  async connect(): Promise<void> {
    try {
      // Try to load pg module - need to set up module resolution for bundled deps
      const electronRequire = (window as any).require;
      const path = electronRequire('path');
      const Module = electronRequire('module');

      // Get the plugin's directory path
      const pluginPath = (window as any).app?.vault?.adapter?.basePath
        ? path.join((window as any).app.vault.adapter.basePath, '.obsidian', 'plugins', 'obsync-pg')
        : null;

      if (pluginPath) {
        // Add the plugin's node_modules to the module search path
        const nodeModulesPath = path.join(pluginPath, 'node_modules');
        if (!Module.globalPaths.includes(nodeModulesPath)) {
          Module.globalPaths.unshift(nodeModulesPath);
          console.log('Added to module paths:', nodeModulesPath);
        }
      }

      // Now try to load pg
      try {
        this.pg = electronRequire('pg');
        console.log('Loaded pg module successfully');
      } catch (e: any) {
        console.error('Failed to load pg:', e);
        console.error('Error stack:', e.stack);

        // Try to give more specific error info
        let detail = e.message || 'Unknown error';
        if (e.code === 'MODULE_NOT_FOUND') {
          detail = `Module not found: ${e.message}. Required module may be missing from node_modules.`;
        }

        throw new Error(
          'Could not load PostgreSQL driver. ' + detail
        );
      }

      if (!this.pg || !this.pg.Pool) {
        throw new Error('pg module loaded but Pool is not available');
      }

      const sslConfig = this.settings.sslMode === 'disable'
        ? false
        : { rejectUnauthorized: false };

      const config = {
        host: this.settings.host,
        port: this.settings.port,
        user: this.settings.user,
        password: this.settings.password,
        database: this.settings.database,
        ssl: sslConfig,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      };

      console.log('Connecting to PostgreSQL:', {
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        ssl: config.ssl ? 'enabled' : 'disabled',
      });

      this.pool = new this.pg.Pool(config);

      // Test connection
      console.log('Testing connection...');
      const client = await this.pool.connect();

      // Set search path if schema is specified
      if (this.settings.schema) {
        console.log('Setting search path to schema:', this.settings.schema);
        await client.query(`SET search_path TO "${this.settings.schema}", public`);
      }

      client.release();
      console.log('Connected to PostgreSQL database successfully');
    } catch (error: any) {
      console.error('Failed to connect to database:', error);

      // Provide more helpful error messages
      let message = error.message || 'Unknown error';

      if (message.includes('ECONNREFUSED')) {
        message = `Connection refused. Is PostgreSQL running on ${this.settings.host}:${this.settings.port}?`;
      } else if (message.includes('ETIMEDOUT')) {
        message = `Connection timed out. Check if ${this.settings.host}:${this.settings.port} is reachable.`;
      } else if (message.includes('authentication failed')) {
        message = 'Authentication failed. Check your username and password.';
      } else if (message.includes('does not exist')) {
        message = `Database "${this.settings.database}" does not exist.`;
      } else if (message.includes('SSL')) {
        message = 'SSL connection error. Try changing SSL mode in settings.';
      }

      throw new Error(message);
    }
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('Database connection closed');
    }
  }

  /**
   * Test database connection
   */
  async ping(): Promise<boolean> {
    if (!this.pool) return false;

    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure schema exists
   */
  async ensureSchema(): Promise<void> {
    if (!this.settings.schema || !this.pool) return;

    const client = await this.pool.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.settings.schema}"`);
      await client.query(`SET search_path TO "${this.settings.schema}", public`);
    } finally {
      client.release();
    }
  }

  /**
   * Run database migrations
   */
  async runMigrations(): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');

    await this.ensureSchema();

    const client = await this.pool.connect();
    try {
      // Create vault_notes table
      await client.query(`
        CREATE TABLE IF NOT EXISTS vault_notes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          path TEXT UNIQUE NOT NULL,
          filename TEXT NOT NULL,
          title TEXT,
          tags TEXT[],
          aliases TEXT[],
          created_at TIMESTAMPTZ,
          modified_at TIMESTAMPTZ,
          publish BOOLEAN DEFAULT false,
          frontmatter JSONB DEFAULT '{}',
          body TEXT,
          raw_content TEXT,
          content_hash TEXT NOT NULL,
          file_size_bytes BIGINT,
          synced_at TIMESTAMPTZ DEFAULT NOW(),
          outgoing_links TEXT[]
        )
      `);

      // Create vault_attachments table
      await client.query(`
        CREATE TABLE IF NOT EXISTS vault_attachments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          path TEXT UNIQUE NOT NULL,
          filename TEXT NOT NULL,
          extension TEXT,
          mime_type TEXT,
          file_size_bytes BIGINT,
          content_hash TEXT NOT NULL,
          data BYTEA,
          synced_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create indexes (if not exist)
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notes_tags ON vault_notes USING GIN (tags)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notes_frontmatter ON vault_notes USING GIN (frontmatter)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notes_modified ON vault_notes (modified_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notes_hash ON vault_notes (content_hash)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_attachments_ext ON vault_attachments (extension)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_attachments_hash ON vault_attachments (content_hash)`);

      console.log('Migrations completed successfully');
    } finally {
      client.release();
    }
  }

  /**
   * Upsert a note into the database
   */
  async upsertNote(note: VaultNote): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO vault_notes (
          path, filename, title, tags, aliases, created_at, modified_at,
          publish, frontmatter, body, raw_content, content_hash,
          file_size_bytes, outgoing_links
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )
        ON CONFLICT (path) DO UPDATE SET
          filename = EXCLUDED.filename,
          title = EXCLUDED.title,
          tags = EXCLUDED.tags,
          aliases = EXCLUDED.aliases,
          created_at = EXCLUDED.created_at,
          modified_at = EXCLUDED.modified_at,
          publish = EXCLUDED.publish,
          frontmatter = EXCLUDED.frontmatter,
          body = EXCLUDED.body,
          raw_content = EXCLUDED.raw_content,
          content_hash = EXCLUDED.content_hash,
          file_size_bytes = EXCLUDED.file_size_bytes,
          outgoing_links = EXCLUDED.outgoing_links,
          synced_at = NOW()
      `, [
        note.path,
        note.filename,
        note.title,
        note.tags,
        note.aliases,
        note.createdAt,
        note.modifiedAt,
        note.publish,
        JSON.stringify(note.frontmatter),
        note.body,
        note.rawContent,
        note.contentHash,
        note.fileSizeBytes,
        note.outgoingLinks,
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Upsert an attachment into the database
   */
  async upsertAttachment(attachment: VaultAttachment): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO vault_attachments (
          path, filename, extension, mime_type, file_size_bytes,
          content_hash, data
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )
        ON CONFLICT (path) DO UPDATE SET
          filename = EXCLUDED.filename,
          extension = EXCLUDED.extension,
          mime_type = EXCLUDED.mime_type,
          file_size_bytes = EXCLUDED.file_size_bytes,
          content_hash = EXCLUDED.content_hash,
          data = EXCLUDED.data,
          synced_at = NOW()
      `, [
        attachment.path,
        attachment.filename,
        attachment.extension,
        attachment.mimeType,
        attachment.fileSizeBytes,
        attachment.contentHash,
        Buffer.from(attachment.data),
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Delete a note from the database
   */
  async deleteNote(path: string): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM vault_notes WHERE path = $1', [path]);
    } finally {
      client.release();
    }
  }

  /**
   * Delete an attachment from the database
   */
  async deleteAttachment(path: string): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM vault_attachments WHERE path = $1', [path]);
    } finally {
      client.release();
    }
  }

  /**
   * Get all note hashes for reconciliation
   */
  async getAllNoteHashes(): Promise<Map<string, string>> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT path, content_hash FROM vault_notes');
      const hashes = new Map<string, string>();
      for (const row of result.rows) {
        hashes.set(row.path, row.content_hash);
      }
      return hashes;
    } finally {
      client.release();
    }
  }

  /**
   * Get all attachment hashes for reconciliation
   */
  async getAllAttachmentHashes(): Promise<Map<string, string>> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT path, content_hash FROM vault_attachments');
      const hashes = new Map<string, string>();
      for (const row of result.rows) {
        hashes.set(row.path, row.content_hash);
      }
      return hashes;
    } finally {
      client.release();
    }
  }

  /**
   * Get all notes (for pull command)
   */
  async getAllNotes(): Promise<VaultNote[]> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT id, path, filename, title, tags, aliases, created_at,
          modified_at, publish, frontmatter, body, raw_content,
          content_hash, file_size_bytes, synced_at, outgoing_links
        FROM vault_notes
      `);

      return result.rows.map((row: any) => ({
        id: row.id,
        path: row.path,
        filename: row.filename,
        title: row.title,
        tags: row.tags || [],
        aliases: row.aliases || [],
        createdAt: row.created_at,
        modifiedAt: row.modified_at,
        publish: row.publish,
        frontmatter: row.frontmatter || {},
        body: row.body,
        rawContent: row.raw_content,
        contentHash: row.content_hash,
        fileSizeBytes: Number(row.file_size_bytes),
        syncedAt: row.synced_at,
        outgoingLinks: row.outgoing_links || [],
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get all attachments (for pull command)
   */
  async getAllAttachments(): Promise<VaultAttachment[]> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT id, path, filename, extension, mime_type, file_size_bytes,
          content_hash, data, synced_at
        FROM vault_attachments
      `);

      return result.rows.map((row: any) => ({
        id: row.id,
        path: row.path,
        filename: row.filename,
        extension: row.extension,
        mimeType: row.mime_type,
        fileSizeBytes: Number(row.file_size_bytes),
        contentHash: row.content_hash,
        data: row.data,
        syncedAt: row.synced_at,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Batch delete notes
   */
  async batchDeleteNotes(paths: string[]): Promise<void> {
    if (!this.pool || paths.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM vault_notes WHERE path = ANY($1)', [paths]);
    } finally {
      client.release();
    }
  }

  /**
   * Batch delete attachments
   */
  async batchDeleteAttachments(paths: string[]): Promise<void> {
    if (!this.pool || paths.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM vault_attachments WHERE path = ANY($1)', [paths]);
    } finally {
      client.release();
    }
  }

  /**
   * Get sync status
   */
  async getStatus(): Promise<SyncStatus> {
    if (!this.pool) {
      return {
        connected: false,
        lastSyncTime: null,
        totalNotes: 0,
        totalAttachments: 0,
        pendingChanges: 0,
      };
    }

    const client = await this.pool.connect();
    try {
      const notesResult = await client.query('SELECT COUNT(*) as count FROM vault_notes');
      const attachResult = await client.query('SELECT COUNT(*) as count FROM vault_attachments');
      const lastSyncResult = await client.query(`
        SELECT MAX(synced_at) as last_sync FROM (
          SELECT synced_at FROM vault_notes
          UNION ALL
          SELECT synced_at FROM vault_attachments
        ) t
      `);

      return {
        connected: true,
        lastSyncTime: lastSyncResult.rows[0]?.last_sync || null,
        totalNotes: parseInt(notesResult.rows[0].count, 10),
        totalAttachments: parseInt(attachResult.rows[0].count, 10),
        pendingChanges: 0,
      };
    } finally {
      client.release();
    }
  }
}
