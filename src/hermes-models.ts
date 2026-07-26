import { MODEL_OPTIONS } from './models';

export interface HermesModelRoute {
	alias: string;
	model: string;
}

export function hermesModelAlias(model: string): string {
	const normalized = model
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `sr-${normalized}`;
}

export const DEFAULT_HERMES_MODEL_ROUTES: HermesModelRoute[] = MODEL_OPTIONS.map((option) => ({
	alias: hermesModelAlias(option.id),
	model: option.id,
}));

export const DEFAULT_HERMES_MODEL_ALIAS = hermesModelAlias('deepseek/deepseek-v4-flash');

export function parseHermesModelRoutes(value: string): HermesModelRoute[] {
	const routes = new Map<string, HermesModelRoute>();
	for (const line of value.split(/\r?\n/)) {
		const [rawAlias, ...rawModel] = line.split('=');
		const alias = rawAlias?.trim() ?? '';
		const model = rawModel.join('=').trim();
		if (!alias || !model || !/^[a-zA-Z0-9._-]+$/.test(alias)) continue;
		routes.set(alias, { alias, model });
	}
	return [...routes.values()];
}

export function formatHermesModelRoutes(routes: HermesModelRoute[]): string {
	return routes.map((route) => `${route.alias} = ${route.model}`).join('\n');
}

export function findHermesModelRoute(routes: HermesModelRoute[], alias: string | null): HermesModelRoute | null {
	if (!alias) return null;
	return routes.find((route) => route.alias === alias) ?? null;
}
