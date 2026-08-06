import { App, normalizePath, PluginManifest } from 'obsidian';
import { isWorkItem, type WorkItem } from './work-protocol';

export class WorkStore {
	private readonly directory: string;

	constructor(private readonly app: App, manifest: PluginManifest) {
		const pluginDirectory = manifest.dir ?? `${app.vault.configDir}/plugins/${manifest.id}`;
		this.directory = normalizePath(`${pluginDirectory}/context/work-items`);
	}

	async start(): Promise<void> { if (!await this.app.vault.adapter.exists(this.directory)) await this.app.vault.adapter.mkdir(this.directory); }
	async list(): Promise<WorkItem[]> {
		try {
			const listed = await this.app.vault.adapter.list(this.directory);
			const items = await Promise.all(listed.files.filter((path) => path.endsWith('.json')).map((path) => this.read(path)));
			return items.filter((item): item is WorkItem => item !== null).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
		} catch { return []; }
	}
	async get(id: string): Promise<WorkItem | null> { return this.read(this.path(id)); }
	async save(item: WorkItem): Promise<void> {
		await this.start();
		item.updatedAt = new Date().toISOString();
		await this.app.vault.adapter.write(this.path(item.id), JSON.stringify(item));
	}

	private path(id: string): string { return `${this.directory}/${id}.json`; }
	private async read(path: string): Promise<WorkItem | null> {
		try {
			const value: unknown = JSON.parse(await this.app.vault.adapter.read(path));
			return isWorkItem(value) ? value : null;
		} catch { return null; }
	}
}
