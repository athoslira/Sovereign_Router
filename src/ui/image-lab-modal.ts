import { App, Modal, Notice, Setting, TFile, TFolder } from 'obsidian';
import { imageOutputName, optimizeRasterImage, supportedRasterImage, type RasterOutputFormat } from '../image-processing';
import { vaultOutputPath } from '../vault-path-policy';

export function openImageLab(app: App, outputRoot: string): void { new ImageLabModal(app, outputRoot).open(); }

class ImageLabModal extends Modal {
	private maxWidth = 1600;
	private maxHeight = 1600;
	private quality = 0.86;
	private format: RasterOutputFormat = 'webp';
	private processing = false;
	constructor(app: App, private readonly outputRoot: string) { super(app); }
	onOpen(): void {
		this.titleEl.setText('Optimize active image');
		const file = this.app.workspace.getActiveFile();
		this.contentEl.createEl('p', { text: file && supportedRasterImage(file.path) ? `Input: ${file.path}` : 'Open a PNG, JPEG, or WebP file in this vault first.' });
		new Setting(this.contentEl).setName('Maximum width').addText((text) => text.setValue(String(this.maxWidth)).onChange((value) => { this.maxWidth = positive(value, 1600); }));
		new Setting(this.contentEl).setName('Maximum height').addText((text) => text.setValue(String(this.maxHeight)).onChange((value) => { this.maxHeight = positive(value, 1600); }));
		new Setting(this.contentEl).setName('Output format').addDropdown((dropdown) => dropdown.addOption('webp', 'WebP').addOption('png', 'PNG').setValue(this.format).onChange((value) => { this.format = value as RasterOutputFormat; }));
		new Setting(this.contentEl).setName('Quality').setDesc('Used by WebP. PNG output is lossless.').addSlider((slider) => slider.setLimits(40, 100, 1).setValue(Math.round(this.quality * 100)).setDynamicTooltip().onChange((value) => { this.quality = value / 100; }));
		new Setting(this.contentEl).addButton((button) => button.setButtonText('Optimize locally').setCta().setDisabled(!file || !supportedRasterImage(file.path)).onClick(() => void this.process(file, button.buttonEl)));
	}
	private async process(file: TFile | null, button: HTMLButtonElement): Promise<void> {
		if (!file || this.processing || !supportedRasterImage(file.path)) return;
		this.processing = true; button.disabled = true; button.setText('Optimizing...');
		try {
			const input = await this.app.vault.readBinary(file);
			const mime = /\.png$/i.test(file.name) ? 'image/png' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/jpeg';
			const output = await optimizeRasterImage(input, mime, this.maxWidth, this.maxHeight, this.format, this.quality);
			const path = vaultOutputPath(this.outputRoot, imageOutputName(file.path, this.format));
			await ensureFolders(this.app, path);
			const existing = this.app.vault.getFileByPath(path);
			if (existing) await this.app.vault.modifyBinary(existing, output);
			else await this.app.vault.createBinary(path, output);
			await writeProvenance(this.app, path, file.path, this.maxWidth, this.maxHeight, this.format, this.quality);
			new Notice(`Optimized image saved to ${path}.`);
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : 'The image could not be optimized.');
			this.processing = false; button.disabled = false; button.setText('Optimize locally');
		}
	}
}

function positive(value: string, fallback: number): number { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }

async function ensureFolders(app: App, path: string): Promise<void> {
	let current = '';
	for (const part of path.split('/').slice(0, -1)) {
		current = current ? `${current}/${part}` : part;
		const found = app.vault.getAbstractFileByPath(current);
		if (!found) await app.vault.createFolder(current);
		else if (!(found instanceof TFolder)) throw new Error(`${current} is not a folder.`);
	}
}

async function writeProvenance(app: App, path: string, source: string, maxWidth: number, maxHeight: number, format: RasterOutputFormat, quality: number): Promise<void> {
	const notePath = `${path}.provenance.md`;
	const content = ['---', 'sovereignMediaVersion: 1', 'provider: local-canvas', 'costClass: local-free', `generatedAt: ${new Date().toISOString()}`, `source: ${JSON.stringify(source)}`, `format: ${format}`, `maxWidth: ${maxWidth}`, `maxHeight: ${maxHeight}`, `quality: ${quality}`, '---', '', `Optimized asset: [[${path}]]`, ''].join('\n');
	const existing = app.vault.getFileByPath(notePath);
	if (existing) await app.vault.process(existing, () => content);
	else await app.vault.create(notePath, content);
}
