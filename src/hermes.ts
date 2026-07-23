import { SseParser } from './sse';
import { isSecureOrLocalHttpEndpoint } from './endpoint-policy';

export class HermesError extends Error {
	constructor(message: string, readonly status?: number) { super(message); }
}

export interface HermesRun {
	id: string;
}

export type HermesJobAction = 'run' | 'pause' | 'resume';

export interface HermesJob {
	id: string;
	name: string;
	schedule: string;
	status: string;
	lastRunAt: string | null;
	nextRunAt: string | null;
	model: string | null;
	provider: string | null;
	skills: string[];
}

export interface CreateHermesJobInput {
	name: string;
	schedule: string;
	prompt: string;
	provider?: string;
	skills?: string[];
}

export interface UpdateHermesJobInput {
	name?: string;
	schedule?: string;
	provider?: string | null;
	skills?: string[];
}

export interface HermesRuntimeStatus {
	jobsSupported: boolean | null;
	endpoint: 'capabilities' | 'models';
}

export interface HermesCallbacks {
	onDelta: (text: string) => void;
	onStatus: (status: string) => void;
}

function allowedHermesUrl(value: string): boolean {
	return isSecureOrLocalHttpEndpoint(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function displayValue(value: unknown): string {
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	if (value && typeof value === 'object') {
		try { return JSON.stringify(value); } catch (_error) { return 'Configured'; }
	}
	return '';
}

function firstText(record: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const value = displayValue(record[key]);
		if (value) return value;
	}
	return '';
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function capabilityFlag(value: unknown): boolean | null {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') return value.length > 0;
	return null;
}

export function parseHermesRuntimeStatus(value: unknown, endpoint: HermesRuntimeStatus['endpoint']): HermesRuntimeStatus {
	const root = asRecord(value);
	const features = asRecord(root?.features);
	const endpoints = asRecord(root?.endpoints);
	const candidates = [
		root?.jobs, root?.session_jobs, root?.jobs_api,
		features?.jobs, features?.session_jobs, features?.jobs_api,
		endpoints?.jobs, endpoints?.session_jobs, endpoints?.jobs_api,
	];
	for (const candidate of candidates) {
		const result = capabilityFlag(candidate);
		if (result !== null) return { jobsSupported: result, endpoint };
	}
	return { jobsSupported: null, endpoint };
}

/** Normalizes the small differences between Hermes API versions without exposing raw job prompts. */
export function normalizeHermesJobs(value: unknown): HermesJob[] {
	const root = asRecord(value);
	const candidates = Array.isArray(value)
		? value
		: Array.isArray(root?.jobs)
			? root.jobs
			: Array.isArray(root?.data)
				? root.data
				: [];
	return candidates.flatMap((candidate) => {
		const job = asRecord(candidate);
		if (!job) return [];
		const id = firstText(job, ['id', 'job_id']);
		if (!id) return [];
		const paused = job.paused === true || job.enabled === false;
		const reportedStatus = firstText(job, ['status', 'state']);
		return [{
			id,
			name: firstText(job, ['name', 'title']) || `Job ${id.slice(0, 8)}`,
			schedule: firstText(job, ['schedule', 'cron', 'expression']) || 'Schedule unavailable',
			status: paused ? 'paused' : reportedStatus || 'active',
			lastRunAt: firstText(job, ['last_run_at', 'lastRunAt', 'last_run']) || null,
			nextRunAt: firstText(job, ['next_run_at', 'nextRunAt', 'next_run']) || null,
			model: firstText(job, ['model']) || null,
			provider: firstText(job, ['provider']) || null,
			skills: stringList(job.skills),
		}];
	});
}

function textFromEvent(value: unknown): string | null {
	const payload = asRecord(value);
	if (!payload) return null;
	for (const key of ['delta', 'text', 'content']) {
		if (typeof payload[key] === 'string') return payload[key];
	}
	const nested = asRecord(payload.delta) || asRecord(payload.message) || asRecord(payload.output);
	if (!nested) return null;
	for (const key of ['text', 'content', 'delta']) if (typeof nested[key] === 'string') return nested[key];
	return null;
}

function statusFromEvent(value: unknown): string | null {
	const payload = asRecord(value);
	if (!payload) return null;
	const type = typeof payload.type === 'string' ? payload.type : typeof payload.event === 'string' ? payload.event : '';
	if (!type) return null;
	if (type.includes('tool')) {
		const tool = typeof payload.tool_name === 'string' ? `: ${payload.tool_name}` : '';
		return `Hermes ${type.replace(/[._]/g, ' ')}${tool}`;
	}
	if (type.includes('approval')) return 'Hermes is waiting for an approval in its console.';
	return null;
}

async function errorFromResponse(response: Response): Promise<HermesError> {
	let message = `Hermes request failed (${response.status}).`;
	try {
		const body = asRecord(await response.json());
		const error = asRecord(body?.error);
		if (typeof error?.message === 'string') message = error.message;
		else if (typeof body?.message === 'string') message = body.message;
	} catch (_error) { /* HTTP status remains actionable. */ }
	return new HermesError(message, response.status);
}

export class HermesClient {
	private readonly baseUrl: string;

	constructor(baseUrl: string, private readonly apiKey: string) {
		if (!allowedHermesUrl(baseUrl)) throw new HermesError('Hermes URL must use HTTPS, or HTTP only on localhost.');
		this.baseUrl = baseUrl.replace(/\/$/, '');
	}

	private headers(): Record<string, string> {
		return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
	}

	async startRun(input: string, sessionId: string, instructions: string | null, signal: AbortSignal): Promise<HermesRun> {
		const response = await fetch(`${this.baseUrl}/v1/runs`, {
			method: 'POST', headers: this.headers(), signal,
			body: JSON.stringify({ input, session_id: sessionId, ...(instructions ? { instructions } : {}) }),
		});
		if (!response.ok) throw await errorFromResponse(response);
		const result = asRecord(await response.json());
		const id = typeof result?.id === 'string' ? result.id : typeof result?.run_id === 'string' ? result.run_id : '';
		if (!id) throw new HermesError('Hermes did not return a run identifier.');
		return { id };
	}

	async streamRun(runId: string, callbacks: HermesCallbacks, signal: AbortSignal): Promise<void> {
		const response = await fetch(`${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, { headers: this.headers(), signal });
		if (!response.ok) throw await errorFromResponse(response);
		if (!response.body) throw new HermesError('Hermes streaming response is unavailable.');
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		const parser = new SseParser();
		const handle = (event: string): void => {
			if (!event || event === '[DONE]') return;
			try {
				const payload: unknown = JSON.parse(event);
				const status = statusFromEvent(payload);
				if (status) callbacks.onStatus(status);
				const text = textFromEvent(payload);
				if (text) callbacks.onDelta(text);
			} catch (_error) {
				// Hermes may send harmless non-JSON keepalives; they do not affect the run.
			}
		};
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			for (const event of parser.push(decoder.decode(value, { stream: true }))) handle(event);
		}
		for (const event of parser.push(decoder.decode())) handle(event);
		for (const event of parser.finish()) handle(event);
	}

	async stopRun(runId: string): Promise<void> {
		const response = await fetch(`${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST', headers: this.headers() });
		if (!response.ok && response.status !== 404) throw await errorFromResponse(response);
	}

	async listJobs(signal?: AbortSignal): Promise<HermesJob[]> {
		const response = await fetch(`${this.baseUrl}/api/jobs`, { headers: this.headers(), signal });
		if (!response.ok) throw await errorFromResponse(response);
		return normalizeHermesJobs(await response.json());
	}

	async inspectRuntime(signal?: AbortSignal): Promise<HermesRuntimeStatus> {
		const capabilities = await fetch(`${this.baseUrl}/v1/capabilities`, { headers: this.headers(), signal });
		if (capabilities.ok) return parseHermesRuntimeStatus(await capabilities.json(), 'capabilities');
		if (capabilities.status !== 404) throw await errorFromResponse(capabilities);
		const models = await fetch(`${this.baseUrl}/v1/models`, { headers: this.headers(), signal });
		if (!models.ok) throw await errorFromResponse(models);
		return parseHermesRuntimeStatus(await models.json(), 'models');
	}

	async runJobAction(jobId: string, action: HermesJobAction, signal?: AbortSignal): Promise<void> {
		const response = await fetch(`${this.baseUrl}/api/jobs/${encodeURIComponent(jobId)}/${action}`, {
			method: 'POST', headers: this.headers(), signal,
		});
		if (!response.ok) throw await errorFromResponse(response);
	}

	async createJob(input: CreateHermesJobInput, signal?: AbortSignal): Promise<void> {
		const response = await fetch(`${this.baseUrl}/api/jobs`, {
			method: 'POST', headers: this.headers(), signal,
			body: JSON.stringify(input),
		});
		if (!response.ok) throw await errorFromResponse(response);
	}

	async deleteJob(jobId: string, signal?: AbortSignal): Promise<void> {
		const response = await fetch(`${this.baseUrl}/api/jobs/${encodeURIComponent(jobId)}`, {
			method: 'DELETE', headers: this.headers(), signal,
		});
		if (!response.ok) throw await errorFromResponse(response);
	}

	async updateJob(jobId: string, input: UpdateHermesJobInput, signal?: AbortSignal): Promise<void> {
		const response = await fetch(`${this.baseUrl}/api/jobs/${encodeURIComponent(jobId)}`, {
			method: 'PATCH', headers: this.headers(), signal,
			body: JSON.stringify(input),
		});
		if (!response.ok) throw await errorFromResponse(response);
	}
}
