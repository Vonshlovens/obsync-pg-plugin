// Database models matching the Go version

export interface VaultNote {
  id?: string;
  path: string;
  filename: string;
  title: string | null;
  tags: string[];
  aliases: string[];
  createdAt: Date | null;
  modifiedAt: Date | null;
  publish: boolean;
  frontmatter: Record<string, unknown>;
  body: string;
  rawContent: string;
  contentHash: string;
  fileSizeBytes: number;
  syncedAt?: Date;
  outgoingLinks: string[];
}

export interface VaultAttachment {
  id?: string;
  path: string;
  filename: string;
  extension: string | null;
  mimeType: string | null;
  fileSizeBytes: number;
  contentHash: string;
  data: ArrayBuffer;
  syncedAt?: Date;
}

export interface SyncStatus {
  connected: boolean;
  lastSyncTime: Date | null;
  totalNotes: number;
  totalAttachments: number;
  pendingChanges: number;
}

export interface FileState {
  hash: string;
  lastSynced: Date;
  lastModified: Date;
  sizeBytes: number;
}

export interface SyncState {
  vaultPath: string;
  lastFullSync: Date | null;
  files: Record<string, FileState>;
}

export interface PluginSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  schema: string;
  sslMode: string;
  debounceMs: number;
  maxBinarySizeMB: number;
  batchSize: number;
  retryAttempts: number;
  retryDelayMs: number;
  ignorePatterns: string[];
  autoSync: boolean;
  syncOnStartup: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  host: '',
  port: 5432,
  user: '',
  password: '',
  database: '',
  schema: '',
  sslMode: 'require',
  debounceMs: 2000,
  maxBinarySizeMB: 50,
  batchSize: 100,
  retryAttempts: 3,
  retryDelayMs: 1000,
  ignorePatterns: [
    '.obsidian/**',
    '.trash/**',
    '.git/**',
    '**/.DS_Store',
    '**/node_modules/**',
  ],
  autoSync: true,
  syncOnStartup: true,
};

export enum EventType {
  Create = 'CREATE',
  Modify = 'MODIFY',
  Delete = 'DELETE',
  Rename = 'RENAME',
}

export interface FileEvent {
  path: string;
  eventType: EventType;
  timestamp: Date;
}
