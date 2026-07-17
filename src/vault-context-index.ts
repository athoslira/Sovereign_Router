import { App, normalizePath, PluginManifest, TAbstractFile, TFile } from 'obsidian';
import { isTextDocument } from './document-files';
import { contextTerms, extractContextExcerpt, rankContextEntries, type SearchableContextEntry } from './context-search';

const REGISTRY_VERSION = 1;
const MAX_INDEX_SOURCE_CHARS = 60_000;
const MAX_CONTEXT_CHARS = 60_000;
const MAX_CONTEXT_FILES = 6;

type ContextSource = 'vault' | 'external';
interface ContextEntry extends SearchableContextEntry {
	source: ContextSource;
	modified: number;
	size: number;
	cachePath?: string;
}
interface ContextRegistry {
	version: number;
	entries: Record<string, ContextEntry>;
}
export interface ResolvedVaultContext {
	content: string | null;
	note: string | null;
}

export class VaultContextIndex {
	private readonly directory: string;
	private readonly registryPath: string;
	private readonly externalDirectory: string;
	private registry: ContextRegistry = { version: REGISTRY_VERSION, entries: {} };
	private loaded = false;
	private loadPromise: Promise<void> | null = null;
	private indexing: Promise<void> | null = null;
	private saveTimer: number | null = null;

	constructor(private readonly app: App, manifest: PluginManifest) {
		const pluginDirectory = manifest.dir ?? `${app.vault.configDir}/plugins/${manifest.id}`;
		this.directory = normalizePath(`${pluginDirectory}/context`);
		this.registryPath = normalizePath(`${this.directory}/registry.json`);
		this.externalDirectory = normalizePath(`${this.directory}/external`);
	}

	async start(): Promise<void> {
		await this.load();
		window.setTimeout(() => { void this.indexAll(); }, 1_000);
	}

	dispose(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
	}

	onVaultFileChanged(file: TAbstractFile): void {
		if (!(file instanceof TFile) || !this.shouldIndex(file)) return;
		void this.upsertVaultFile(file);
	}

	onVaultFileDeleted(file: TAbstractFile): void {
		const id = vaultEntryId(file.path);
		if (!this.registry.entries[id]) return;
		delete this.registry.entries[id];
		this.scheduleSave();
	}

	onVaultFileRenamed(file: TAbstractFile, oldPath: string): void {
		const oldId = vaultEntryId(oldPath);
		if (this.registry.entries[oldId]) delete this.registry.entries[oldId];
		if (file instanceof TFile && this.shouldIndex(file)) void this.upsertVaultFile(file);
		else this.scheduleSave();
	}

	async addExternalDocument(name: string, markdown: string): Promise<void> {
		await this.load();
		await this.ensureDirectories();
		const id = `external:${shortHash(`${name}:${markdown}`)}`;
		const cachePath = normalizePath(`${this.externalDirectory}/${shortHash(id)}.md`);
		await this.app.vault.adapter.write(cachePath, markdown);
		this.registry.entries[id] = {
			id,
			source: 'external',
			path: `External document: ${name}`,
			title: titleFor(name, markdown),
			terms: contextTerms(`${name}\n${markdown.slice(0, MAX_INDEX_SOURCE_CHARS)}`),
			modified: Date.now(),
			size: markdown.length,
			cachePath,
		};
		await this.save();
	}

	async clearExternalDocuments(): Promise<void> {
		await this.load();
		const external = Object.values(this.registry.entries).filter((entry) => entry.source === 'external');
		for (const entry of external) {
			if (entry.cachePath && await this.app.vault.adapter.exists(entry.cachePath)) await this.app.vault.adapter.remove(entry.cachePath);
			delete this.registry.entries[entry.id];
		}
		await this.save();
	}

	async resolve(query: string): Promise<ResolvedVaultContext> {
		await this.load();
		if (Object.keys(this.registry.entries).length === 0) await this.indexAll();
		const entries = rankContextEntries(Object.values(this.registry.entries), query).slice(0, MAX_CONTEXT_FILES);
		if (entries.length === 0) return { content: null, note: 'No matching local context was found.' };
		let remaining = MAX_CONTEXT_CHARS;
		const sections: string[] = [];
		for (const entry of entries) {
			if (remaining <= 0) break;
			const content = await this.readEntry(entry);
			if (!content) continue;
			const excerpt = extractContextExcerpt(content, query, Math.min(12_000, remaining));
			remaining -= excerpt.length;
			sections.push(`## Vault context: ${entry.path}\n${excerpt}`);
		}
		if (sections.length === 0) return { content: null, note: 'Matching context is no longer available.' };
		return { content: sections.join('\n\n---\n\n'), note: `Loaded local context from ${sections.length} file${sections.length === 1 ? '' : 's'}.` };
	}

	private async indexAll(): Promise<void> {
		if (this.indexing) return this.indexing;
		this.indexing = (async () => {
			await this.load();
			const paths = new Set<string>();
			for (const file of this.app.vault.getFiles()) {
				if (!this.shouldIndex(file)) continue;
				paths.add(file.path);
				await this.upsertVaultFile(file, false);
			}
			for (const [id, entry] of Object.entries(this.registry.entries)) {
				if (entry.source === 'vault' && !paths.has(entry.path)) delete this.registry.entries[id];
			}
			await this.save();
		})().finally(() => { this.indexing = null; });
		return this.indexing;
	}

	private async upsertVaultFile(file: TFile, persist = true): Promise<void> {
		await this.load();
		const id = vaultEntryId(file.path);
		const existing = this.registry.entries[id];
		if (existing && existing.source === 'vault' && existing.modified === file.stat.mtime && existing.size === file.stat.size) return;
		try {
			const content = await this.app.vault.cachedRead(file);
			this.registry.entries[id] = {
				id,
				source: 'vault',
				path: file.path,
				title: titleFor(file.basename, content),
				terms: contextTerms(`${file.path}\n${content.slice(0, MAX_INDEX_SOURCE_CHARS)}`),
				modified: file.stat.mtime,
				size: file.stat.size,
			};
			if (persist) this.scheduleSave();
		} catch (_error) {
			// A file may disappear between a vault event and the indexed read.
		}
	}

	private async readEntry(entry: ContextEntry): Promise<string | null> {
		try {
			if (entry.source === 'external') return entry.cachePath && await this.app.vault.adapter.exists(entry.cachePath) ? this.app.vault.adapter.read(entry.cachePath) : null;
			const file = this.app.vault.getFileByPath(entry.path);
			return file ? this.app.vault.cachedRead(file) : null;
		} catch (_error) {
			return null;
		}
	}

	private shouldIndex(file: TFile): boolean {
		return isTextDocument(file.name) && !file.path.startsWith(`${this.app.vault.configDir}/`) && !file.path.startsWith(this.directory);
	}

	private async load(): Promise<void> {
		if (this.loaded) return;
		if (!this.loadPromise) {
			this.loadPromise = (async () => {
				try {
					if (!await this.app.vault.adapter.exists(this.registryPath)) return;
					const parsed = JSON.parse(await this.app.vault.adapter.read(this.registryPath)) as Partial<ContextRegistry>;
					if (parsed.version === REGISTRY_VERSION && parsed.entries && typeof parsed.entries === 'object') this.registry = { version: REGISTRY_VERSION, entries: parsed.entries };
				} catch (_error) {
					this.registry = { version: REGISTRY_VERSION, entries: {} };
				} finally {
					this.loaded = true;
				}
			})();
		}
		await this.loadPromise;
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => { void this.save(); }, 750);
	}

	private async save(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		await this.ensureDirectories();
		await this.app.vault.adapter.write(this.registryPath, JSON.stringify(this.registry));
	}

	private async ensureDirectories(): Promise<void> {
		if (!await this.app.vault.adapter.exists(this.directory)) await this.app.vault.adapter.mkdir(this.directory);
		if (!await this.app.vault.adapter.exists(this.externalDirectory)) await this.app.vault.adapter.mkdir(this.externalDirectory);
	}
}

function vaultEntryId(path: string): string { return `vault:${path}`; }
function shortHash(value: string): string {
	let hash = 5381;
	for (let index = 0; index < value.length; index += 1) hash = (hash * 33) ^ value.charCodeAt(index);
	return (hash >>> 0).toString(36);
}
function titleFor(fallback: string, content: string): string {
	const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
	return heading || fallback;
}
