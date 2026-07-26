import type { SovereignRouterSettings } from './settings';
import { findHermesModelRoute } from './hermes-models';
import type { GatekeeperDecision, RouteResult, SkillReference, VaultContextReference } from './types';

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function parseSkill(value: unknown): SkillReference | null | undefined {
	if (value === null) return null;
	if (!isRecord(value) || !isNonEmptyString(value.source) || !isNonEmptyString(value.path)) return undefined;
	if (value.source === 'local') return { source: 'local', path: value.path };
	if (value.source === 'github' && isNonEmptyString(value.repository) && isNonEmptyString(value.ref)) return { source: 'github', repository: value.repository, ref: value.ref, path: value.path };
	return undefined;
}
function parseContext(value: unknown): VaultContextReference | null | undefined {
	if (value === null) return null;
	if (!isRecord(value) || value.source !== 'vault' || !isNonEmptyString(value.query) || value.query.length > 600) return undefined;
	return { source: 'vault', query: value.query.trim() };
}
function parseRuntime(value: unknown): Exclude<import('./types').SessionRuntime, 'auto'> | undefined {
	if (value === undefined || value === 'chat') return 'chat';
	return value === 'hermes' ? 'hermes' : undefined;
}
function parseHermesModel(value: unknown): string | null | undefined {
	if (value === undefined || value === null) return null;
	return isNonEmptyString(value) ? value.trim() : undefined;
}
export function parseGatekeeperDecision(value: unknown): GatekeeperDecision | null {
	if (!isRecord(value) || !isNonEmptyString(value.model) || !Object.prototype.hasOwnProperty.call(value, 'skill')) return null;
	const skill = parseSkill(value.skill);
	const context = Object.prototype.hasOwnProperty.call(value, 'context') ? parseContext(value.context) : null;
	const runtime = parseRuntime(value.runtime);
	const hermesModel = parseHermesModel(value.hermes_model);
	return skill === undefined || context === undefined || runtime === undefined || hermesModel === undefined ? null : { model: value.model.trim(), hermesModel, skill, context, runtime };
}
export function fallbackRoute(settings: SovereignRouterSettings, note: string): RouteResult { return { model: settings.defaultExecutorModel, hermesModel: null, skill: null, context: null, runtime: 'chat', note }; }
export function selectRoute(decision: GatekeeperDecision | null, settings: SovereignRouterSettings): RouteResult {
	if (!decision) return fallbackRoute(settings, 'Gatekeeper response was invalid; using the default model.');
	if (!settings.permittedExecutorModels.includes(decision.model)) return fallbackRoute(settings, 'Gatekeeper selected a model outside the permitted list.');
	const runtime = decision.runtime === 'hermes' && settings.enableHermesAutoRouting ? 'hermes' : 'chat';
	if (runtime === 'hermes') {
		const requestedAlias = decision.hermesModel ?? settings.hermesDefaultModelAlias;
		const route = findHermesModelRoute(settings.hermesModelRoutes, requestedAlias);
		if (!route || route.model !== decision.model || !settings.permittedExecutorModels.includes(route.model)) {
			const fallback = findHermesModelRoute(settings.hermesModelRoutes, settings.hermesDefaultModelAlias);
			if (!fallback || !settings.permittedExecutorModels.includes(fallback.model)) return fallbackRoute(settings, 'No permitted Hermes model route is configured; using the default chat model.');
			return { model: fallback.model, hermesModel: fallback.alias, skill: decision.skill, context: decision.context, runtime, note: 'Gatekeeper selected an unavailable Hermes route; using the default Hermes route.' };
		}
		return { model: route.model, hermesModel: route.alias, skill: decision.skill, context: decision.context, runtime, note: null };
	}
	return { model: decision.model, hermesModel: null, skill: decision.skill, context: decision.context, runtime, note: decision.runtime === 'hermes' ? 'Hermes routing is disabled; using the selected chat model.' : null };
}
export function routingSystemPrompt(settings: SovereignRouterSettings): string {
	const localPaths = settings.skillSearchPaths.length ? settings.skillSearchPaths.join(', ') : 'none';
	const repos = settings.allowedGitHubRepos.length ? settings.allowedGitHubRepos.join(', ') : 'none';
	const hermesRoutes = settings.hermesModelRoutes
		.filter((route) => settings.permittedExecutorModels.includes(route.model))
		.map((route) => `${route.alias} = ${route.model}`)
		.join(', ') || 'none';
	return [settings.routingInstruction, `Permitted executor models: ${settings.permittedExecutorModels.join(', ') || settings.defaultExecutorModel}.`, `Permitted Hermes model routes: ${hermesRoutes}.`, `Local skill folders: ${localPaths}.`, `Permitted GitHub repositories: ${repos}.`, 'A local vault context index is available. Request it only when the user needs information from their vault, using a short focused retrieval query.', 'Use runtime "hermes" only for an explicitly execution-oriented task needing terminal work, subprocesses, local MCP, or a multi-step agent. For runtime "hermes", select a matching permitted hermes_model alias. A selected skill is advisory strategy text only; Hermes still owns native skills, MCPs, tool execution, and permissions. Otherwise use runtime "chat" and hermes_model as null.', 'Return only valid JSON with this exact shape: {"model":"permitted/model","runtime":"chat"|"hermes","hermes_model":null|"permitted-hermes-alias","skill":null|{"source":"local","path":"file.md"}|{"source":"github","repository":"owner/repo","ref":"branch-or-tag","path":"file.md"},"context":null|{"source":"vault","query":"focused retrieval query"}}.'].filter(Boolean).join('\n');
}
