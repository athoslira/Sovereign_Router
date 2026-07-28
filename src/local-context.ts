import type { SessionRuntime, SkillReference, VaultContextReference } from './types';

export type LocalMemoryKind = 'decision' | 'entity' | 'relation' | 'preference' | 'project_state';
export type LocalSourceType = 'session' | 'vault_file' | 'graph_node';

export interface LocalSourceReference {
	type: LocalSourceType;
	id: string;
	path?: string;
}

export interface LocalSessionMessage {
	role: 'user' | 'assistant';
	content: string;
	meta?: string;
}

export interface PersistedSession {
	version: 1;
	id: string;
	number: number;
	state: 'active' | 'ended';
	createdAt: string;
	updatedAt: string;
	selectedModel: string;
	runtime: SessionRuntime;
	resolvedRuntime: Exclude<SessionRuntime, 'auto'> | null;
	model: string | null;
	hermesModelAlias: string | null;
	skill: SkillReference | null;
	context: VaultContextReference | null;
	useMcp: boolean;
	messages: LocalSessionMessage[];
}

export interface SessionSummary {
	version: 1;
	sessionId: string;
	content: string;
	sourceMessageCount: number;
	updatedAt: string;
}

export interface LocalMemoryCandidate {
	id: string;
	kind: LocalMemoryKind;
	statement: string;
	entityIds: string[];
	sourceRefs: LocalSourceReference[];
	confidence: number;
	rationale: string;
	createdAt: string;
	updatedAt: string;
	status: 'pending' | 'rejected';
}

export interface LocalMemory extends Omit<LocalMemoryCandidate, 'status'> {
	approvedAt: string;
	status: 'active' | 'needs-review';
	supersedes: string[];
}

export interface GraphifyContextStatus {
	state: 'unavailable' | 'ready';
	path: string;
}

export interface ContextPackage {
	summary: SessionSummary | null;
	memories: LocalMemory[];
	graph: GraphifyContextStatus;
}

const MEMORY_KINDS = new Set<LocalMemoryKind>(['decision', 'entity', 'relation', 'preference', 'project_state']);

export function summarizeSession(messages: LocalSessionMessage[], maximum = 6_000, now = new Date().toISOString()): SessionSummary {
	const normalized = messages
		.filter((message) => message.content.trim())
		.map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content.trim()}`);
	let content = normalized.join('\n');
	if (content.length > maximum) content = `[Earlier messages omitted]\n${content.slice(content.length - Math.max(0, maximum - 27))}`;
	return { version: 1, sessionId: '', content, sourceMessageCount: normalized.length, updatedAt: now };
}

export function selectMemoriesForContext(memories: LocalMemory[], query: string, limit = 6): LocalMemory[] {
	const terms = new Set(tokens(query));
	return memories
		.filter((memory) => memory.status === 'active')
		.map((memory) => ({ memory, score: relevance(memory, terms) }))
		.filter((item) => item.score > 0)
		.sort((left, right) => right.score - left.score || right.memory.updatedAt.localeCompare(left.memory.updatedAt))
		.slice(0, Math.max(0, limit))
		.map((item) => item.memory);
}

export function formatContextPackage(context: ContextPackage, maximum = 8_000): string | null {
	const sections: string[] = [];
	if (context.summary?.content) sections.push(`Session summary (local):\n${context.summary.content}`);
	for (const memory of context.memories) {
		const sourceText = memory.sourceRefs.map((source) => source.path ?? source.id).join(', ');
		sections.push(`Approved memory [${memory.kind}] (sources: ${sourceText}):\n${memory.statement}`);
	}
	if (context.graph.state === 'ready') sections.push(`Local Graphify graph available at: ${context.graph.path}. Use the Graphify skill or MCP configured in Hermes to query a scoped subgraph; do not assume this path is remotely accessible.`);
	const joined = sections.join('\n\n---\n\n');
	if (!joined) return null;
	return joined.length <= maximum ? joined : `${joined.slice(0, maximum - 16)}\n[Context truncated]`;
}

export function parseMemoryCandidates(raw: string, fallbackSourceRefs: LocalSourceReference[], now = new Date().toISOString()): LocalMemoryCandidate[] {
	const parsed = parseJsonPayload(raw);
	const entries = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.memories) ? parsed.memories : [];
	return entries.flatMap((entry, index) => {
		if (!isRecord(entry) || !MEMORY_KINDS.has(entry.kind as LocalMemoryKind)) return [];
		const statement = typeof entry.statement === 'string' ? entry.statement.trim() : '';
		if (!statement) return [];
		const sourceRefs = parseSourceRefs(entry.sourceRefs);
		const resolvedSources = sourceRefs.length ? sourceRefs : fallbackSourceRefs;
		if (!resolvedSources.length) return [];
		const confidence = typeof entry.confidence === 'number' && Number.isFinite(entry.confidence) ? Math.max(0, Math.min(1, entry.confidence)) : 0.5;
		const rationale = typeof entry.rationale === 'string' && entry.rationale.trim() ? entry.rationale.trim() : 'Proposed by Hermes from the cited local sources.';
		const entityIds = Array.isArray(entry.entityIds) ? entry.entityIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim()) : [];
		return [{
			id: `candidate-${shortHash(`${now}:${index}:${statement}`)}`,
			kind: entry.kind as LocalMemoryKind,
			statement,
			entityIds,
			sourceRefs: resolvedSources,
			confidence,
			rationale,
			createdAt: now,
			updatedAt: now,
			status: 'pending' as const,
		}];
	});
}

function parseJsonPayload(value: string): unknown {
	const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value;
	try { return JSON.parse(fenced.trim()); } catch { return null; }
}

function parseSourceRefs(value: unknown): LocalSourceReference[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((source) => {
		if (!isRecord(source) || !['session', 'vault_file', 'graph_node'].includes(String(source.type)) || typeof source.id !== 'string' || !source.id.trim()) return [];
		return [{ type: source.type as LocalSourceType, id: source.id.trim(), ...(typeof source.path === 'string' && source.path.trim() ? { path: source.path.trim() } : {}) }];
	});
}

function relevance(memory: LocalMemory, queryTerms: Set<string>): number {
	if (!queryTerms.size) return 0;
	const values = tokens(`${memory.statement} ${memory.entityIds.join(' ')} ${memory.sourceRefs.map((source) => `${source.id} ${source.path ?? ''}`).join(' ')}`);
	return values.reduce((score, term) => score + (queryTerms.has(term) ? 1 : 0), 0);
}

function tokens(value: string): string[] {
	return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
}

function shortHash(value: string): string {
	let hash = 5381;
	for (let index = 0; index < value.length; index += 1) hash = (hash * 33) ^ value.charCodeAt(index);
	return (hash >>> 0).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
