import { App, Modal, Notice, Setting } from 'obsidian';
import { HermesClient, HermesError, type HermesJob, type HermesJobAction, type HermesRuntimeStatus } from '../hermes';
import { hermesProviderOverrideError } from '../hermes-policy';
import type SovereignRouterPlugin from '../main';
import { confirmHermesJobAction, openCreateHermesJobModal, openEditHermesJobModal } from './hermes-job-modals';

function formatDate(value: string | number | null): string {
	if (!value) return 'Not available';
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatError(error: unknown): string {
	if (error instanceof HermesError) return error.message;
	return error instanceof Error ? error.message : 'The operation could not be completed.';
}

function hasSecret(app: App, secretName: string): boolean {
	return Boolean(secretName && app.secretStorage.getSecret(secretName));
}

export function openControlCenter(app: App, plugin: SovereignRouterPlugin): void {
	new ControlCenterModal(app, plugin).open();
}

class ControlCenterModal extends Modal {
	private jobs: HermesJob[] | null = null;
	private jobsError: string | null = null;
	private loadingJobs = false;
	private runtimeStatus: HermesRuntimeStatus | null = null;
	private runtimeError: string | null = null;
	private checkingRuntime = false;

	constructor(app: App, private readonly plugin: SovereignRouterPlugin) { super(app); }

	onOpen(): void {
		this.titleEl.setText('Sovereign control center');
		void this.render();
	}

	private async render(): Promise<void> {
		this.contentEl.empty();
		const context = await this.plugin.contextIndex.getStatus();
		const catalog = this.plugin.settings.modelCatalog;
		const metrics = this.plugin.operationalMetrics.snapshot();
		const mcpServers = this.plugin.settings.mcpServers;
		const openRouterReady = hasSecret(this.app, this.plugin.settings.openRouterSecretName);
		const hermesReady = Boolean(this.plugin.settings.hermesServiceUrl) && hasSecret(this.app, this.plugin.settings.hermesSecretName);

		this.contentEl.createEl('p', { text: 'This panel governs routing, context, connections, and Hermes automations. It does not run a terminal inside Obsidian.' });
		const status = this.contentEl.createDiv({ cls: 'sr-control-status' });
		this.statusCard(status, 'OpenRouter', openRouterReady ? 'Key selected' : 'API key required', openRouterReady);
		const hermesLabel = !hermesReady
			? 'Not configured'
			: this.runtimeError
				? 'Connection failed'
				: this.runtimeStatus
					? `Connected · jobs ${this.runtimeStatus.jobsSupported === true ? 'supported' : this.runtimeStatus.jobsSupported === false ? 'unavailable' : 'not advertised'}`
					: 'Configured';
		this.statusCard(status, 'Hermes runtime', hermesLabel, hermesReady && !this.runtimeError);
		this.statusCard(status, 'Vault context', `${context.vaultEntries} files${context.isIndexing ? ' · indexing' : ''}`, true);
		this.statusCard(status, 'External documents', `${context.externalEntries} cached`, true);
		this.statusCard(status, 'MCP connections', `${mcpServers.filter((server) => server.enabled).length} enabled · ${mcpServers.filter((server) => server.enabled && server.allowWriteTools).length} write-enabled`, true);
		this.statusCard(status, 'Hermes policy', `${this.plugin.settings.hermesPermittedProviderOverrides.length} permitted provider overrides`, true);
		this.statusCard(status, 'OpenRouter FinOps', `${metrics.directResponses} responses · $${metrics.directCostUsd.toFixed(6)} this plugin session`, true);
		this.statusCard(status, 'Model catalog', catalog ? `${catalog.models.length} models · ${formatDate(catalog.fetchedAt)}` : 'Not downloaded', Boolean(catalog));

		new Setting(this.contentEl)
			.setName('Model catalog')
			.setDesc('Refreshes reference model metadata. This never changes the permitted routing list.')
			.addButton((button) => button.setButtonText('Refresh catalog').setDisabled(!openRouterReady).onClick(async () => {
				try {
					button.setDisabled(true).setButtonText('Refreshing...');
					await this.plugin.refreshModelCatalog();
					new Notice('Model catalog updated.');
					await this.render();
				} catch (error) {
					new Notice(formatError(error));
					button.setDisabled(false).setButtonText('Refresh catalog');
				}
			}));
		new Setting(this.contentEl)
			.setName('Hermes runtime')
			.setDesc(this.runtimeError ? `Last check failed: ${this.runtimeError}` : 'Checks the configured Hermes API without running an agent or an automation.')
			.addButton((button) => button.setButtonText(this.checkingRuntime ? 'Checking...' : 'Test connection').setDisabled(!hermesReady || this.checkingRuntime).onClick(() => void this.checkRuntime()));

		new Setting(this.contentEl)
			.setName('Policies and connections')
			.setDesc('Configure permitted models, skills, MCP servers, secrets, and Hermes routing in the plugin settings.')
			.addButton((button) => button.setButtonText('Show location').onClick(() => {
				this.plugin.openSettings();
			}));
		new Setting(this.contentEl)
			.setName('Automatic Hermes routing')
			.setDesc('Allow the Gatekeeper to select Hermes only for execution-oriented tasks. Manual runtime selection still takes priority.')
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.enableHermesAutoRouting).onChange(async (enabled) => {
				this.plugin.settings.enableHermesAutoRouting = enabled;
				await this.plugin.saveSettings();
			}));
		new Setting(this.contentEl)
			.setName('External context cache')
			.setDesc('Removes converted external documents only. Vault files and the vault index remain unchanged.')
			.addButton((button) => button.setWarning().setButtonText('Clear external cache').onClick(async () => {
				await this.plugin.contextIndex.clearExternalDocuments();
				new Notice('External document cache cleared.');
				await this.render();
			}));

		this.renderJobs(hermesReady);
	}

	private statusCard(container: HTMLElement, label: string, value: string, ready: boolean): void {
		const card = container.createDiv({ cls: 'sr-control-card' });
		card.createDiv({ text: label, cls: 'sr-control-label' });
		card.createDiv({ text: value, cls: ready ? 'sr-control-value is-ready' : 'sr-control-value is-warning' });
	}

	private renderJobs(hermesReady: boolean): void {
		const section = this.contentEl.createDiv({ cls: 'sr-control-jobs' });
		section.createEl('h3', { text: 'Hermes automations' });
		if (!hermesReady) {
			section.createEl('p', { text: 'Configure the Hermes URL and API key to inspect scheduled jobs.' });
			return;
		}
		if (this.runtimeStatus?.jobsSupported === false) {
			section.createEl('p', { text: 'This Hermes API reports that scheduled jobs are unavailable. Update or reconfigure Hermes before managing automations here.' });
			return;
		}
		const actions = section.createDiv({ cls: 'sr-control-job-actions' });
		const refresh = actions.createEl('button', { text: this.loadingJobs ? 'Loading...' : 'Refresh jobs' });
		const create = actions.createEl('button', { text: 'New automation' });
		refresh.disabled = this.loadingJobs;
		refresh.addEventListener('click', () => void this.loadJobs());
		create.addEventListener('click', () => this.openCreateJob());
		if (this.jobsError) section.createEl('p', { text: this.jobsError, cls: 'sr-control-error' });
		if (this.jobs === null) {
			section.createEl('p', { text: this.loadingJobs ? 'Loading Hermes jobs...' : 'Select Refresh jobs to load the Hermes schedule.' });
			return;
		}
		if (this.jobs.length === 0) {
			section.createEl('p', { text: 'No Hermes jobs were returned.' });
			return;
		}
		for (const job of this.jobs) this.renderJob(section, job);
	}

	private renderJob(container: HTMLElement, job: HermesJob): void {
		const row = container.createDiv({ cls: 'sr-control-job' });
		row.createEl('strong', { text: job.name });
		row.createDiv({ text: `Schedule: ${job.schedule}` });
		if (job.model || job.provider || job.skills.length) row.createDiv({ text: `Runtime: ${job.provider || 'runtime default'}${job.model ? ` · reported model: ${job.model}` : ''}${job.skills.length ? ` · Skills: ${job.skills.join(', ')}` : ''}`, cls: 'sr-control-job-meta' });
		row.createDiv({ text: `Status: ${job.status} · Last: ${formatDate(job.lastRunAt)} · Next: ${formatDate(job.nextRunAt)}`, cls: 'sr-control-job-meta' });
		const actions = row.createDiv({ cls: 'sr-control-job-actions' });
		const run = actions.createEl('button', { text: 'Run now' });
		const edit = actions.createEl('button', { text: 'Edit' });
		const stateAction: HermesJobAction = job.status.toLowerCase() === 'paused' ? 'resume' : 'pause';
		const stateButton = actions.createEl('button', { text: stateAction === 'pause' ? 'Pause' : 'Resume' });
		const remove = actions.createEl('button', { text: 'Delete', cls: 'mod-warning' });
		run.addEventListener('click', () => void this.confirmJobAction(job, 'run'));
		edit.addEventListener('click', () => this.openEditJob(job));
		stateButton.addEventListener('click', () => void this.confirmJobAction(job, stateAction));
		remove.addEventListener('click', () => void this.confirmJobAction(job, 'delete'));
	}

	private async loadJobs(): Promise<void> {
		const client = this.hermesClient();
		if (!client) return;
		this.loadingJobs = true;
		this.jobsError = null;
		await this.render();
		try {
			this.jobs = await client.listJobs();
		} catch (error) {
			this.jobs = null;
			this.jobsError = `Could not load Hermes jobs: ${formatError(error)}`;
		} finally {
			this.loadingJobs = false;
			await this.render();
		}
	}

	private async checkRuntime(): Promise<void> {
		const client = this.hermesClient();
		if (!client) return;
		this.checkingRuntime = true;
		this.runtimeError = null;
		await this.render();
		try {
			this.runtimeStatus = await client.inspectRuntime();
			new Notice('Hermes runtime is reachable.');
		} catch (error) {
			this.runtimeStatus = null;
			this.runtimeError = formatError(error);
		} finally {
			this.checkingRuntime = false;
			await this.render();
		}
	}

	private async confirmJobAction(job: HermesJob, action: HermesJobAction | 'delete'): Promise<void> {
		const approved = await confirmHermesJobAction(this.app, job, action);
		if (!approved) return;
		const client = this.hermesClient();
		if (!client) return;
		try {
			if (action === 'delete') await client.deleteJob(job.id);
			else await client.runJobAction(job.id, action);
			new Notice(`Hermes job ${action} requested.`);
			await this.loadJobs();
		} catch (error) {
			new Notice(`Could not ${action} Hermes job: ${formatError(error)}`);
		}
	}

	private openCreateJob(): void {
		openCreateHermesJobModal(this.app, (provider) => this.providerOverrideError(provider), async (input) => {
			const client = this.hermesClient();
			if (!client) return false;
			try {
				await client.createJob(input);
				new Notice('Hermes automation created. Review its first run before relying on its schedule.');
				await this.loadJobs();
				return true;
			} catch (error) {
				new Notice(`Could not create Hermes automation: ${formatError(error)}`);
				return false;
			}
		});
	}

	private openEditJob(job: HermesJob): void {
		openEditHermesJobModal(this.app, job, (provider) => this.providerOverrideError(provider), async (input) => {
			const client = this.hermesClient();
			if (!client) return false;
			try {
				await client.updateJob(job.id, input);
				new Notice('Hermes automation updated.');
				await this.loadJobs();
				return true;
			} catch (error) {
				new Notice(`Could not update Hermes automation: ${formatError(error)}`);
				return false;
			}
		});
	}

	private hermesClient(): HermesClient | null {
		const secretName = this.plugin.settings.hermesSecretName;
		const key = secretName ? this.app.secretStorage.getSecret(secretName) : null;
		if (!key || !this.plugin.settings.hermesServiceUrl) {
			new Notice('Configure the Hermes URL and API key first.');
			return null;
		}
		try {
			return new HermesClient(this.plugin.settings.hermesServiceUrl, key);
		} catch (error) {
			new Notice(formatError(error));
			return null;
		}
	}

	private providerOverrideError(provider: string | null | undefined): string | null {
		return hermesProviderOverrideError(provider, this.plugin.settings.hermesPermittedProviderOverrides);
	}
}
