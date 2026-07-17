import { App, Notice, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type SovereignRouterPlugin from './main';
import { DEFAULT_EXECUTOR_MODELS } from './models';
import type { ModelCatalogSnapshot } from './model-catalog';
import type { McpServerConfig } from './mcp-types';
import { isAllowedMcpEndpoint } from './mcp-policy';

export interface SovereignRouterSettings {
	openRouterSecretName: string;
	gatekeeperModel: string;
	defaultExecutorModel: string;
	permittedExecutorModels: string[];
	customModelSlugs: string[];
	modelCatalog: ModelCatalogSnapshot | null;
	modelCatalogRefreshDays: number;
	modelCatalogVersion: number;
	routingInstruction: string;
	skillSearchPaths: string[];
	allowedGitHubRepos: string[];
	doclingServiceUrl: string;
	doclingSecretName: string;
	hermesServiceUrl: string;
	hermesSecretName: string;
	enableHermesAutoRouting: boolean;
	mcpServers: McpServerConfig[];
}

export const DEFAULT_SETTINGS: SovereignRouterSettings = {
	openRouterSecretName: '',
	gatekeeperModel: 'deepseek/deepseek-v4-flash',
	defaultExecutorModel: 'moonshotai/kimi-k2.7-code',
	permittedExecutorModels: DEFAULT_EXECUTOR_MODELS,
	customModelSlugs: [],
	modelCatalog: null,
	modelCatalogRefreshDays: 15,
	modelCatalogVersion: 1,
	routingInstruction: 'Choose the best permitted executor model and, when useful, one available skill. Return only the required JSON object.',
	skillSearchPaths: ['05 Skills/Métodos', '05 Skills', '03 Projects/Héstia/05 Skills'],
	allowedGitHubRepos: [],
	doclingServiceUrl: '',
	doclingSecretName: '',
	hermesServiceUrl: '',
	hermesSecretName: '',
	enableHermesAutoRouting: false,
	mcpServers: [],
};

function splitLines(value: string): string[] { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }

export class SovereignRouterSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: SovereignRouterPlugin) { super(app, plugin); }

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('p', { text: 'Messages and selected skills are sent to OpenRouter only when you send a chat message. Attached documents are sent to the configured Docling service. No conversation or document is saved by this plugin.' });
		new Setting(containerEl).setName('OpenRouter API key').setDesc('Choose or create a secret. The plugin stores only its reference in data.json.').addComponent((component) => {
			const secretComponent = new SecretComponent(this.app, component).setValue(this.plugin.settings.openRouterSecretName);
			secretComponent.onChange(async (value) => {
				this.plugin.settings.openRouterSecretName = value;
				await this.plugin.saveSettings();
			});
			return secretComponent;
		});
		this.addTextSetting('Gatekeeper model', 'Classifies a request and chooses the executor.', this.plugin.settings.gatekeeperModel, async (value) => { this.plugin.settings.gatekeeperModel = value; });
		this.addTextSetting('Default executor model', 'Used when the Gatekeeper cannot provide a permitted route.', this.plugin.settings.defaultExecutorModel, async (value) => { this.plugin.settings.defaultExecutorModel = value; });
		this.addTextAreaSetting('Permitted executor models', 'One OpenRouter model slug per line. The Gatekeeper cannot select a model outside this list.', this.plugin.settings.permittedExecutorModels.join('\n'), async (value) => { this.plugin.settings.permittedExecutorModels = splitLines(value); });
		this.addTextAreaSetting('Manual-only models', 'One OpenRouter model slug per line. These appear in the chat selector but are never selected automatically by the Gatekeeper.', this.plugin.settings.customModelSlugs.join('\n'), async (value) => { this.plugin.settings.customModelSlugs = splitLines(value); });
		new Setting(containerEl).setName('Model catalog').setHeading();
		const catalog = this.plugin.settings.modelCatalog;
		const catalogDescription = catalog
			? `${catalog.models.length} models cached from OpenRouter on ${new Date(catalog.fetchedAt).toLocaleString()}. Prices are reference prices only; response FinOps continues to use OpenRouter usage.cost.`
			: 'No catalog has been downloaded yet. Downloading it does not allow any model to be routed automatically.';
		new Setting(containerEl).setName('OpenRouter model catalog').setDesc(catalogDescription).addButton((button) => button.setButtonText('Refresh catalog').onClick(async () => {
			try {
				await this.plugin.refreshModelCatalog();
				new Notice('OpenRouter model catalog updated.');
				this.display();
			} catch (error) {
				new Notice(error instanceof Error ? error.message : 'Could not refresh the OpenRouter model catalog.');
			}
		}));
		this.addTextSetting('Catalog refresh interval (days)', 'The plugin refreshes when it is open and the cache is older than this interval. Use the included Hermes job for unattended refreshes.', String(this.plugin.settings.modelCatalogRefreshDays), async (value) => {
			const days = Number.parseInt(value, 10);
			this.plugin.settings.modelCatalogRefreshDays = Number.isFinite(days) && days > 0 ? days : 15;
		});
		this.addTextAreaSetting('Routing instruction', 'Additional instruction for the Gatekeeper. It must still return the plugin JSON contract.', this.plugin.settings.routingInstruction, async (value) => { this.plugin.settings.routingInstruction = value.trim(); });
		this.addTextAreaSetting('Local skill folders', 'Vault-relative folders searched in order, one per line.', this.plugin.settings.skillSearchPaths.join('\n'), async (value) => { this.plugin.settings.skillSearchPaths = splitLines(value); });
		this.addTextAreaSetting('Allowed GitHub repositories', 'One owner/repository pair per line. Remote skills from any other repository are rejected.', this.plugin.settings.allowedGitHubRepos.join('\n'), async (value) => { this.plugin.settings.allowedGitHubRepos = splitLines(value); });
		new Setting(containerEl).setName('Document conversion (Docling)').setHeading();
		this.addTextSetting('Docling service URL', 'Optional. Enter the URL of your docling-serve instance, such as http://localhost:5001.', this.plugin.settings.doclingServiceUrl, async (value) => { this.plugin.settings.doclingServiceUrl = value.replace(/\/$/, ''); });
		new Setting(containerEl).setName('Docling API key').setDesc('Optional. Choose the secret required by your Docling service. The plugin stores only its reference.').addComponent((component) => {
			const secretComponent = new SecretComponent(this.app, component).setValue(this.plugin.settings.doclingSecretName);
			secretComponent.onChange(async (value) => {
				this.plugin.settings.doclingSecretName = value;
				await this.plugin.saveSettings();
			});
			return secretComponent;
		});
		new Setting(containerEl).setName('Hermes Agent runtime').setHeading();
		containerEl.createEl('p', { text: 'Optional. A Hermes API server can run terminal, agent, subprocess and local MCP work outside Obsidian. This plugin never starts Hermes or a terminal itself.' });
		this.addTextSetting('Hermes API URL', 'The Hermes API server URL, normally a loopback or HTTPS address. The API key is required even on localhost.', this.plugin.settings.hermesServiceUrl, async (value) => { this.plugin.settings.hermesServiceUrl = value.replace(/\/$/, ''); });
		new Setting(containerEl).setName('Hermes API key').setDesc('Choose the Hermes API secret. The plugin stores only this reference.').addComponent((component) => {
			const secretComponent = new SecretComponent(this.app, component).setValue(this.plugin.settings.hermesSecretName);
			secretComponent.onChange(async (value) => {
				this.plugin.settings.hermesSecretName = value;
				await this.plugin.saveSettings();
			});
			return secretComponent;
		});
		new Setting(containerEl).setName('Allow automatic Hermes routing').setDesc('Lets the Gatekeeper route suitable tasks to Hermes when its API is configured. Manual runtime selection always wins.').addToggle((toggle) => toggle.setValue(this.plugin.settings.enableHermesAutoRouting).onChange(async (value) => {
			this.plugin.settings.enableHermesAutoRouting = value;
			await this.plugin.saveSettings();
		}));
		new Setting(containerEl).setName('Automatic vault context').setHeading();
		containerEl.createEl('p', { text: 'The current vault is indexed locally after Obsidian loads. The Gatekeeper can request relevant context after routing; only those excerpts are sent to OpenRouter. Documents attached through Docling are added to the local context library automatically.' });
		new Setting(containerEl).setName('Clear stored external documents').setDesc('Deletes only the converted document cache. Vault files remain in the local index and are always read from their current vault version.').addButton((button) => button.setWarning().setButtonText('Clear cache').onClick(async () => {
			await this.plugin.contextIndex.clearExternalDocuments();
		}));
		new Setting(containerEl).setName('MCP connections').setHeading();
		containerEl.createEl('p', { text: 'Connect remote MCP servers over Streamable HTTP. Read-only tools can be used in chat. Write tools stay disabled until you explicitly enable them and confirm each call.' });
		new Setting(containerEl).setName('Add MCP connection').setDesc('Use HTTPS. HTTP is accepted only for localhost.').addButton((button) => button.setButtonText('Add connection').onClick(async () => {
			this.plugin.settings.mcpServers.push(createMcpServer());
			await this.plugin.saveSettings();
			this.display();
		}));
		for (const server of this.plugin.settings.mcpServers) this.addMcpServerSettings(server);
	}

	private addMcpServerSettings(server: McpServerConfig): void {
		const heading = new Setting(this.containerEl).setName(server.name || 'MCP connection').setHeading().settingEl;
		heading.addClass('sr-settings-mcp-heading');
		this.addTextSetting('Connection name', 'A local label for this MCP server.', server.name, async (value) => { server.name = value || 'MCP connection'; });
		this.addTextSetting('MCP URL', 'The server Streamable HTTP endpoint.', server.url, async (value) => { server.url = value.replace(/\/$/, ''); });
		new Setting(this.containerEl).setName('MCP API key').setDesc('Optional. The plugin stores only this secret reference.').addComponent((component) => {
			const secretComponent = new SecretComponent(this.app, component).setValue(server.secretName);
			secretComponent.onChange(async (value) => {
				server.secretName = value;
				await this.plugin.saveSettings();
			});
			return secretComponent;
		});
		new Setting(this.containerEl).setName('Enable connection').setDesc(isAllowedMcpEndpoint(server.url) || !server.url ? 'Allow this server to expose its tools to the chat panel.' : 'Invalid URL: use HTTPS or HTTP only on localhost.').addToggle((toggle) => toggle.setValue(server.enabled).onChange(async (value) => {
			server.enabled = value;
			await this.plugin.saveSettings();
		}));
		new Setting(this.containerEl).setName('Allow write tools').setDesc('Requires a confirmation for every tool call. Keep disabled unless this server is trusted.').addToggle((toggle) => toggle.setValue(server.allowWriteTools).onChange(async (value) => {
			server.allowWriteTools = value;
			await this.plugin.saveSettings();
		}));
		new Setting(this.containerEl).setName('Remove connection').setDesc('Removes this connection configuration, not the remote MCP server.').addButton((button) => button.setWarning().setButtonText('Remove').onClick(async () => {
			this.plugin.settings.mcpServers = this.plugin.settings.mcpServers.filter((item) => item.id !== server.id);
			await this.plugin.saveSettings();
			this.display();
		}));
	}

	private addTextSetting(name: string, description: string, value: string, onChange: (value: string) => Promise<void>): void {
		new Setting(this.containerEl).setName(name).setDesc(description).addText((text) => text.setValue(value).onChange(async (newValue) => { await onChange(newValue.trim()); await this.plugin.saveSettings(); }));
	}
	private addTextAreaSetting(name: string, description: string, value: string, onChange: (value: string) => Promise<void>): void {
		new Setting(this.containerEl).setName(name).setDesc(description).addTextArea((text) => text.setValue(value).onChange(async (newValue) => { await onChange(newValue); await this.plugin.saveSettings(); }));
	}
}

function createMcpServer(): McpServerConfig {
	return {
		id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `mcp-${Date.now()}`,
		name: 'New MCP connection',
		url: '',
		secretName: '',
		enabled: false,
		allowWriteTools: false,
	};
}
