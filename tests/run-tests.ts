import * as assert from 'node:assert/strict';
import { buildDocumentContext, limitDocumentContent, MAX_DOCUMENT_CHARS } from '../src/document-context';
import { isSecureOrLocalHttpEndpoint } from '../src/endpoint-policy';
import { isSupportedDocument, isTextDocument, needsDoclingConversion } from '../src/document-files';
import { contextTerms, extractContextExcerpt, rankContextEntries } from '../src/context-search';
import { DEFAULT_EXECUTOR_MODELS, modelLabel } from '../src/models';
import { isCatalogFresh, normalizeOpenRouterModels } from '../src/model-catalog';
import { parseMcpToolCalls, toExecutorTools } from '../src/mcp-tools';
import { canCallMcpTool, isAllowedMcpEndpoint } from '../src/mcp-policy';
import { parseGatekeeperDecision, selectRoute } from '../src/routing';
import { isAllowedGitHubRepository, isSafeRelativePath } from '../src/skill-policy';
import { hermesProviderOverrideError } from '../src/hermes-policy';
import { OperationalMetrics } from '../src/operational-metrics';
import { normalizeHermesJobs, parseHermesRuntimeStatus } from '../src/hermes';
import { SseParser } from '../src/sse';
import type { SovereignRouterSettings } from '../src/settings';

const settings: SovereignRouterSettings = {
	openRouterSecretName: '',
	gatekeeperModel: 'deepseek/deepseek-v4-flash',
	defaultExecutorModel: 'moonshotai/kimi-k2.7-code',
	permittedExecutorModels: ['moonshotai/kimi-k2.7-code'],
	customModelSlugs: [],
	modelCatalog: null,
	modelCatalogRefreshDays: 15,
	modelCatalogVersion: 1,
	routingInstruction: '',
	skillSearchPaths: [],
	allowedGitHubRepos: [],
	doclingServiceUrl: '',
	doclingSecretName: '',
	hermesServiceUrl: '',
	hermesSecretName: '',
	enableHermesAutoRouting: false,
	hermesPermittedProviderOverrides: [],
	mcpServers: [],
};

function run(name: string, check: () => void): void {
	check();
	console.log(`✓ ${name}`);
}

run('validates permitted routes, context decisions, and fallback routes', () => {
	const valid = parseGatekeeperDecision({ model: settings.defaultExecutorModel, skill: { source: 'local', path: 'coding.md' }, context: { source: 'vault', query: 'project roadmap' } });
	assert.equal(selectRoute(valid, settings).note, null);
	assert.equal(selectRoute(valid, settings).context?.query, 'project roadmap');
	assert.equal(parseGatekeeperDecision({ model: 'invalid' }), null);
	const unpermitted = parseGatekeeperDecision({ model: 'untrusted/model', skill: null, context: null });
	assert.equal(selectRoute(unpermitted, settings).model, settings.defaultExecutorModel);
	const hermes = parseGatekeeperDecision({ model: settings.defaultExecutorModel, runtime: 'hermes', skill: null, context: null });
	assert.equal(selectRoute(hermes, settings).runtime, 'chat');
	assert.equal(selectRoute(hermes, { ...settings, enableHermesAutoRouting: true }).runtime, 'hermes');
});

run('blocks unsafe skill paths and unapproved GitHub repositories', () => {
	assert.equal(isSafeRelativePath('prompts/code.md'), true);
	assert.equal(isSafeRelativePath('../secret.md'), false);
	assert.equal(isSafeRelativePath('C:\\secret.md'), false);
	assert.equal(isAllowedGitHubRepository('owner/repo', ['owner/repo']), true);
	assert.equal(isAllowedGitHubRepository('owner/other', ['owner/repo']), false);
});

run('parses fragmented SSE data, comments, usage, and done events', () => {
	const parser = new SseParser();
	assert.deepEqual(parser.push('data: {"choices":[{"delta":{"content":"Hel'), []);
	assert.deepEqual(parser.push('lo"}}]}\n\n: keepalive\n\ndata: [DONE]\n\n'), ['{"choices":[{"delta":{"content":"Hello"}}]}', '[DONE]']);
	parser.push('data: {"usage":{"cost":0.01}}');
	assert.deepEqual(parser.finish(), ['{"usage":{"cost":0.01}}']);
});

run('exposes the requested model catalogue with the canonical Kimi slug', () => {
	assert.equal(DEFAULT_EXECUTOR_MODELS.length, 6);
	assert.equal(DEFAULT_EXECUTOR_MODELS.includes('moonshotai/kimi-k2.7-code'), true);
	assert.equal(modelLabel('x-ai/grok-4.3'), 'Grok 4.3');
});

run('normalizes OpenRouter catalog data without auto-authorizing discovered models', () => {
	const catalog = normalizeOpenRouterModels({ data: [{
		id: 'provider/example', name: 'Example', context_length: 128000,
		architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
		supported_parameters: ['tools'], pricing: { prompt: 0.000001, completion: 0.000002, input_cache_read: 0.0000001 },
	}] }, 1000);
	assert.equal(catalog.models[0]?.supportsTools, true);
	assert.equal(catalog.models[0]?.pricing.input, 0.000001);
	assert.equal(settings.permittedExecutorModels.includes('provider/example'), false);
	assert.equal(isCatalogFresh(catalog, 15, 1001), true);
	assert.equal(isCatalogFresh(catalog, 15, 1000 + 16 * 24 * 60 * 60 * 1000), false);
});

run('limits document context while preserving the attachment label', () => {
	const limited = limitDocumentContent('a'.repeat(MAX_DOCUMENT_CHARS + 1));
	assert.equal(limited.truncated, true);
	const context = buildDocumentContext([{ name: 'report.pdf', markdown: limited.content, truncated: true }]);
	assert.match(context || '', /Attached document: report.pdf/);
});

run('classifies vault files for local reading or Docling conversion', () => {
	assert.equal(isTextDocument('note.md'), true);
	assert.equal(needsDoclingConversion('report.pdf'), true);
	assert.equal(isSupportedDocument('slides.pptx'), true);
	assert.equal(isSupportedDocument('archive.zip'), false);
});

run('restricts Docling transport to HTTPS or local HTTP', () => {
	assert.equal(isSecureOrLocalHttpEndpoint('https://docling.example.com/api'), true);
	assert.equal(isSecureOrLocalHttpEndpoint('http://localhost:5001'), true);
	assert.equal(isSecureOrLocalHttpEndpoint('http://docling.example.com'), false);
	assert.equal(isSecureOrLocalHttpEndpoint('https://key@docling.example.com'), false);
});

run('indexes and retrieves focused local context without retaining raw vault text', () => {
	const terms = contextTerms('Projeto Héstia possui roteiro, roteiro e orçamento.');
	assert.equal(terms.includes('roteiro'), true);
	const ranked = rankContextEntries([
		{ id: '1', path: 'Projects/Hestia.md', title: 'Projeto Héstia', terms: ['projeto', 'roteiro', 'orcamento'] },
		{ id: '2', path: 'Notes/Recipes.md', title: 'Recipes', terms: ['food', 'kitchen'] },
	], 'roteiro do projeto');
	assert.equal(ranked[0]?.id, '1');
	const excerpt = extractContextExcerpt(`${'x'.repeat(15_000)} roteiro prioritário`, 'roteiro', 100);
	assert.match(excerpt, /roteiro prioritário/);
});

run('restricts MCP endpoints and requires confirmation for enabled write tools', () => {
	const server = { id: 'weather', name: 'Weather', url: 'https://mcp.example.com/mcp', secretName: '', enabled: true, allowWriteTools: true };
	const readTool = { serverId: 'weather', serverName: 'Weather', name: 'forecast', description: '', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } };
	const writeTool = { ...readTool, name: 'save_location', annotations: {} };
	assert.equal(isAllowedMcpEndpoint('https://mcp.example.com/mcp'), true);
	assert.equal(isAllowedMcpEndpoint('http://mcp.example.com/mcp'), false);
	assert.equal(isAllowedMcpEndpoint('http://localhost:3000/mcp'), true);
	assert.equal(canCallMcpTool(readTool, server).requiresConfirmation, false);
	assert.equal(canCallMcpTool(writeTool, server).requiresConfirmation, true);
	assert.equal(canCallMcpTool(writeTool, { ...server, allowWriteTools: false }).allowed, false);
});

run('maps only known MCP tools from model calls', () => {
	const tool = { serverId: 'weather', serverName: 'Weather', name: 'forecast', description: 'Forecast', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } };
	const executorTool = toExecutorTools([tool])[0];
	assert.ok(executorTool);
	const calls = parseMcpToolCalls([{ id: 'call-1', type: 'function', function: { name: executorTool.function.name, arguments: '{"city":"Sao Paulo"}' } }], [tool]);
	assert.equal('error' in calls[0]!, false);
});

run('normalizes Hermes job payloads without retaining job prompts', () => {
	const jobs = normalizeHermesJobs({ jobs: [
		{ id: 'job-1', name: 'Catalog refresh', schedule: '0 3 */15 * *', paused: false, last_run_at: '2026-07-20T03:00:00Z', model: 'deepseek/deepseek-v4-flash', skills: ['catalog-research'] },
		{ job_id: 'job-2', cron: '0 */6 * * *', enabled: false, prompt: 'This must not be copied into the control panel.' },
	] });
	assert.equal(jobs.length, 2);
	assert.equal(jobs[0]?.status, 'active');
	assert.equal(jobs[0]?.model, 'deepseek/deepseek-v4-flash');
	assert.deepEqual(jobs[0]?.skills, ['catalog-research']);
	assert.equal(jobs[1]?.status, 'paused');
	assert.equal(JSON.stringify(jobs).includes('must not be copied'), false);
});

run('detects Hermes job support only from declared capabilities', () => {
	assert.equal(parseHermesRuntimeStatus({ endpoints: { jobs: true } }, 'capabilities').jobsSupported, true);
	assert.equal(parseHermesRuntimeStatus({ features: { session_jobs: false } }, 'capabilities').jobsSupported, false);
	assert.equal(parseHermesRuntimeStatus({ data: [] }, 'models').jobsSupported, null);
});

run('enforces explicit Hermes provider override policy', () => {
	assert.equal(hermesProviderOverrideError(null, []), null);
	assert.equal(hermesProviderOverrideError('openrouter', []), 'The Hermes provider override is not in the permitted list.');
	assert.equal(hermesProviderOverrideError('openrouter', ['openrouter']), null);
	assert.equal(hermesProviderOverrideError('unknown', ['openrouter']), 'The Hermes provider override is not in the permitted list.');
});

run('keeps local FinOps totals only in memory and avoids duplicate usage events', () => {
	const metrics = new OperationalMetrics();
	metrics.recordDirectResponseCost(undefined, 0.012);
	metrics.recordDirectResponseCost(0.012, 0.015);
	metrics.recordDirectResponseCost(0.015, 0.015);
	assert.deepEqual(metrics.snapshot(), { directResponses: 1, directCostUsd: 0.015 });
});
