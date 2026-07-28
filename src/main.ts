import { Notice, Plugin, requestUrl } from 'obsidian';
import { DEFAULT_EXECUTOR_MODELS } from './models';
import { DEFAULT_HERMES_MODEL_ALIAS, DEFAULT_HERMES_MODEL_ROUTES } from './hermes-models';
import { fetchOpenRouterModelCatalog, isCatalogFresh } from './model-catalog';
import { DEFAULT_SETTINGS, SovereignRouterSettingTab, SovereignRouterSettings } from './settings';
import { OperationalMetrics } from './operational-metrics';
import { SovereignRouterView, VIEW_TYPE_SOVEREIGN_ROUTER } from './ui/chat-view';
import { openControlCenter } from './ui/control-center-modal';
import { VaultContextIndex } from './vault-context-index';
import { LocalContextStore } from './local-context-store';

export default class SovereignRouterPlugin extends Plugin {
	settings!: SovereignRouterSettings;
	contextIndex!: VaultContextIndex;
	localContext!: LocalContextStore;
	readonly operationalMetrics = new OperationalMetrics();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.contextIndex = new VaultContextIndex(this.app, this.manifest);
		this.localContext = new LocalContextStore(this.app, this.manifest);
		try {
			await this.localContext.start();
		} catch {
			new Notice('Local context storage is unavailable. Chat remains available, but sessions will not persist.');
		}
		this.app.workspace.onLayoutReady(() => {
			void this.contextIndex.start();
			this.registerEvent(this.app.vault.on('create', (file) => this.contextIndex.onVaultFileChanged(file)));
			this.registerEvent(this.app.vault.on('modify', (file) => this.contextIndex.onVaultFileChanged(file)));
			this.registerEvent(this.app.vault.on('delete', (file) => { this.contextIndex.onVaultFileDeleted(file); void this.localContext.markVaultSourceNeedsReview(file.path); }));
			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { this.contextIndex.onVaultFileRenamed(file, oldPath); void this.localContext.markVaultSourceNeedsReview(oldPath); }));
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
		this.addCommand({
			id: 'open-control-center',
			name: 'Open control center',
			callback: () => openControlCenter(this.app, this),
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
		this.settings.hermesModelRoutes = this.settings.hermesModelRoutes?.length ? this.settings.hermesModelRoutes : DEFAULT_HERMES_MODEL_ROUTES.map((route) => ({ ...route }));
		this.settings.hermesDefaultModelAlias = this.settings.hermesDefaultModelAlias ?? DEFAULT_HERMES_MODEL_ALIAS;
		this.settings.hermesPermittedProviderOverrides = this.settings.hermesPermittedProviderOverrides ?? [];
		this.settings.graphifyGraphPath = this.settings.graphifyGraphPath ?? '.sovereign-router/graphify-out/graph.json';
		this.settings.localContextSummaryBudget = Math.max(1_000, this.settings.localContextSummaryBudget ?? 6_000);
		this.settings.localContextMemoryBudget = Math.max(1_000, this.settings.localContextMemoryBudget ?? 4_000);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	openSettings(): void {
		const settings = (this.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
		if (!settings?.open || !settings.openTabById) {
			new Notice('Open Settings → Sovereign Router to change policies and connections.');
			return;
		}
		settings.open();
		settings.openTabById(this.manifest.id);
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
		} catch {
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
