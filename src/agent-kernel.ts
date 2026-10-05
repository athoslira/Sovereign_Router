export type KernelDecisionAction = 'allow' | 'ask' | 'deny';

export interface KernelHealth {
	status: 'ok' | 'degraded';
	version: string;
	heartbeatAt: number | null;
	pendingApprovals: number;
}

export interface RuntimeEvent {
	id: number;
	executionId: string;
	type: string;
	createdAt: number;
	summary: string;
	decision: KernelDecisionAction | null;
}

export interface KernelGrant {
	id: string;
	ruleKey: string;
	scope: 'session' | 'always';
	revoked: boolean;
	createdAt: number;
}

export interface ExecutionEnvelopeV1 {
	version: 1;
	id: string;
	sessionId: string;
	mode: 'governed';
	allowedRoots: string[];
	plannedWritePaths: string[];
	capabilities: string[];
}

export type HubTaskKind = 'general' | 'research' | 'code' | 'automation' | 'media' | 'analysis';
export type HubRunState = 'draft' | 'planned' | 'queued' | 'running' | 'awaiting_approval' | 'verifying' | 'completed' | 'failed' | 'cancelled';
export interface HubHealth { status: 'ok'; version: string; taskProtocol: number; executionAdapter: boolean; mcpRegistry: boolean; }
export interface HubTask { id: string; title: string; kind: HubTaskKind; summary: string; state: HubRunState; createdAt: number; updatedAt: number; }
export interface HubRun { id: string; taskId: string; state: Exclude<HubRunState, 'draft' | 'planned'>; executor: string | null; model: string | null; hermesRunId: string | null; executionId: string | null; createdAt: number; updatedAt: number; }
export interface HubEvent { id: number; taskId: string; runId: string | null; type: string; summary: string; createdAt: number; }
export interface HubMcpServer { id: string; name: string; transport: 'stdio' | 'streamable_http'; serverRef: string; state: 'registered'; tools: Array<{ name: string; readOnly: boolean; externalEffect: boolean }>; }

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizedPath(value: unknown): string | null {
	if (typeof value !== 'string' || !value.trim()) return null;
	let path = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
	if (path.startsWith('~') || path.split('/').some((part) => part === '..')) return null;
	if (/^[a-z]:/i.test(path)) path = path.toLowerCase();
	return path || null;
}

export function extractPlannedWritePaths(plan: string): string[] {
	const paths = new Set<string>();
	for (const match of plan.matchAll(/`([^`\r\n]+)`/g)) {
		const candidate = normalizedPath(match[1]);
		if (!candidate || !/\.[a-z0-9]{1,12}$/i.test(candidate)) continue;
		paths.add(candidate);
	}
	return [...paths];
}

export function parseKernelHealth(value: unknown): KernelHealth | null {
	const root = record(value);
	if (!root || (root.status !== 'ok' && root.status !== 'degraded') || typeof root.version !== 'string') return null;
	return {
		status: root.status,
		version: root.version,
		heartbeatAt: typeof root.heartbeat_at === 'number' ? root.heartbeat_at : null,
		pendingApprovals: typeof root.pending_approvals === 'number' ? Math.max(0, root.pending_approvals) : 0,
	};
}

function parseRuntimeEvent(value: unknown): RuntimeEvent | null {
	const root = record(value);
	if (!root || typeof root.id !== 'number' || typeof root.execution_id !== 'string' || typeof root.type !== 'string' || typeof root.created_at !== 'number' || typeof root.summary !== 'string') return null;
	const decision = ['allow', 'ask', 'deny'].includes(String(root.decision)) ? root.decision as KernelDecisionAction : null;
	return { id: root.id, executionId: root.execution_id, type: root.type, createdAt: root.created_at, summary: root.summary.slice(0, 240), decision };
}

export function parseRuntimeEvents(value: unknown): RuntimeEvent[] {
	const root = record(value);
	const data = Array.isArray(root?.data) ? root.data : [];
	return data.flatMap((candidate) => {
		const event = parseRuntimeEvent(candidate);
		return event ? [event] : [];
	});
}

export function parseKernelGrants(value: unknown): KernelGrant[] {
	const root = record(value);
	const data = Array.isArray(root?.data) ? root.data : [];
	return data.flatMap((candidate) => {
		const grant = record(candidate);
		if (!grant || typeof grant.id !== 'string' || typeof grant.rule_key !== 'string' || !['session', 'always'].includes(String(grant.scope)) || typeof grant.revoked !== 'boolean' || typeof grant.created_at !== 'number') return [];
		return [{ id: grant.id, ruleKey: grant.rule_key, scope: grant.scope as KernelGrant['scope'], revoked: grant.revoked, createdAt: grant.created_at }];
	});
}

function numberValue(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function hubState(value: unknown): HubRunState | null { return typeof value === 'string' && ['draft', 'planned', 'queued', 'running', 'awaiting_approval', 'verifying', 'completed', 'failed', 'cancelled'].includes(value) ? value as HubRunState : null; }

export function parseHubHealth(value: unknown): HubHealth | null {
	const root = record(value);
	if (!root || root.status !== 'ok' || typeof root.version !== 'string' || typeof root.task_protocol !== 'number' || typeof root.execution_adapter !== 'boolean' || typeof root.mcp_registry !== 'boolean') return null;
	return { status: 'ok', version: root.version, taskProtocol: root.task_protocol, executionAdapter: root.execution_adapter, mcpRegistry: root.mcp_registry };
}

function parseHubTask(value: unknown): HubTask | null {
	const root = record(value); const state = hubState(root?.state);
	if (!root || typeof root.id !== 'string' || typeof root.title !== 'string' || typeof root.kind !== 'string' || !['general', 'research', 'code', 'automation', 'media', 'analysis'].includes(root.kind) || typeof root.summary !== 'string' || !state || numberValue(root.created_at) === null || numberValue(root.updated_at) === null) return null;
	return { id: root.id, title: root.title, kind: root.kind as HubTaskKind, summary: root.summary, state, createdAt: root.created_at as number, updatedAt: root.updated_at as number };
}

export function parseHubTasks(value: unknown): HubTask[] {
	const root = record(value); const data = Array.isArray(root?.data) ? root.data : [];
	return data.flatMap((item) => { const task = parseHubTask(item); return task ? [task] : []; });
}

function parseHubRun(value: unknown): HubRun | null {
	const root = record(value); const state = hubState(root?.state);
	if (!root || typeof root.id !== 'string' || typeof root.task_id !== 'string' || !state || state === 'draft' || state === 'planned' || numberValue(root.created_at) === null || numberValue(root.updated_at) === null) return null;
	const nullableText = (item: unknown): string | null | undefined => item === null ? null : typeof item === 'string' ? item : undefined;
	const executor = nullableText(root.executor); const model = nullableText(root.model); const hermesRunId = nullableText(root.hermes_run_id); const executionId = nullableText(root.execution_id);
	if (executor === undefined || model === undefined || hermesRunId === undefined || executionId === undefined) return null;
	return { id: root.id, taskId: root.task_id, state, executor, model, hermesRunId, executionId, createdAt: root.created_at as number, updatedAt: root.updated_at as number };
}

export function parseHubRuns(value: unknown): HubRun[] {
	const root = record(value); const data = Array.isArray(root?.data) ? root.data : [];
	return data.flatMap((item) => { const run = parseHubRun(item); return run ? [run] : []; });
}

export function parseHubEvents(value: unknown): HubEvent[] {
	const root = record(value); const data = Array.isArray(root?.data) ? root.data : [];
	return data.flatMap((item) => {
		const event = record(item); const runId = event?.run_id === null ? null : typeof event?.run_id === 'string' ? event.run_id : undefined;
		const createdAt = numberValue(event?.created_at);
		if (!event || typeof event.id !== 'number' || typeof event.task_id !== 'string' || runId === undefined || typeof event.type !== 'string' || typeof event.summary !== 'string' || createdAt === null) return [];
		return [{ id: event.id, taskId: event.task_id, runId, type: event.type, summary: event.summary.slice(0, 240), createdAt }];
	});
}

export function parseHubMcpServers(value: unknown): HubMcpServer[] {
	const root = record(value); const data = Array.isArray(root?.data) ? root.data : [];
	return data.flatMap((item) => {
		const server = record(item); const tools = Array.isArray(server?.tools) ? server.tools : [];
		if (!server || typeof server.id !== 'string' || typeof server.name !== 'string' || (server.transport !== 'stdio' && server.transport !== 'streamable_http') || typeof server.server_ref !== 'string' || server.state !== 'registered') return [];
		const parsedTools = tools.flatMap((tool) => { const value = record(tool); return value && typeof value.name === 'string' && typeof value.read_only === 'boolean' && typeof value.external_effect === 'boolean' ? [{ name: value.name, readOnly: value.read_only, externalEffect: value.external_effect }] : []; });
		return [{ id: server.id, name: server.name, transport: server.transport, serverRef: server.server_ref, state: 'registered', tools: parsedTools }];
	});
}

async function responseError(response: Response): Promise<Error> {
	let message = `Agent Kernel request failed (${response.status}).`;
	try { const body = record(await response.json()); if (typeof body?.message === 'string') message = body.message; } catch { /* status is enough */ }
	return new Error(message);
}

export class AgentKernelClient {
	private readonly baseUrl: string;
	constructor(baseUrl: string, private readonly apiKey: string) {
		let endpoint: URL;
		try { endpoint = new URL(baseUrl); } catch { throw new Error('Agent Kernel URL is invalid.'); }
		if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
			throw new Error('Agent Kernel URL must use an authenticated loopback endpoint.');
		}
		this.baseUrl = baseUrl.replace(/\/$/, '');
	}
	private headers(): Record<string, string> { return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }; }
	async health(signal?: AbortSignal): Promise<KernelHealth> {
		const response = await fetch(`${this.baseUrl}/v1/health`, { headers: this.headers(), signal });
		if (!response.ok) throw await responseError(response);
		const health = parseKernelHealth(await response.json());
		if (!health) throw new Error('Agent Kernel returned an invalid health response.');
		return health;
	}
	async createExecution(envelope: ExecutionEnvelopeV1, signal?: AbortSignal): Promise<void> {
		const response = await fetch(`${this.baseUrl}/v1/executions`, {
			method: 'POST', headers: this.headers(), signal,
			body: JSON.stringify({ version: envelope.version, id: envelope.id, session_id: envelope.sessionId, mode: envelope.mode, allowed_roots: envelope.allowedRoots, planned_write_paths: envelope.plannedWritePaths, capabilities: envelope.capabilities }),
		});
		if (!response.ok) throw await responseError(response);
	}
	async bindRun(executionId: string, runId: string, signal?: AbortSignal): Promise<void> {
		const response = await fetch(`${this.baseUrl}/v1/executions/${encodeURIComponent(executionId)}/bind-run`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify({ run_id: runId }), signal });
		if (!response.ok) throw await responseError(response);
	}
	async checkpoint(executionId: string, status: string, signal?: AbortSignal): Promise<void> {
		const response = await fetch(`${this.baseUrl}/v1/executions/${encodeURIComponent(executionId)}/checkpoint`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ status }), signal });
		if (!response.ok) throw await responseError(response);
	}
	async listGrants(signal?: AbortSignal): Promise<KernelGrant[]> {
		const response = await fetch(`${this.baseUrl}/v1/grants`, { headers: this.headers(), signal });
		if (!response.ok) throw await responseError(response);
		return parseKernelGrants(await response.json());
	}
	async listEvents(signal?: AbortSignal): Promise<RuntimeEvent[]> {
		const response = await fetch(`${this.baseUrl}/v1/events`, { headers: this.headers(), signal });
		if (!response.ok) throw await responseError(response);
		return parseRuntimeEvents(await response.json());
	}
	async revokeGrant(grantId: string, signal?: AbortSignal): Promise<void> {
		const response = await fetch(`${this.baseUrl}/v1/grants/${encodeURIComponent(grantId)}/revoke`, { method: 'POST', headers: this.headers(), body: '{}', signal });
		if (!response.ok) throw await responseError(response);
	}
	async restoreGrant(grantId: string, signal?: AbortSignal): Promise<void> {
		const response = await fetch(`${this.baseUrl}/v1/grants/${encodeURIComponent(grantId)}/restore`, { method: 'POST', headers: this.headers(), body: '{}', signal });
		if (!response.ok) throw await responseError(response);
	}
	async hubHealth(signal?: AbortSignal): Promise<HubHealth> {
		const response = await fetch(`${this.baseUrl}/v1/hub/health`, { headers: this.headers(), signal });
		if (!response.ok) throw await responseError(response);
		const value = parseHubHealth(await response.json());
		if (!value) throw new Error('Sovereign Hub returned an invalid health response.');
		return value;
	}
	async listHubTasks(signal?: AbortSignal): Promise<HubTask[]> {
		const response = await fetch(`${this.baseUrl}/v1/hub/tasks`, { headers: this.headers(), signal });
		if (!response.ok) throw await responseError(response);
		return parseHubTasks(await response.json());
	}
	async createHubTask(title: string, kind: HubTaskKind, summary = '', signal?: AbortSignal): Promise<HubTask> {
		const response = await fetch(`${this.baseUrl}/v1/hub/tasks`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ version: 1, title, kind, summary }), signal });
		if (!response.ok) throw await responseError(response);
		const task = parseHubTask(await response.json()); if (!task) throw new Error('Sovereign Hub returned an invalid task.'); return task;
	}
	async transitionHubTask(taskId: string, state: HubRunState, signal?: AbortSignal): Promise<HubTask> {
		const response = await fetch(`${this.baseUrl}/v1/hub/tasks/${encodeURIComponent(taskId)}/transition`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ state }), signal });
		if (!response.ok) throw await responseError(response);
		const task = parseHubTask(await response.json()); if (!task) throw new Error('Sovereign Hub returned an invalid task.'); return task;
	}
	async listHubRuns(taskId: string, signal?: AbortSignal): Promise<HubRun[]> {
		const response = await fetch(`${this.baseUrl}/v1/hub/tasks/${encodeURIComponent(taskId)}/runs`, { headers: this.headers(), signal });
		if (!response.ok) throw await responseError(response);
		return parseHubRuns(await response.json());
	}
	async listHubEvents(taskId: string, signal?: AbortSignal): Promise<HubEvent[]> {
		const response = await fetch(`${this.baseUrl}/v1/hub/tasks/${encodeURIComponent(taskId)}/events`, { headers: this.headers(), signal });
		if (!response.ok) throw await responseError(response);
		return parseHubEvents(await response.json());
	}
	async createHubRun(taskId: string, executor: string | null, model: string | null, signal?: AbortSignal): Promise<HubRun> {
		const response = await fetch(`${this.baseUrl}/v1/hub/tasks/${encodeURIComponent(taskId)}/runs`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ ...(executor ? { executor } : {}), ...(model ? { model } : {}) }), signal });
		if (!response.ok) throw await responseError(response);
		const run = parseHubRun(await response.json()); if (!run) throw new Error('Sovereign Hub returned an invalid run.'); return run;
	}
	async bindHubRun(runId: string, executionId: string, hermesRunId: string, signal?: AbortSignal): Promise<HubRun> {
		const response = await fetch(`${this.baseUrl}/v1/hub/runs/${encodeURIComponent(runId)}/bind`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ execution_id: executionId, hermes_run_id: hermesRunId }), signal });
		if (!response.ok) throw await responseError(response);
		const run = parseHubRun(await response.json()); if (!run) throw new Error('Sovereign Hub returned an invalid run.'); return run;
	}
	async verifyHubRun(runId: string, verdict: 'pass' | 'fail', evidenceSummary: string, signal?: AbortSignal): Promise<HubRun> {
		const response = await fetch(`${this.baseUrl}/v1/hub/runs/${encodeURIComponent(runId)}/verify`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ verdict, evidence_summary: evidenceSummary }), signal });
		if (!response.ok) throw await responseError(response);
		const run = parseHubRun(await response.json()); if (!run) throw new Error('Sovereign Hub returned an invalid run.'); return run;
	}
	async listHubMcpServers(signal?: AbortSignal): Promise<HubMcpServer[]> {
		const response = await fetch(`${this.baseUrl}/v1/hub/mcp/servers`, { headers: this.headers(), signal });
		if (!response.ok) throw await responseError(response);
		return parseHubMcpServers(await response.json());
	}
}
