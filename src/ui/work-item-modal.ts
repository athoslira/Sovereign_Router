import { App, Modal, Setting } from 'obsidian';
import type { CreateWorkItemInput } from '../work-service';
import type { WorkItem, WorkWorkspaceMode } from '../work-protocol';

export function openCreateWorkItemModal(app: App, onSubmit: (input: CreateWorkItemInput) => Promise<boolean>): void {
	new CreateWorkItemModal(app, onSubmit).open();
}

export function confirmWorkExecution(app: App, item: WorkItem): Promise<boolean> {
	return new Promise((resolve) => new WorkExecutionConfirmationModal(app, item, resolve).open());
}

class CreateWorkItemModal extends Modal {
	private title = '';
	private requirement = '';
	private workspaceMode: WorkWorkspaceMode = 'existing';
	private workspaceHint = '';
	private submitting = false;

	constructor(app: App, private readonly onSubmit: (input: CreateWorkItemInput) => Promise<boolean>) { super(app); }

	onOpen(): void {
		this.titleEl.setText('New work item');
		new Setting(this.contentEl).setName('Title').setDesc('Short, outcome-oriented task name.').addText((text) => text.setPlaceholder('Add governed task lifecycle').onChange((value) => { this.title = value; }));
		new Setting(this.contentEl).setName('Requirement').setDesc('Goal, constraints, acceptance criteria, and relevant context.').addTextArea((text) => {
			text.inputEl.rows = 8;
			text.setPlaceholder('Describe what must be planned, executed, and verified.').onChange((value) => { this.requirement = value; });
		});
		new Setting(this.contentEl).setName('Workspace mode').setDesc('An isolated worktree is only requested; Hermes or a VS Code host performs the actual Git operation after approval.').addDropdown((dropdown) => dropdown
			.addOption('existing', 'Existing workspace')
			.addOption('isolated-worktree', 'Isolated Git worktree')
			.setValue(this.workspaceMode)
			.onChange((value) => { this.workspaceMode = value as WorkWorkspaceMode; }));
		new Setting(this.contentEl).setName('Workspace hint').setDesc('Optional repository or folder hint. This is advisory context, not filesystem permission.').addText((text) => text.setPlaceholder('Projects/Sovereign Router').onChange((value) => { this.workspaceHint = value; }));
		new Setting(this.contentEl).addButton((button) => button.setCta().setButtonText('Create work item').onClick(async () => {
			if (this.submitting || !this.title.trim() || !this.requirement.trim()) return;
			this.submitting = true;
			button.setDisabled(true).setButtonText('Creating...');
			const created = await this.onSubmit({ title: this.title, requirement: this.requirement, workspaceMode: this.workspaceMode, workspaceHint: this.workspaceHint });
			if (created) this.close();
			else { this.submitting = false; button.setDisabled(false).setButtonText('Create work item'); }
		}));
	}
}

class WorkExecutionConfirmationModal extends Modal {
	constructor(app: App, private readonly item: WorkItem, private readonly resolve: (approved: boolean) => void) { super(app); }
	onOpen(): void {
		this.titleEl.setText('Start governed execution?');
		this.contentEl.createEl('p', { text: `Hermes will receive the approved plan for “${this.item.title}”. Its own tool, terminal, worktree, and dangerous-command approvals remain in force.` });
		this.contentEl.createEl('p', { text: this.item.workspaceMode === 'isolated-worktree' ? 'The task requests an isolated worktree, but Hermes must still approve and create it.' : 'The task requests the existing workspace; Hermes must still enforce its configured write boundaries.' });
		const actions = this.contentEl.createDiv({ cls: 'sr-work-actions' });
		actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => { this.resolve(false); this.close(); });
		actions.createEl('button', { text: 'Start Hermes run', cls: 'mod-cta' }).addEventListener('click', () => { this.resolve(true); this.close(); });
	}
	onClose(): void { this.resolve(false); }
}
