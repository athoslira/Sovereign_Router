type MediaCostClass = 'local-free' | 'free-tier' | 'paid';

export interface MediaProviderDescriptorV1 {
	version: 1;
	id: string;
	label: string;
	kind: 'local' | 'hermes';
	costClass: MediaCostClass;
	requiresApproval: boolean;
	capabilities: Array<'generate' | 'edit' | 'compose' | 'optimize'>;
}

export interface ImageOperation {
	path: string;
	title: string;
	svg: string;
	alt: string;
}

export function providerCatalog(): MediaProviderDescriptorV1[] {
	return [
		{ version: 1, id: 'local-svg', label: 'Local SVG', kind: 'local', costClass: 'local-free', requiresApproval: false, capabilities: ['generate', 'edit', 'compose', 'optimize'] },
		{ version: 1, id: 'hermes-image', label: 'Hermes image provider', kind: 'hermes', costClass: 'paid', requiresApproval: true, capabilities: ['generate', 'edit'] },
	];
}

export function isImageRequest(prompt: string): boolean {
	return /\b(images?|illustrations?|graphics?|diagrams?|logos?|banners?|thumbnails?|photos?|image(?:m|ns)|ilustra(?:ção|ções)|gr[aá]ficos?|diagramas?|logotipos?|capas?|fotos?)\b/i.test(prompt)
		&& /\b(create|generate|design|draw|edit|transform|optimize|make|want|need|crie|criar|cria[cç][aã]o|gere|gerar|desenhe|edite|transforme|otimize|fa[cç]a|produza|monte|quero|preciso)\b/i.test(prompt);
}

function safeImagePath(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 500 && ![...value].some((character) => character.charCodeAt(0) < 32) && !value.startsWith('/') && !/^[a-z]:/i.test(value)
		&& /^[^\\/][^\\]*\.svg$/i.test(value) && !value.startsWith('.') && !value.split('/').some((part) => !part || part === '.' || part === '..');
}

function safeSvg(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > 1_000_000 || !/^\s*<svg\b[\s\S]*<\/svg>\s*$/i.test(value)) return false;
	if (/<(?:script|foreignObject|iframe|object|embed|audio|video)\b|<!\s*(?:DOCTYPE|ENTITY)\b|\son\w+\s*=|@import\b|url\(\s*(?!["']?#)/i.test(value)) return false;
	return [...value.matchAll(/(?:^|\s)(?:xlink:)?(?:href|src)\s*=\s*["']([^"']*)["']/gi)].every((match) => match[1]?.startsWith('#'));
}

export function parseImageOperation(value: string): ImageOperation | null {
	const raw = value.match(/```sovereign-image\s*([\s\S]*?)```/i)?.[1];
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<ImageOperation>;
		if (!safeImagePath(parsed.path) || typeof parsed.title !== 'string' || !parsed.title.trim() || !safeSvg(parsed.svg) || typeof parsed.alt !== 'string' || !parsed.alt.trim()) return null;
		return { path: parsed.path.trim(), title: parsed.title.trim(), svg: parsed.svg.trim(), alt: parsed.alt.trim() };
	} catch { return null; }
}

export function stripImageOperation(value: string): string { return value.replace(/\n?```sovereign-image\s*[\s\S]*?```\s*/ig, '').trim(); }

export function imageAuthoringInstruction(outputRoot: string): string {
	return `This request requires an image asset. Begin the normal answer with a concise visual direction covering purpose, aspect ratio, hierarchy, layout, palette, typography, and accessibility. For a deterministic free local result, follow it with one fenced \`sovereign-image\` JSON object containing path (safe relative .svg path below ${outputRoot}), title, accessible alt text, and a complete self-contained SVG. Do not use scripts, event handlers, foreignObject, remote URLs, or embedded data. Never claim it was saved; Sovereign validates and writes it. When the active Hermes runtime advertises a configured image provider and raster generation is appropriate, it may use image_generate after approval; otherwise use the local SVG result.`;
}
