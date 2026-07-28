import { App, Modal } from 'obsidian';
import type { LocalContextStore } from '../local-context-store';

export function confirmMemoryProposal(app: App): Promise<boolean> {
	return new Promise((resolve) => new MemoryProposalConfirmationModal(app, resolve).open());
}

class MemoryProposalConfirmationModal extends Modal {
	private answered = false;
	constructor(app: App, private readonly resolve: (approved: boolean) => void) { super(app); }
	onOpen(): void {
		this.titleEl.setText('Propose local memories');
		this.contentEl.createEl('p', { text: 'A bounded summary of this session will be sent to your configured Hermes runtime to propose memories. Your selected provider may charge for this request. Nothing will be saved until you approve it.' });
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		actions.createEl('button', { text: 'Cancel' }).onclick = () => this.answer(false);
		actions.createEl('button', { text: 'Continue', cls: 'mod-cta' }).onclick = () => this.answer(true);
	}
	onClose(): void { if (!this.answered) this.answer(false); this.contentEl.empty(); }
	private answer(approved: boolean): void { if (this.answered) return; this.answered = true; this.resolve(approved); this.close(); }
}

export class MemoryReviewModal extends Modal {
	constructor(app: App, private readonly store: LocalContextStore) { super(app); }
	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.createEl('h3', { text: 'Review proposed memories' });
		const candidates = await this.store.listCandidates();
		if (!candidates.length) { this.contentEl.createEl('p', { text: 'No pending memory proposals.' }); return; }
		for (const candidate of candidates) {
			const item = this.contentEl.createDiv({ cls: 'sr-memory-candidate' });
			item.createEl('p', { text: `${candidate.kind} · confidence ${Math.round(candidate.confidence * 100)}%` });
			const input = item.createEl('textarea', { text: candidate.statement, attr: { 'aria-label': 'Memory statement' } });
			item.createEl('small', { text: `Sources: ${candidate.sourceRefs.map((source) => source.path ?? source.id).join(', ')}` });
			const actions = item.createDiv({ cls: 'sr-memory-actions' });
			const approve = actions.createEl('button', { text: 'Approve' });
			const reject = actions.createEl('button', { text: 'Reject' });
			approve.onclick = async () => { await this.store.approveCandidate(candidate.id, input.value); await this.onOpen(); };
			reject.onclick = async () => { await this.store.rejectCandidate(candidate.id); await this.onOpen(); };
		}
	}
}
