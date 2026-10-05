import { App, Modal, Setting } from 'obsidian';
import type { HubTaskKind } from '../agent-kernel';

export interface HubTaskInput { title: string; kind: HubTaskKind; summary: string; }
export interface HubVerificationInput { verdict: 'pass' | 'fail'; evidenceSummary: string; }

export function openCreateHubTaskModal(app: App, onSubmit: (input: HubTaskInput) => Promise<boolean>): void {
	new CreateHubTaskModal(app, onSubmit).open();
}

export function openHubVerificationModal(app: App, onSubmit: (input: HubVerificationInput) => Promise<boolean>): void {
	new HubVerificationModal(app, onSubmit).open();
}

class CreateHubTaskModal extends Modal {
	private title = '';
	private summary = '';
	private kind: HubTaskKind = 'general';

	constructor(app: App, private readonly onSubmit: (input: HubTaskInput) => Promise<boolean>) { super(app); }

	onOpen(): void {
		this.titleEl.setText('New Hub task');
		this.contentEl.createEl('p', { text: 'Create a durable task record. Do not put credentials, private source text, or raw commands in its summary.' });
		new Setting(this.contentEl).setName('Title').setDesc('Short, human-readable task label.').addText((text) => text.setPlaceholder('Improve model routing').onChange((value) => { this.title = value.trim(); }));
		new Setting(this.contentEl).setName('Kind').setDesc('Used by the Hub to classify the execution.').addDropdown((dropdown) => {
			for (const [value, label] of Object.entries({ general: 'General', research: 'Research', code: 'Code', automation: 'Automation', media: 'Media', analysis: 'Analysis' })) dropdown.addOption(value, label);
			dropdown.setValue(this.kind).onChange((value) => { this.kind = value as HubTaskKind; });
		});
		new Setting(this.contentEl).setName('Safe summary').setDesc('Optional persisted metadata, limited to the non-secret scope of the work.').addTextArea((text) => text.setPlaceholder('Expected outcome and boundary').onChange((value) => { this.summary = value.trim(); }));
		const actions = this.contentEl.createDiv({ cls: 'sr-control-job-actions' });
		const create = actions.createEl('button', { text: 'Create task', cls: 'mod-cta' });
		actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		create.addEventListener('click', () => void this.submit(create));
	}

	private async submit(button: HTMLButtonElement): Promise<void> {
		if (!this.title) return;
		button.disabled = true;
		button.setText('Creating...');
		try { if (await this.onSubmit({ title: this.title, kind: this.kind, summary: this.summary })) this.close(); }
		finally { if (this.contentEl.isConnected) { button.disabled = false; button.setText('Create task'); } }
	}
}

class HubVerificationModal extends Modal {
	private evidence = '';
	constructor(app: App, private readonly onSubmit: (input: HubVerificationInput) => Promise<boolean>) { super(app); }

	onOpen(): void {
		this.titleEl.setText('Verify Hub run');
		this.contentEl.createEl('p', { text: 'Record a concise, non-secret evidence summary. A pass completes the task; a fail keeps it available for a future retry.' });
		new Setting(this.contentEl).setName('Evidence summary').setDesc('Tests, artifacts, review result, or reason for failure.').addTextArea((text) => text.setPlaceholder('Tests passed; output reviewed.').onChange((value) => { this.evidence = value.trim(); }));
		const actions = this.contentEl.createDiv({ cls: 'sr-control-job-actions' });
		const pass = actions.createEl('button', { text: 'Pass', cls: 'mod-cta' });
		const fail = actions.createEl('button', { text: 'Fail', cls: 'mod-warning' });
		actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		pass.addEventListener('click', () => void this.submit(pass, 'pass'));
		fail.addEventListener('click', () => void this.submit(fail, 'fail'));
	}

	private async submit(button: HTMLButtonElement, verdict: 'pass' | 'fail'): Promise<void> {
		if (!this.evidence) return;
		button.disabled = true;
		try { if (await this.onSubmit({ verdict, evidenceSummary: this.evidence })) this.close(); }
		finally { if (this.contentEl.isConnected) button.disabled = false; }
	}
}
