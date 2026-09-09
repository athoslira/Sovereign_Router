const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

export interface ModelPricing {
	input?: number;
	output?: number;
	cacheRead?: number;
}

export interface CatalogModel {
	id: string;
	name: string;
	contextLength?: number;
	inputModalities: string[];
	outputModalities: string[];
	supportsTools: boolean;
	pricing: ModelPricing;
}

export interface ModelCatalogSnapshot {
	fetchedAt: number;
	models: CatalogModel[];
}

export interface ModelCatalogDelta {
	added: number;
	changed: number;
	removed: number;
}

export type ModelCatalogRefreshSource = 'plugin' | 'hermes';

export interface ModelCatalogRefreshHealth {
	lastAttemptAt: number;
	status: 'success' | 'error';
	source: ModelCatalogRefreshSource;
	durationMs: number;
	modelCount: number;
	delta: ModelCatalogDelta;
	nextAttemptAt: number;
	error: string | null;
}

interface OpenRouterModel {
	id?: unknown;
	name?: unknown;
	context_length?: unknown;
	architecture?: { input_modalities?: unknown; output_modalities?: unknown };
	supported_parameters?: unknown;
	pricing?: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown };
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numberValue(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeOpenRouterModels(value: unknown, fetchedAt = Date.now()): ModelCatalogSnapshot {
	const data = typeof value === 'object' && value !== null && 'data' in value ? (value as { data?: unknown }).data : value;
	const models = Array.isArray(data) ? data : [];
	const normalized: CatalogModel[] = [];
	for (const candidate of models) {
		if (typeof candidate !== 'object' || candidate === null) continue;
		const model = candidate as OpenRouterModel;
		if (typeof model.id !== 'string' || !model.id.trim()) continue;
		const supported = stringArray(model.supported_parameters);
		const pricing = model.pricing;
		normalized.push({
			id: model.id,
			name: typeof model.name === 'string' && model.name.trim() ? model.name : model.id,
			contextLength: numberValue(model.context_length),
			inputModalities: stringArray(model.architecture?.input_modalities),
			outputModalities: stringArray(model.architecture?.output_modalities),
			supportsTools: supported.includes('tools'),
			pricing: {
				input: numberValue(pricing?.prompt),
				output: numberValue(pricing?.completion),
				cacheRead: numberValue(pricing?.input_cache_read),
			},
		});
	}
	return { fetchedAt, models: normalized.sort((left, right) => left.name.localeCompare(right.name)) };
}

export function isCatalogFresh(snapshot: ModelCatalogSnapshot | null, refreshDays: number, now = Date.now()): boolean {
	return Boolean(snapshot && snapshot.fetchedAt > 0 && now - snapshot.fetchedAt < refreshDays * 24 * 60 * 60 * 1000);
}

function nextCatalogAttempt(now: number, refreshDays: number): number {
	return now + Math.max(1, refreshDays) * 24 * 60 * 60 * 1000;
}

function modelSignature(model: CatalogModel): string {
	return JSON.stringify(model);
}

function catalogDelta(previous: ModelCatalogSnapshot | null, current: ModelCatalogSnapshot): ModelCatalogDelta {
	const previousModels = new Map((previous?.models ?? []).map((model) => [model.id, model]));
	const currentModels = new Map(current.models.map((model) => [model.id, model]));
	let added = 0;
	let changed = 0;
	let removed = 0;
	for (const [id, model] of currentModels) {
		const oldModel = previousModels.get(id);
		if (!oldModel) added++;
		else if (modelSignature(oldModel) !== modelSignature(model)) changed++;
	}
	for (const id of previousModels.keys()) if (!currentModels.has(id)) removed++;
	return { added, changed, removed };
}

function catalogError(error: unknown): string {
	const message = error instanceof Error ? error.message : 'Catalog refresh failed.';
	return message.replace(/\s+/g, ' ').trim().slice(0, 240) || 'Catalog refresh failed.';
}

export function catalogRefreshSucceeded(
	previous: ModelCatalogSnapshot | null,
	current: ModelCatalogSnapshot,
	attemptedAt: number,
	durationMs: number,
	refreshDays: number,
	source: ModelCatalogRefreshSource,
): ModelCatalogRefreshHealth {
	return {
		lastAttemptAt: attemptedAt,
		status: 'success',
		source,
		durationMs: Math.max(0, durationMs),
		modelCount: current.models.length,
		delta: catalogDelta(previous, current),
		nextAttemptAt: nextCatalogAttempt(attemptedAt, refreshDays),
		error: null,
	};
}

export function catalogRefreshFailed(
	previous: ModelCatalogSnapshot | null,
	attemptedAt: number,
	durationMs: number,
	refreshDays: number,
	error: unknown,
	source: ModelCatalogRefreshSource,
): ModelCatalogRefreshHealth {
	return {
		lastAttemptAt: attemptedAt,
		status: 'error',
		source,
		durationMs: Math.max(0, durationMs),
		modelCount: previous?.models.length ?? 0,
		delta: { added: 0, changed: 0, removed: 0 },
		nextAttemptAt: nextCatalogAttempt(attemptedAt, refreshDays),
		error: catalogError(error),
	};
}

export async function fetchOpenRouterModelCatalog(
	apiKey: string,
	request: (url: string, headers: Record<string, string>) => Promise<{ status: number; json: unknown }>,
): Promise<ModelCatalogSnapshot> {
	const response = await request(OPENROUTER_MODELS_URL, { Authorization: `Bearer ${apiKey}`, 'X-OpenRouter-Title': 'Sovereign Router' });
	if (response.status < 200 || response.status >= 300) throw new Error(`OpenRouter model catalog request failed (${response.status}).`);
	return normalizeOpenRouterModels(response.json);
}
