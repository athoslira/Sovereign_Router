import { App, TFolder } from 'obsidian';
import type { ImageOperation } from './image-workflow';
import { vaultOutputPath } from './vault-path-policy';

export class VaultImageWriter {
	constructor(private readonly app: App, private readonly outputRoot: string) {}
	async write(operation: ImageOperation): Promise<string> {
		const path = vaultOutputPath(this.outputRoot, operation.path);
		await this.ensureParentFolders(path);
		const existing = this.app.vault.getFileByPath(path);
		if (existing) await this.app.vault.process(existing, () => operation.svg);
		else await this.app.vault.create(path, operation.svg);
		const provenancePath = `${path}.provenance.md`;
		const provenance = [
			'---', 'sovereignMediaVersion: 1', 'provider: local-svg', 'costClass: local-free',
			`generatedAt: ${new Date().toISOString()}`, '---', '', `# ${operation.title}`, '',
			`Alt text: ${operation.alt}`, '', `Asset: [[${path}]]`, '',
		].join('\n');
		const existingProvenance = this.app.vault.getFileByPath(provenancePath);
		if (existingProvenance) await this.app.vault.process(existingProvenance, () => provenance);
		else await this.app.vault.create(provenancePath, provenance);
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
