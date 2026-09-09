export interface AttachedDocument {
	name: string;
	markdown: string;
	truncated: boolean;
	contextFormat?: 'toon';
}

export const MAX_DOCUMENT_CHARS = 100_000;
export const MAX_TOTAL_DOCUMENT_CHARS = 250_000;

export function limitDocumentContent(content: string): { content: string; truncated: boolean } {
	if (content.length <= MAX_DOCUMENT_CHARS) return { content, truncated: false };
	return {
		content: `${content.slice(0, MAX_DOCUMENT_CHARS)}\n\n[Document truncated to protect context and request cost.]`,
		truncated: true,
	};
}

export function buildDocumentContext(documents: AttachedDocument[]): string | null {
	if (documents.length === 0) return null;
	let remaining = MAX_TOTAL_DOCUMENT_CHARS;
	const sections: string[] = [];
	for (const document of documents) {
		if (remaining <= 0) break;
		const content = document.markdown.slice(0, remaining);
		remaining -= content.length;
		sections.push(`## Attached document: ${document.name}\n${content}`);
	}
	if (sections.length === 0) return null;
	if (remaining === 0 && documents.length > sections.length) {
		sections.push('[Additional attached documents were omitted to protect context and request cost.]');
	}
	return sections.join('\n\n---\n\n');
}
