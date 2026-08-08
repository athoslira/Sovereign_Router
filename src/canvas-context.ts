import { App, TFile } from 'obsidian';
import { limitDocumentContent, type AttachedDocument } from './document-context';
import { isTextDocument } from './document-files';
import { isCanvasImage, parseCanvas, type CanvasAsset, type CanvasAssetKind } from './canvas';

const MAX_LINKED_NOTES = 8;
const MAX_LINKED_NOTE_CHARS = 12_000;

export interface ResolvedCanvasAsset extends CanvasAsset {
	size: number | null;
	canvasId: string;
}

export interface CanvasAttachment {
	id: string;
	document: AttachedDocument;
	assets: ResolvedCanvasAsset[];
	warnings: string[];
}

export class CanvasContextResolver {
	constructor(private readonly app: App, private readonly maximumNodes: number) {}

	async resolve(file: TFile): Promise<CanvasAttachment> {
		const parsed = parseCanvas(await this.app.vault.cachedRead(file), file.name, this.maximumNodes);
		if (!parsed.markdown) throw new Error(parsed.warnings[0] || 'Canvas content is unavailable.');
		const warnings = [...parsed.warnings];
		const id = `canvas-${file.path}-${file.stat.mtime}`;
		const assets: ResolvedCanvasAsset[] = [];
		const linkedNotes: string[] = [];
		for (const asset of parsed.assets) {
			const linked = this.app.vault.getFileByPath(asset.path);
			if (!linked) {
				warnings.push(`Referenced asset is not available in this vault: ${asset.path}.`);
				continue;
			}
			assets.push({ ...asset, size: linked.stat.size, canvasId: id });
			if (asset.kind === 'note' && linkedNotes.length < MAX_LINKED_NOTES && isTextDocument(linked.name)) {
				try {
					const content = await this.app.vault.cachedRead(linked);
					linkedNotes.push(`### Linked note: ${linked.path}\n${content.slice(0, MAX_LINKED_NOTE_CHARS)}${content.length > MAX_LINKED_NOTE_CHARS ? '\n\n[Linked note truncated.]' : ''}`);
				} catch { warnings.push(`Could not read linked note: ${linked.path}.`); }
			}
		}
		if (parsed.assets.filter((asset) => asset.kind === 'note').length > linkedNotes.length) warnings.push('Some linked notes were omitted by the Canvas context limit.');
		const limited = limitDocumentContent([parsed.markdown, ...linkedNotes].join('\n\n---\n\n'));
		return {
			id,
			document: { name: `Canvas: ${file.name} · ${parsed.nodeCount} nodes · ${assets.filter((asset) => asset.kind === 'image').length} images`, markdown: limited.content, truncated: limited.truncated },
			assets,
			warnings,
		};
	}

	async imageDataUrl(asset: ResolvedCanvasAsset, maximumBytes: number): Promise<string | null> {
		if (asset.kind !== 'image' || asset.size === null || asset.size > maximumBytes || !isCanvasImage(asset.path)) return null;
		const file = this.app.vault.getFileByPath(asset.path);
		if (!file) return null;
		const bytes = new Uint8Array(await this.app.vault.readBinary(file));
		let binary = '';
		for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
		return `data:${mimeType(asset.path)};base64,${btoa(binary)}`;
	}
}

function mimeType(path: string): string {
	const extension = path.split('.').pop()?.toLowerCase();
	return extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
		: extension === 'png' ? 'image/png'
			: extension === 'gif' ? 'image/gif'
				: extension === 'webp' ? 'image/webp'
					: extension === 'svg' ? 'image/svg+xml'
						: 'application/octet-stream';
}

export function canvasMediaSummary(assets: ResolvedCanvasAsset[]): string | null {
	const byKind = assets.reduce<Record<CanvasAssetKind, string[]>>((result, asset) => { (result[asset.kind] ??= []).push(asset.path); return result; }, { image: [], video: [], audio: [], document: [], note: [], unknown: [] });
	const media = ['video', 'audio'].flatMap((kind) => byKind[kind as CanvasAssetKind].map((path) => `${kind}: ${path}`));
	return media.length ? `Canvas media references (inspect only when available and approved in the host workspace):\n${media.map((item) => `- ${item}`).join('\n')}` : null;
}
