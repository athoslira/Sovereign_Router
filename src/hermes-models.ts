import { MODEL_OPTIONS } from './models';

export interface HermesModelRoute {
	alias: string;
	model: string;
}

export interface ReconciledHermesModelRoutes {
	routes: HermesModelRoute[];
	defaultAlias: string | null;
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

export function findHermesModelRoute(routes: HermesModelRoute[], alias: string | null): HermesModelRoute | null {
	if (!alias) return null;
	return routes.find((route) => route.alias === alias) ?? null;
}

/** Keeps only allowed runtime routes and preserves the preferred model when Hermes changes its alias. */
export function reconcileHermesModelRoutes(
	cachedRoutes: HermesModelRoute[],
	advertisedRoutes: HermesModelRoute[],
	permittedModels: string[],
	previousDefaultAlias: string | null,
): ReconciledHermesModelRoutes {
	const allowed = new Set(permittedModels);
	const preferredModel = findHermesModelRoute(cachedRoutes, previousDefaultAlias)?.model
		?? findHermesModelRoute(advertisedRoutes, previousDefaultAlias)?.model
		?? null;
	const source = advertisedRoutes.length ? advertisedRoutes : cachedRoutes;
	const routes = [...new Map(
		source
			.filter((route) => allowed.has(route.model))
			.map((route) => [route.alias, route]),
	).values()];
	const defaultRoute = (preferredModel ? routes.find((route) => route.model === preferredModel) : null)
		?? findHermesModelRoute(routes, previousDefaultAlias)
		?? routes[0]
		?? null;
	return { routes, defaultAlias: defaultRoute?.alias ?? null };
}
