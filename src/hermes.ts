import { SseParser } from './sse';

export class HermesError extends Error {
	constructor(message: string, readonly status?: number) { super(message); }
}

export interface HermesRun {
	id: string;
}

export interface HermesCallbacks {
	onDelta: (text: string) => void;
	onStatus: (status: string) => void;
}

function allowedHermesUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.username || url.password || url.search || url.hash) return false;
		if (url.protocol === 'https:') return true;
		return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
	} catch (_error) {
		return false;
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
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
}
