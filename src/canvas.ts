import { isSafeRelativePath } from './skill-policy';

export type CanvasAssetKind = 'image' | 'video' | 'audio' | 'document' | 'note' | 'unknown';

export interface CanvasAsset {
	id: string;
	nodeId: string;
	path: string;
	kind: CanvasAssetKind;
	label: string;
}

export interface ParsedCanvas {
	markdown: string;
	assets: CanvasAsset[];
	warnings: string[];
	nodeCount: number;
	edgeCount: number;
}

interface CanvasNode {
	id: string;
	type: 'text' | 'file' | 'link' | 'group';
	text?: string;
	file?: string;
	url?: string;
	label?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	color?: string;
}

interface CanvasEdge { fromNode: string; toNode: string; label?: string; color?: string; }

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'odt', 'ods', 'odp', 'epub']);
const NOTE_EXTENSIONS = new Set(['md', 'txt', 'text', 'csv', 'html', 'htm']);

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }

function extension(path: string): string {
	const index = path.lastIndexOf('.');
	return index === -1 ? '' : path.slice(index + 1).toLowerCase();
}

export function canvasAssetKind(path: string): CanvasAssetKind {
	const value = extension(path);
	if (IMAGE_EXTENSIONS.has(value)) return 'image';
	if (VIDEO_EXTENSIONS.has(value)) return 'video';
	if (AUDIO_EXTENSIONS.has(value)) return 'audio';
	if (DOCUMENT_EXTENSIONS.has(value)) return 'document';
	if (NOTE_EXTENSIONS.has(value)) return 'note';
	return 'unknown';
}

export function isCanvasFile(fileName: string): boolean { return extension(fileName) === 'canvas'; }
export function isCanvasImage(fileName: string): boolean { return canvasAssetKind(fileName) === 'image'; }

function parseNode(value: unknown): CanvasNode | null {
	const item = record(value);
	const id = string(item?.id);
	const type = string(item?.type);
	if (!id || (type !== 'text' && type !== 'file' && type !== 'link' && type !== 'group')) return null;
	return {
		id, type, text: string(item?.text), file: string(item?.file), url: string(item?.url), label: string(item?.label),
		x: number(item?.x), y: number(item?.y), width: number(item?.width), height: number(item?.height), color: string(item?.color),
	};
}

function parseEdge(value: unknown): CanvasEdge | null {
	const item = record(value);
	const fromNode = string(item?.fromNode);
	const toNode = string(item?.toNode);
	return fromNode && toNode ? { fromNode, toNode, label: string(item?.label), color: string(item?.color) } : null;
}

function clipped(value: string | undefined, maximum = 3_000): string {
	if (!value) return '';
	return value.length > maximum ? `${value.slice(0, maximum)}…` : value;
}

function nodeLabel(node: CanvasNode): string {
	if (node.type === 'text') return clipped(node.text, 120) || 'Untitled text';
	if (node.type === 'file') return node.file || 'Missing file reference';
	if (node.type === 'link') return node.label || node.url || 'Untitled link';
	return node.label || 'Untitled group';
}

function withinGroup(node: CanvasNode, group: CanvasNode): boolean {
	return node.x !== undefined && node.y !== undefined && group.x !== undefined && group.y !== undefined
		&& group.width !== undefined && group.height !== undefined
		&& node.x >= group.x && node.y >= group.y && node.x <= group.x + group.width && node.y <= group.y + group.height;
}

/** Parses Canvas JSON into bounded, readable local context. It never reads linked files or fetches URLs. */
export function parseCanvas(source: string, name: string, maximumNodes = 250): ParsedCanvas {
	let root: Record<string, unknown> | null;
	try { root = record(JSON.parse(source)); } catch { return { markdown: '', assets: [], warnings: ['The Canvas file is not valid JSON.'], nodeCount: 0, edgeCount: 0 }; }
	const allNodes = Array.isArray(root?.nodes) ? root.nodes.flatMap((item) => {
		const node = parseNode(item);
		return node ? [node] : [];
	}) : [];
	const edges = Array.isArray(root?.edges) ? root.edges.flatMap((item) => {
		const edge = parseEdge(item);
		return edge ? [edge] : [];
	}) : [];
	const warnings: string[] = [];
	const nodes = allNodes.slice(0, Math.max(1, maximumNodes));
	if (allNodes.length > nodes.length) warnings.push(`${allNodes.length - nodes.length} Canvas nodes were omitted by the configured safety limit.`);
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const groups = nodes.filter((node) => node.type === 'group');
	const assets: CanvasAsset[] = [];
	const lines = [`# Canvas context: ${name}`, '', `Structure: ${allNodes.length} nodes · ${edges.length} connections.`];
	if (groups.length) {
		lines.push('', '## Groups');
		for (const group of groups) lines.push(`- ${nodeLabel(group)}${group.color ? ` (color ${group.color})` : ''}`);
	}
	lines.push('', '## Nodes in visual order');
	for (const node of [...nodes].sort((left, right) => (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0))) {
		const membership = groups.filter((group) => group.id !== node.id && withinGroup(node, group)).map(nodeLabel);
		const groupSuffix = membership.length ? ` · group: ${membership.join(', ')}` : '';
		if (node.type === 'text') lines.push(`- Text: ${clipped(node.text)}${groupSuffix}`);
		else if (node.type === 'group') continue;
		else if (node.type === 'link') lines.push(`- External link: ${nodeLabel(node)}${node.url ? ` → ${node.url}` : ''}${groupSuffix}`);
		else {
			const path = node.file || '';
			if (!isSafeRelativePath(path)) {
				warnings.push(`Ignored an unsafe Canvas file reference: ${path || 'empty path'}.`);
				continue;
			}
			const kind = canvasAssetKind(path);
			assets.push({ id: `asset-${node.id}`, nodeId: node.id, path, kind, label: nodeLabel(node) });
			lines.push(`- ${kind === 'note' ? 'Vault note' : `${kind[0]!.toUpperCase()}${kind.slice(1)} asset`}: [[${path}]]${groupSuffix}`);
		}
	}
	const validEdges = edges.filter((edge) => byId.has(edge.fromNode) && byId.has(edge.toNode));
	if (validEdges.length) {
		lines.push('', '## Connections');
		for (const edge of validEdges.slice(0, 300)) {
			const from = byId.get(edge.fromNode);
			const to = byId.get(edge.toNode);
			if (from && to) lines.push(`- ${nodeLabel(from)} → ${nodeLabel(to)}${edge.label ? ` (${edge.label})` : ''}`);
		}
	}
	if (assets.length) {
		const counts = assets.reduce<Record<CanvasAssetKind, number>>((result, asset) => { result[asset.kind] = (result[asset.kind] ?? 0) + 1; return result; }, { image: 0, video: 0, audio: 0, document: 0, note: 0, unknown: 0 });
		lines.push('', `Assets: ${Object.entries(counts).filter(([, count]) => count > 0).map(([kind, count]) => `${count} ${kind}`).join(', ')}.`);
	}
	if (warnings.length) lines.push('', '## Limits and warnings', ...warnings.map((warning) => `- ${warning}`));
	return { markdown: lines.join('\n'), assets, warnings, nodeCount: allNodes.length, edgeCount: edges.length };
}
