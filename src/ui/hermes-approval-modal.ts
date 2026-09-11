import { App, Modal } from 'obsidian';
import type { HermesApprovalChoice, HermesApprovalRequest } from '../hermes';

export function chooseHermesApproval(app: App, request: HermesApprovalRequest): Promise<HermesApprovalChoice> {
	return new Promise((resolve) => new HermesApprovalModal(app, request, resolve).open());
}

class HermesApprovalModal extends Modal {
	private answered = false;
	constructor(app: App, private readonly request: HermesApprovalRequest, private readonly resolve: (choice: HermesApprovalChoice) => void) { super(app); }
	onOpen(): void {
		this.titleEl.setText('Approve Hermes action');
		this.contentEl.createEl('p', { text: `${this.request.toolName} requires confirmation.` });
		this.contentEl.createEl('p', { text: this.request.message });
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const actions = [['Allow once', 'once'], ['Allow for session', 'session'], ['Always allow rule', 'always'], ['Deny', 'deny']] as const;
		for (const [label, choice] of actions.filter(([, choice]) => choice === 'deny' || this.request.choices.includes(choice))) {
			const button = buttons.createEl('button', { text: label, cls: choice === 'deny' ? 'mod-warning' : choice === 'once' ? 'mod-cta' : '' });
			button.addEventListener('click', () => this.answer(choice));
		}
	}
	onClose(): void { if (!this.answered) this.answer('deny'); this.contentEl.empty(); }
	private answer(choice: HermesApprovalChoice): void { if (this.answered) return; this.answered = true; this.resolve(choice); this.close(); }
}
