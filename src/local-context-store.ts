import { App, normalizePath, PluginManifest } from 'obsidian';
import { formatContextPackage, selectMemoriesForContext, summarizeSession, type ContextPackage, type GraphifyContextStatus, type LocalMemory, type LocalMemoryCandidate, type PersistedSession, type SessionSummary } from './local-context';

export class LocalContextStore {
	private readonly directory: string;
	private readonly sessionsDirectory: string;
	private readonly summariesDirectory: string;
	private readonly candidatesDirectory: string;
	private readonly memoriesDirectory: string;
	private readonly tombstonesDirectory: string;

	constructor(private readonly app: App, manifest: PluginManifest) {
		const pluginDirectory = manifest.dir ?? `${app.vault.configDir}/plugins/${manifest.id}`;
		this.directory = normalizePath(`${pluginDirectory}/context`);
		this.sessionsDirectory = normalizePath(`${this.directory}/sessions`);
		this.summariesDirectory = normalizePath(`${this.directory}/summaries`);
		this.candidatesDirectory = normalizePath(`${this.directory}/candidates`);
		this.memoriesDirectory = normalizePath(`${this.directory}/memories`);
		this.tombstonesDirectory = normalizePath(`${this.directory}/tombstones`);
	}

	async start(): Promise<void> { await this.ensureDirectories(); }

	async saveSession(session: PersistedSession, summaryBudget: number): Promise<void> {
		await this.ensureDirectories();
		const saved = { ...session, updatedAt: new Date().toISOString() };
		await this.writeJson(`${this.sessionsDirectory}/${saved.id}.json`, saved);
		const summary = summarizeSession(saved.messages, summaryBudget, saved.updatedAt);
		summary.sessionId = saved.id;
		await this.writeJson(`${this.summariesDirectory}/${saved.id}.json`, summary);
	}

	async listSessions(): Promise<PersistedSession[]> {
		return (await this.readDirectory<PersistedSession>(this.sessionsDirectory)).filter((session) => session.version === 1 && Boolean(session.id)).sort((left, right) => left.number - right.number);
	}

	async saveCandidate(candidate: LocalMemoryCandidate): Promise<void> {
		await this.ensureDirectories();
		await this.writeJson(`${this.candidatesDirectory}/${candidate.id}.json`, candidate);
	}

	async listCandidates(): Promise<LocalMemoryCandidate[]> {
		return (await this.readDirectory<LocalMemoryCandidate>(this.candidatesDirectory)).filter((candidate) => candidate.status === 'pending').sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	async approveCandidate(id: string, statement?: string): Promise<LocalMemory | null> {
		const path = `${this.candidatesDirectory}/${id}.json`;
		const candidate = await this.readJson<LocalMemoryCandidate>(path);
		if (!candidate || candidate.status !== 'pending') return null;
		const now = new Date().toISOString();
		const memory: LocalMemory = { ...candidate, statement: statement?.trim() || candidate.statement, updatedAt: now, approvedAt: now, status: 'active', supersedes: [] };
		await this.writeJson(`${this.memoriesDirectory}/${memory.id.replace(/^candidate-/, 'memory-')}.json`, { ...memory, id: memory.id.replace(/^candidate-/, 'memory-') });
		await this.moveToTombstone(path, `approved-${id}`);
		return { ...memory, id: memory.id.replace(/^candidate-/, 'memory-') };
	}

	async rejectCandidate(id: string): Promise<void> { await this.moveToTombstone(`${this.candidatesDirectory}/${id}.json`, `rejected-${id}`); }

	async markVaultSourceNeedsReview(path: string): Promise<void> {
		for (const memory of await this.listMemories()) {
			if (memory.sourceRefs.some((source) => source.type === 'vault_file' && source.path === path)) {
				memory.status = 'needs-review';
				memory.updatedAt = new Date().toISOString();
				await this.writeJson(`${this.memoriesDirectory}/${memory.id}.json`, memory);
			}
		}
	}

	async buildContext(session: PersistedSession, query: string, graph: GraphifyContextStatus, summaryBudget: number, memoryBudget: number): Promise<string | null> {
		let summary = await this.readJson<SessionSummary>(`${this.summariesDirectory}/${session.id}.json`);
		if (!summary || summary.sourceMessageCount !== session.messages.length) {
			summary = summarizeSession(session.messages, summaryBudget);
			summary.sessionId = session.id;
		}
		const memories = fitMemoryBudget(selectMemoriesForContext(await this.listMemories(), query, 24), memoryBudget);
		const contextPackage: ContextPackage = { summary, memories, graph };
		return formatContextPackage(contextPackage, summaryBudget + memoryBudget);
	}

	private async listMemories(): Promise<LocalMemory[]> { return (await this.readDirectory<LocalMemory>(this.memoriesDirectory)).filter((memory) => memory.status === 'active'); }
	private async readDirectory<T>(directory: string): Promise<T[]> {
		try {
			const listed = await this.app.vault.adapter.list(directory);
			const records = await Promise.all(listed.files.filter((path) => path.endsWith('.json')).map((path) => this.readJson<T>(path)));
			return records.filter((item) => item !== null);
		} catch { return []; }
	}
	private async readJson<T>(path: string): Promise<T | null> { try { return JSON.parse(await this.app.vault.adapter.read(path)) as T; } catch { return null; } }
	private async writeJson(path: string, value: unknown): Promise<void> { await this.app.vault.adapter.write(path, JSON.stringify(value)); }
	private async moveToTombstone(path: string, name: string): Promise<void> { if (!await this.app.vault.adapter.exists(path)) return; await this.ensureDirectories(); await this.app.vault.adapter.rename(path, `${this.tombstonesDirectory}/${name}-${Date.now()}.json`); }
	private async ensureDirectories(): Promise<void> { for (const directory of [this.directory, this.sessionsDirectory, this.summariesDirectory, this.candidatesDirectory, this.memoriesDirectory, this.tombstonesDirectory]) if (!await this.app.vault.adapter.exists(directory)) await this.app.vault.adapter.mkdir(directory); }
}

function fitMemoryBudget(memories: LocalMemory[], budget: number): LocalMemory[] {
	const selected: LocalMemory[] = [];
	let used = 0;
	for (const memory of memories) {
		const size = memory.statement.length + memory.sourceRefs.reduce((total, source) => total + (source.path ?? source.id).length, 0) + 64;
		if (size > budget - used) continue;
		selected.push(memory);
		used += size;
	}
	return selected;
}
