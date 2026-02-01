# Obsync PG - Obsidian to PostgreSQL Sync Plugin

Sync your Obsidian vault to a PostgreSQL database in real-time. This plugin is a TypeScript/Svelte port of the [obsync-pg](https://github.com/deveric/obsync-pg) Go daemon.

## Features

- **Real-time Sync**: Automatically sync file changes to PostgreSQL as you edit
- **Full Reconciliation**: Perform full vault sync with hash-based change detection
- **Pull from Database**: Download your vault from the database to a new device
- **Frontmatter Parsing**: Extracts title, tags, aliases, dates, and custom fields
- **Wiki-link Extraction**: Captures all `[[wiki links]]` in your notes
- **Inline Tag Extraction**: Finds `#inline-tags` in your content
- **Attachment Support**: Syncs binary files (images, PDFs, etc.) up to configurable size limit
- **Ignore Patterns**: Configure glob patterns to exclude files/folders
- **Schema Isolation**: Each vault uses its own PostgreSQL schema

## Installation

### From Release (Recommended)

1. Download the latest release zip from [GitHub Releases](https://github.com/Vonshlovens/obsync-pg-plugin/releases)
2. Extract the `obsync-pg` folder to your vault's `.obsidian/plugins/` directory
3. Enable the plugin in Obsidian's Community Plugins settings
4. Configure your database connection in the plugin settings

### From Source

```bash
# Clone the repository
git clone https://github.com/Vonshlovens/obsync-pg-plugin.git
cd obsync-pg-plugin

# Install dependencies
npm install

# Build the release (creates dist/obsync-pg/)
npm run release

# Copy to your vault
cp -r dist/obsync-pg /path/to/vault/.obsidian/plugins/
```

### Plugin Structure

The installed plugin folder should contain:
```
.obsidian/plugins/obsync-pg/
├── main.js
├── manifest.json
└── node_modules/
    ├── pg/
    ├── pg-pool/
    ├── pg-protocol/
    ├── pg-types/
    ├── pgpass/
    └── ... (other pg dependencies)
```

**Note:** The `node_modules/` folder with pg dependencies is required. The plugin uses native PostgreSQL drivers that cannot be bundled into main.js.

## Database Setup

You need a PostgreSQL database (version 13+ recommended). The plugin will automatically create the necessary tables when you run migrations.

### Using Supabase

1. Create a new Supabase project
2. Copy your database credentials from Project Settings > Database
3. Enter the credentials in the plugin settings

### Using Self-Hosted PostgreSQL

1. Create a database for your vault
2. Configure the connection in the plugin settings
3. Run migrations from the status panel

## Database Schema

The plugin creates two tables in your configured schema:

### vault_notes
- `path` - Relative path from vault root
- `filename` - File name
- `title` - From frontmatter or filename
- `tags` - Array of tags (frontmatter + inline)
- `aliases` - From frontmatter
- `created_at`, `modified_at` - Timestamps
- `frontmatter` - JSONB with all custom fields
- `body` - Markdown without frontmatter
- `raw_content` - Original file content
- `content_hash` - SHA256 for change detection
- `outgoing_links` - Extracted wiki links

### vault_attachments
- `path`, `filename`, `extension`
- `mime_type` - Detected content type
- `data` - Binary content (BYTEA)
- `content_hash` - SHA256 for change detection

## Commands

- **Sync Now**: Perform a full reconciliation sync
- **Pull from Database**: Download files from database to local vault
- **Open Status View**: Show the sync status panel
- **Run Migrations**: Create/update database tables

## Settings

### Database Connection
- Host, Port, Database, User, Password
- Schema name (defaults to vault name)
- SSL Mode (require/prefer/disable)

### Sync Settings
- Debounce delay (ms before syncing after changes)
- Max attachment size (MB)
- Retry attempts for failed syncs
- Auto sync on file changes
- Sync on startup

### Ignore Patterns
Glob patterns to exclude from sync:
- `.obsidian/**` (default)
- `.trash/**` (default)
- `.git/**` (default)

## Multi-Device Sync

1. Set up the database connection on your first device
2. Run migrations and perform initial sync
3. On new devices, configure the same database connection
4. Use "Pull from Database" to download the vault

## Development

```bash
# Install dependencies
npm install

# Build for development (with watch)
npm run dev

# Build for production
npm run build

# Type check Svelte components
npm run svelte-check
```

## License

MIT
