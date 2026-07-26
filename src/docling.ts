import { requestUrl } from 'obsidian';
import { isSecureOrLocalHttpEndpoint } from './endpoint-policy';

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

interface DoclingResponse {
	document?: { md_content?: string };
}

export class DoclingError extends Error {
	constructor(message: string, readonly status?: number) {
		super(message);
	}
}

function toBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	const chunkSize = 0x8000;
	for (let index = 0; index < bytes.length; index += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
	}
	return btoa(binary);
}

function normalizedServiceUrl(value: string): string {
	if (!isSecureOrLocalHttpEndpoint(value)) throw new DoclingError('The Docling service URL must use HTTPS, or HTTP only on localhost.');
	const url = new URL(value);
	return url.toString().replace(/\/$/, '');
}

function responseMessage(value: unknown): string | null {
	if (typeof value === 'string') return value.trim() || null;
	if (Array.isArray(value)) {
		for (const item of value) {
			const message = responseMessage(item);
			if (message) return message;
		}
		return null;
	}
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	for (const key of ['message', 'msg', 'detail', 'error', 'errors']) {
		const message = responseMessage(record[key]);
		if (message) return message;
	}
	return null;
}

export async function convertWithDocling(
	file: File,
	serviceUrl: string,
	apiKey: string | null,
): Promise<string> {
	if (file.size > MAX_DOCUMENT_BYTES) {
		throw new DoclingError('This file exceeds the 20 MB document limit.');
	}
	const response = await requestUrl({
		url: `${normalizedServiceUrl(serviceUrl)}/v1/convert/source`,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(apiKey ? { 'X-Api-Key': apiKey } : {}),
		},
		body: JSON.stringify({
			sources: [{
				kind: 'file',
				base64_string: toBase64(await file.arrayBuffer()),
				filename: file.name,
			}],
			options: {
				to_formats: ['md'],
				do_ocr: true,
				table_mode: 'accurate',
				image_export_mode: 'placeholder',
			},
		}),
		throw: false,
	});
	const body = response.json as DoclingResponse;
	if (response.status < 200 || response.status >= 300) {
		throw new DoclingError(responseMessage(body) || `Docling request failed (${response.status}).`, response.status);
	}
	const markdown = body.document?.md_content;
	if (!markdown) {
		throw new DoclingError(responseMessage(body) || 'Docling did not return Markdown for this document.');
	}
	return markdown;
}
