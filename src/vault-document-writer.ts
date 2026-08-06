import { App, TFolder } from 'obsidian';
import type { DocumentOperation } from './document-authoring';
import { vaultOutputPath } from './vault-path-policy';

export class VaultDocumentWriter {
	constructor(private readonly app: App, private readonly outputRoot: string) {}
	async write(operation: DocumentOperation): Promise<string> {
		const path = vaultOutputPath(this.outputRoot, operation.path);
		await this.ensureParentFolders(path);
		const existing = this.app.vault.getFileByPath(path);
		if (operation.action === 'create') {
			if (existing) throw new Error(`A note already exists at ${path}.`);
			await this.app.vault.create(path, operation.content);
			return path;
		}
		if (!existing) throw new Error(`No note exists at ${path} for a ${operation.action} operation.`);
		await this.app.vault.process(existing, (current) => operation.action === 'append' ? `${current.trimEnd()}\n\n${operation.content}\n` : operation.content);
		return path;
	}
	private async ensureParentFolders(path: string): Promise<void> {
		const parts = path.split('/').slice(0, -1);
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const found = this.app.vault.getAbstractFileByPath(current);
			if (!found) await this.app.vault.createFolder(current);
			else if (!(found instanceof TFolder)) throw new Error(`${current} is not a folder.`);
		}
	}
}
