import { Notice, Plugin, requestUrl } from 'obsidian';
import { DEFAULT_EXECUTOR_MODELS } from './models';
import { fetchOpenRouterModelCatalog, isCatalogFresh } from './model-catalog';
import { DEFAULT_SETTINGS, SovereignRouterSettingTab, SovereignRouterSettings } from './settings';
import { SovereignRouterView, VIEW_TYPE_SOVEREIGN_ROUTER } from './ui/chat-view';
import { VaultContextIndex } from './vault-context-index';

export default class SovereignRouterPlugin extends Plugin {
	settings!: SovereignRouterSettings;
	contextIndex!: VaultContextIndex;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.contextIndex = new VaultContextIndex(this.app, this.manifest);
		this.app.workspace.onLayoutReady(() => {
			void this.contextIndex.start();
			this.registerEvent(this.app.vault.on('create', (file) => this.contextIndex.onVaultFileChanged(file)));
			this.registerEvent(this.app.vault.on('modify', (file) => this.contextIndex.onVaultFileChanged(file)));
			this.registerEvent(this.app.vault.on('delete', (file) => this.contextIndex.onVaultFileDeleted(file)));
			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.contextIndex.onVaultFileRenamed(file, oldPath)));
		});

		this.registerView(
			VIEW_TYPE_SOVEREIGN_ROUTER,
			(leaf) => new SovereignRouterView(leaf, this),
		);

		this.addRibbonIcon('bot', 'Open Sovereign Router', () => {
			void this.activateChatView();
		});
		this.addCommand({
			id: 'open-chat',
			name: 'Open chat',
			callback: () => void this.activateChatView(),
		});
		this.addSettingTab(new SovereignRouterSettingTab(this.app, this));
		void this.refreshModelCatalogIfDue();
	}

	onunload(): void {
		this.contextIndex.dispose();
	}

	async loadSettings(): Promise<void> {
		const savedSettings = (await this.loadData()) as Partial<SovereignRouterSettings>;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			savedSettings,
		);
		if (savedSettings.modelCatalogVersion === undefined) {
			this.settings.permittedExecutorModels = Array.from(
				new Set([...DEFAULT_EXECUTOR_MODELS, ...(savedSettings.permittedExecutorModels ?? [])]),
			);
			this.settings.modelCatalogVersion = 1;
			await this.saveSettings();
		}
		this.settings.customModelSlugs = this.settings.customModelSlugs ?? [];
		this.settings.modelCatalog = this.settings.modelCatalog ?? null;
		this.settings.modelCatalogRefreshDays = Math.max(1, this.settings.modelCatalogRefreshDays || 15);
		this.settings.hermesServiceUrl = this.settings.hermesServiceUrl ?? '';
		this.settings.hermesSecretName = this.settings.hermesSecretName ?? '';
		this.settings.enableHermesAutoRouting = this.settings.enableHermesAutoRouting ?? false;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	manualModelOptions(): string[] {
		return Array.from(new Set([...this.settings.permittedExecutorModels, ...this.settings.customModelSlugs]));
	}

	async refreshModelCatalog(): Promise<void> {
		const secretName = this.settings.openRouterSecretName;
		const apiKey = secretName ? this.app.secretStorage.getSecret(secretName) : null;
		if (!apiKey) throw new Error('Select an OpenRouter API key before refreshing the model catalog.');
		this.settings.modelCatalog = await fetchOpenRouterModelCatalog(apiKey, async (url, headers) => requestUrl({ url, method: 'GET', headers, throw: false }));
		await this.saveSettings();
	}

	private async refreshModelCatalogIfDue(): Promise<void> {
		if (isCatalogFresh(this.settings.modelCatalog, this.settings.modelCatalogRefreshDays)) return;
		try {
			await this.refreshModelCatalog();
		} catch (_error) {
			// A catalog refresh is opportunistic; chat remains usable offline or without a key.
		}
	}

	private async activateChatView(): Promise<void> {
		const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SOVEREIGN_ROUTER)[0];
		const leaf = existingLeaf ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice('Could not open the Sovereign Router panel.');
			return;
		}

		await leaf.setViewState({ type: VIEW_TYPE_SOVEREIGN_ROUTER, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}
}
