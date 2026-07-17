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

export async function fetchOpenRouterModelCatalog(
	apiKey: string,
	request: (url: string, headers: Record<string, string>) => Promise<{ status: number; json: unknown }>,
): Promise<ModelCatalogSnapshot> {
	const response = await request(OPENROUTER_MODELS_URL, { Authorization: `Bearer ${apiKey}`, 'X-OpenRouter-Title': 'Sovereign Router' });
	if (response.status < 200 || response.status >= 300) throw new Error(`OpenRouter model catalog request failed (${response.status}).`);
	return normalizeOpenRouterModels(response.json);
}
