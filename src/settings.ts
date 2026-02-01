import { App, PluginSettingTab } from 'obsidian';
import SettingsPanel from './components/SettingsPanel.svelte';
import type ObsyncPgPlugin from './main';
import type { PluginSettings } from './lib/types';

export class ObsyncSettingTab extends PluginSettingTab {
  plugin: ObsyncPgPlugin;
  private component: SettingsPanel | null = null;

  constructor(app: App, plugin: ObsyncPgPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.component = new SettingsPanel({
      target: containerEl,
      props: {
        settings: { ...this.plugin.settings },
        onSave: async (settings: PluginSettings) => {
          this.plugin.settings = settings;
          await this.plugin.saveSettings();
          await this.plugin.reconnect();
        },
        onTestConnection: async (settings: PluginSettings) => {
          return await this.plugin.testConnection(settings);
        },
      },
    });
  }

  hide(): void {
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }
  }
}
