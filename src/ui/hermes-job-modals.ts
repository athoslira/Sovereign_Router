import { App, Modal, Notice, Setting } from 'obsidian';
import type { CreateHermesJobInput, HermesJob, HermesJobAction, UpdateHermesJobInput } from '../hermes';

export type HermesJobControlAction = HermesJobAction | 'delete';
export type HermesProviderOverrideValidator = (provider: string | null | undefined) => string | null;

export function confirmHermesJobAction(app: App, job: HermesJob, action: HermesJobControlAction): Promise<boolean> {
	return new Promise((resolve) => new HermesJobConfirmationModal(app, job, action, resolve).open());
}

export function openCreateHermesJobModal(app: App, validateProviderOverride: HermesProviderOverrideValidator, create: (input: CreateHermesJobInput) => Promise<boolean>): void {
	new CreateHermesJobModal(app, validateProviderOverride, create).open();
}

export function openEditHermesJobModal(app: App, job: HermesJob, validateProviderOverride: HermesProviderOverrideValidator, update: (input: UpdateHermesJobInput) => Promise<boolean>): void {
	new EditHermesJobModal(app, job, validateProviderOverride, update).open();
}

class HermesJobConfirmationModal extends Modal {
	private answered = false;
	constructor(app: App, private readonly job: HermesJob, private readonly action: HermesJobControlAction, private readonly resolve: (approved: boolean) => void) { super(app); }

	onOpen(): void {
		this.titleEl.setText('Confirm Hermes automation action');
		this.contentEl.createEl('p', { text: `Request ${this.action} for “${this.job.name}”?` });
		this.contentEl.createEl('p', { text: 'The action is executed by Hermes under its own approval and security policies.' });
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = buttons.createEl('button', { text: 'Cancel' });
		const confirm = buttons.createEl('button', { text: this.action === 'run' ? 'Run now' : this.action === 'pause' ? 'Pause job' : this.action === 'resume' ? 'Resume job' : 'Delete job', cls: 'mod-warning' });
		cancel.addEventListener('click', () => this.answer(false));
		confirm.addEventListener('click', () => this.answer(true));
	}

	onClose(): void {
		if (!this.answered) this.answer(false);
		this.contentEl.empty();
	}

	private answer(approved: boolean): void {
		if (this.answered) return;
		this.answered = true;
		this.resolve(approved);
		this.close();
	}
}

class CreateHermesJobModal extends Modal {
	private nameInput!: HTMLInputElement;
	private scheduleInput!: HTMLInputElement;
	private promptInput!: HTMLTextAreaElement;
	private providerInput!: HTMLInputElement;
	private skillsInput!: HTMLTextAreaElement;
	constructor(app: App, private readonly validateProviderOverride: HermesProviderOverrideValidator, private readonly create: (input: CreateHermesJobInput) => Promise<boolean>) { super(app); }

	onOpen(): void {
		this.titleEl.setText('New Hermes automation');
		this.contentEl.createEl('p', { text: 'Create only self-contained jobs with an explicit output, source policy, and safe write location. The prompt is sent to Hermes and is not stored by Sovereign Router.' });
		new Setting(this.contentEl).setName('Name').setDesc('A short operational label.').addText((text) => { this.nameInput = text.inputEl; text.setPlaceholder('Model catalog refresh'); });
		new Setting(this.contentEl).setName('Schedule').setDesc('Cron expression understood by Hermes.').addText((text) => { this.scheduleInput = text.inputEl; text.setValue('0 */6 * * *'); });
		const prompt = this.contentEl.createDiv({ cls: 'setting-item' });
		prompt.createDiv({ text: 'Self-contained prompt', cls: 'setting-item-name' });
		prompt.createDiv({ text: 'Include task, allowed sources/tools, output path, validation, and stop condition.', cls: 'setting-item-description' });
		this.promptInput = prompt.createEl('textarea', { cls: 'sr-control-prompt', attr: { rows: '8', placeholder: 'Research approved sources, validate the result, and write only to the authorized data path.' } });
		this.addOverrideFields();
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = buttons.createEl('button', { text: 'Cancel' });
		const submit = buttons.createEl('button', { text: 'Create automation', cls: 'mod-cta' });
		cancel.addEventListener('click', () => this.close());
		submit.addEventListener('click', () => void this.submit());
	}

	private addOverrideFields(): void {
		new Setting(this.contentEl).setName('Provider override').setDesc('Optional. Use only a provider profile configured in Hermes.').addText((text) => { this.providerInput = text.inputEl; });
		const skills = this.contentEl.createDiv({ cls: 'setting-item' });
		skills.createDiv({ text: 'Hermes skills', cls: 'setting-item-name' });
		skills.createDiv({ text: 'Optional, one Hermes skill identifier per line.', cls: 'setting-item-description' });
		this.skillsInput = skills.createEl('textarea', { cls: 'sr-control-prompt', attr: { rows: '3' } });
	}

	private async submit(): Promise<void> {
		const prompt = this.promptInput.value.trim();
		const schedule = this.scheduleInput.value.trim();
		if (!prompt || !schedule) return void new Notice('A schedule and a self-contained prompt are required.');
		const provider = this.providerInput.value.trim();
		const overrideError = this.validateProviderOverride(provider || null);
		if (overrideError) return void new Notice(overrideError);
		const skills = lines(this.skillsInput.value);
		const input: CreateHermesJobInput = { name: this.nameInput.value.trim() || 'Sovereign automation', schedule, prompt, ...(provider ? { provider } : {}), ...(skills.length ? { skills } : {}) };
		if (await this.create(input)) this.close();
	}

	onClose(): void { this.contentEl.empty(); }
}

class EditHermesJobModal extends Modal {
	private nameInput!: HTMLInputElement;
	private scheduleInput!: HTMLInputElement;
	private providerInput!: HTMLInputElement;
	private skillsInput!: HTMLTextAreaElement;
	constructor(app: App, private readonly job: HermesJob, private readonly validateProviderOverride: HermesProviderOverrideValidator, private readonly update: (input: UpdateHermesJobInput) => Promise<boolean>) { super(app); }

	onOpen(): void {
		this.titleEl.setText('Edit Hermes automation');
		this.contentEl.createEl('p', { text: 'Update the schedule and runtime overrides. The original job prompt is intentionally not loaded or stored by Sovereign Router.' });
		new Setting(this.contentEl).setName('Name').addText((text) => { this.nameInput = text.inputEl; text.setValue(this.job.name); });
		new Setting(this.contentEl).setName('Schedule').setDesc('Cron expression understood by Hermes.').addText((text) => { this.scheduleInput = text.inputEl; text.setValue(this.job.schedule); });
		new Setting(this.contentEl).setName('Provider override').setDesc('Clear to return to the Hermes runtime default.').addText((text) => { this.providerInput = text.inputEl; text.setValue(this.job.provider || ''); });
		const skills = this.contentEl.createDiv({ cls: 'setting-item' });
		skills.createDiv({ text: 'Hermes skills', cls: 'setting-item-name' });
		skills.createDiv({ text: 'One identifier per line. Clearing the field removes all job skills.', cls: 'setting-item-description' });
		this.skillsInput = skills.createEl('textarea', { cls: 'sr-control-prompt', attr: { rows: '3' } });
		this.skillsInput.value = this.job.skills.join('\n');
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = buttons.createEl('button', { text: 'Cancel' });
		const submit = buttons.createEl('button', { text: 'Save changes', cls: 'mod-cta' });
		cancel.addEventListener('click', () => this.close());
		submit.addEventListener('click', () => void this.submit());
	}

	private async submit(): Promise<void> {
		const name = this.nameInput.value.trim();
		const schedule = this.scheduleInput.value.trim();
		if (!name || !schedule) return void new Notice('A name and schedule are required.');
		const provider = this.providerInput.value.trim() || null;
		const overrideError = this.validateProviderOverride(provider);
		if (overrideError) return void new Notice(overrideError);
		const input: UpdateHermesJobInput = { name, schedule, provider, skills: lines(this.skillsInput.value) };
		if (await this.update(input)) this.close();
	}

	onClose(): void { this.contentEl.empty(); }
}

function lines(value: string): string[] {
	return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
