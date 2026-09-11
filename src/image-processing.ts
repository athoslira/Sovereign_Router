export type RasterOutputFormat = 'webp' | 'png';

export function supportedRasterImage(path: string): boolean { return /\.(?:png|jpe?g|webp)$/i.test(path); }

export function computeImageDimensions(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
	if (![width, height, maxWidth, maxHeight].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Image dimensions must be positive numbers.');
	const scale = Math.min(1, maxWidth / width, maxHeight / height);
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function imageOutputName(path: string, format: RasterOutputFormat): string {
	const name = path.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '') || 'image';
	return `${name}-optimized.${format}`;
}

export async function optimizeRasterImage(input: ArrayBuffer, mimeType: string, maxWidth: number, maxHeight: number, format: RasterOutputFormat, quality: number): Promise<ArrayBuffer> {
	const blob = new Blob([input], { type: mimeType });
	const url = URL.createObjectURL(blob);
	try {
		const image = await loadImage(url);
		const size = computeImageDimensions(image.naturalWidth, image.naturalHeight, maxWidth, maxHeight);
		const canvas = createEl('canvas');
		canvas.width = size.width;
		canvas.height = size.height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas image processing is unavailable.');
		context.drawImage(image, 0, 0, size.width, size.height);
		const output = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('The image encoder returned no output.')), `image/${format}`, Math.min(1, Math.max(0.1, quality))));
		return output.arrayBuffer();
	} finally { URL.revokeObjectURL(url); }
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('The selected image could not be decoded.'));
		image.src = url;
	});
}
