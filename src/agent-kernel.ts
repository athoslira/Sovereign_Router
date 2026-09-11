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
}
