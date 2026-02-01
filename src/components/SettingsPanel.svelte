<script lang="ts">
  import type { PluginSettings } from '../lib/types';

  export let settings: PluginSettings;
  export let onSave: (settings: PluginSettings) => void;
  export let onTestConnection: (settings: PluginSettings) => Promise<boolean>;

  let testing = false;
  let testResult: boolean | null = null;

  async function handleTest() {
    testing = true;
    testResult = null;
    try {
      // Pass current settings to test with unsaved values
      testResult = await onTestConnection(settings);
    } finally {
      testing = false;
    }
  }

  function handleSave() {
    onSave(settings);
  }

  function addIgnorePattern() {
    settings.ignorePatterns = [...settings.ignorePatterns, ''];
  }

  function removeIgnorePattern(index: number) {
    settings.ignorePatterns = settings.ignorePatterns.filter((_, i) => i !== index);
  }
</script>

<div class="obsync-settings">
  <section class="obsync-section">
    <h3>Database Connection</h3>

    <div class="setting-item">
      <label for="host">Host</label>
      <input id="host" type="text" bind:value={settings.host} placeholder="db.example.com" />
    </div>

    <div class="setting-item">
      <label for="port">Port</label>
      <input id="port" type="number" bind:value={settings.port} />
    </div>

    <div class="setting-item">
      <label for="database">Database</label>
      <input id="database" type="text" bind:value={settings.database} placeholder="postgres" />
    </div>

    <div class="setting-item">
      <label for="user">User</label>
      <input id="user" type="text" bind:value={settings.user} placeholder="postgres" />
    </div>

    <div class="setting-item">
      <label for="password">Password</label>
      <input id="password" type="password" bind:value={settings.password} />
    </div>

    <div class="setting-item">
      <label for="schema">Schema</label>
      <input id="schema" type="text" bind:value={settings.schema} placeholder="vault_name" />
      <small>Leave empty to derive from vault name</small>
    </div>

    <div class="setting-item">
      <label for="sslMode">SSL Mode</label>
      <select id="sslMode" bind:value={settings.sslMode}>
        <option value="require">Require</option>
        <option value="prefer">Prefer</option>
        <option value="disable">Disable</option>
      </select>
    </div>

    <div class="setting-actions">
      <button on:click={handleTest} disabled={testing}>
        {testing ? 'Testing...' : 'Test Connection'}
      </button>
      {#if testResult !== null}
        <span class="test-result {testResult ? 'success' : 'error'}">
          {testResult ? '✓ Connected' : '✗ Failed'}
        </span>
      {/if}
    </div>
  </section>

  <section class="obsync-section">
    <h3>Sync Settings</h3>

    <div class="setting-item">
      <label for="debounceMs">Debounce (ms)</label>
      <input id="debounceMs" type="number" bind:value={settings.debounceMs} />
      <small>Delay before syncing after file changes</small>
    </div>

    <div class="setting-item">
      <label for="maxBinarySize">Max Attachment Size (MB)</label>
      <input id="maxBinarySize" type="number" bind:value={settings.maxBinarySizeMB} />
    </div>

    <div class="setting-item">
      <label for="retryAttempts">Retry Attempts</label>
      <input id="retryAttempts" type="number" bind:value={settings.retryAttempts} />
    </div>

    <div class="setting-item toggle">
      <label for="autoSync">Auto Sync</label>
      <input id="autoSync" type="checkbox" bind:checked={settings.autoSync} />
    </div>

    <div class="setting-item toggle">
      <label for="syncOnStartup">Sync on Startup</label>
      <input id="syncOnStartup" type="checkbox" bind:checked={settings.syncOnStartup} />
    </div>
  </section>

  <section class="obsync-section">
    <h3>Ignore Patterns</h3>

    {#each settings.ignorePatterns as pattern, index}
      <div class="pattern-row">
        <input type="text" bind:value={settings.ignorePatterns[index]} placeholder="**/.git/**" />
        <button class="remove-btn" on:click={() => removeIgnorePattern(index)}>×</button>
      </div>
    {/each}

    <button class="add-btn" on:click={addIgnorePattern}>+ Add Pattern</button>
  </section>

  <div class="save-actions">
    <button class="primary" on:click={handleSave}>Save Settings</button>
  </div>
</div>

<style>
  .obsync-settings {
    padding: 16px 0;
  }

  .obsync-section {
    margin-bottom: 24px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .obsync-section h3 {
    margin: 0 0 16px 0;
    font-size: 1.1em;
    font-weight: 600;
  }

  .setting-item {
    margin-bottom: 12px;
  }

  .setting-item label {
    display: block;
    margin-bottom: 4px;
    font-weight: 500;
  }

  .setting-item input[type="text"],
  .setting-item input[type="password"],
  .setting-item input[type="number"],
  .setting-item select {
    width: 100%;
    padding: 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .setting-item.toggle {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .setting-item.toggle label {
    margin: 0;
    flex: 1;
  }

  .setting-item.toggle input {
    width: auto;
  }

  .setting-item small {
    display: block;
    margin-top: 4px;
    color: var(--text-muted);
    font-size: 0.85em;
  }

  .setting-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 16px;
  }

  .test-result {
    font-weight: 500;
  }

  .test-result.success {
    color: var(--text-success);
  }

  .test-result.error {
    color: var(--text-error);
  }

  .pattern-row {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }

  .pattern-row input {
    flex: 1;
    padding: 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .remove-btn {
    padding: 8px 12px;
    border: none;
    border-radius: 4px;
    background: var(--background-modifier-error);
    color: var(--text-on-accent);
    cursor: pointer;
    font-size: 1.2em;
    line-height: 1;
  }

  .add-btn {
    padding: 8px 12px;
    border: 1px dashed var(--background-modifier-border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .add-btn:hover {
    background: var(--background-secondary);
  }

  .save-actions {
    margin-top: 24px;
  }

  button {
    padding: 8px 16px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background: var(--background-secondary);
    color: var(--text-normal);
    cursor: pointer;
  }

  button:hover {
    background: var(--background-modifier-hover);
  }

  button.primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
