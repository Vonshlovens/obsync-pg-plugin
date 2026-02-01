<script lang="ts">
  import type { SyncStatus } from '../lib/types';

  export let status: SyncStatus;
  export let onSync: () => void;
  export let onPull: () => void;
  export let onMigrate: () => void;

  function formatDate(date: Date | null): string {
    if (!date) return 'Never';
    return new Date(date).toLocaleString();
  }
</script>

<div class="obsync-status-container">
  <h2>Obsync PG Status</h2>

  <div class="obsync-status-grid">
    <div class="obsync-status-item">
      <span class="obsync-label">Connection</span>
      <span class="obsync-value {status.connected ? 'connected' : 'disconnected'}">
        {status.connected ? '● Connected' : '○ Disconnected'}
      </span>
    </div>

    <div class="obsync-status-item">
      <span class="obsync-label">Notes</span>
      <span class="obsync-value">{status.totalNotes}</span>
    </div>

    <div class="obsync-status-item">
      <span class="obsync-label">Attachments</span>
      <span class="obsync-value">{status.totalAttachments}</span>
    </div>

    <div class="obsync-status-item">
      <span class="obsync-label">Last Sync</span>
      <span class="obsync-value">{formatDate(status.lastSyncTime)}</span>
    </div>

    <div class="obsync-status-item">
      <span class="obsync-label">Pending</span>
      <span class="obsync-value">{status.pendingChanges}</span>
    </div>
  </div>

  <div class="obsync-actions">
    <button on:click={onSync} disabled={!status.connected}>
      Sync Now
    </button>
    <button on:click={onPull} disabled={!status.connected}>
      Pull from DB
    </button>
    <button on:click={onMigrate} disabled={!status.connected}>
      Run Migrations
    </button>
  </div>
</div>

<style>
  .obsync-status-container {
    padding: 16px;
  }

  .obsync-status-container h2 {
    margin: 0 0 16px 0;
    font-size: 1.2em;
    font-weight: 600;
  }

  .obsync-status-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }

  .obsync-status-item {
    background: var(--background-secondary);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .obsync-label {
    font-size: 0.85em;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .obsync-value {
    font-size: 1.1em;
    font-weight: 500;
  }

  .obsync-value.connected {
    color: var(--text-success);
  }

  .obsync-value.disconnected {
    color: var(--text-error);
  }

  .obsync-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .obsync-actions button {
    padding: 8px 16px;
    border-radius: 6px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    cursor: pointer;
    font-size: 0.9em;
    transition: opacity 0.2s;
  }

  .obsync-actions button:hover:not(:disabled) {
    opacity: 0.9;
  }

  .obsync-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
