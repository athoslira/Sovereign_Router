export type DocumentAction = 'create' | 'append' | 'update';
export interface DocumentOperation { action: DocumentAction; path: string; title: string; content: string; reason: string; }

export function isDocumentRequest(prompt: string): boolean {
	return /\b(create|draft|write|structure|plan|document|organize|update|crie|escreva|estruture|planeje|documente|organize|atualize)\b/i.test(prompt)
		&& /\b(document|note|file|folder|markdown|plano|documento|nota|arquivo|pasta|estrutura)\b/i.test(prompt);
}

export function parseDocumentOperation(value: string): DocumentOperation | null {
	const raw = value.match(/```sovereign-document\s*([\s\S]*?)```/i)?.[1];
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<DocumentOperation>;
		if (!parsed || !['create', 'append', 'update'].includes(String(parsed.action)) || !safeDocumentPath(parsed.path) || !nonEmpty(parsed.title) || !nonEmpty(parsed.content) || !nonEmpty(parsed.reason)) return null;
		return { action: parsed.action as DocumentAction, path: parsed.path.trim(), title: parsed.title.trim(), content: parsed.content.trim(), reason: parsed.reason.trim() };
	} catch { return null; }
}

export function stripDocumentOperation(value: string): string { return value.replace(/\n?```sovereign-document\s*[\s\S]*?```\s*/ig, '').trim(); }
export function safeDocumentPath(path: unknown): path is string {
	return typeof path === 'string' && /^[^\\/][^\\]*\.md$/i.test(path) && !path.startsWith('.') && !path.split('/').some((part) => !part || part === '.' || part === '..');
}
export function documentAuthoringInstruction(): string {
	return 'This request requires a vault document. Return the normal answer, then a separate fenced `sovereign-document` JSON object with action (create, append, or update), a safe vault-relative .md path, title, content, and reason. Never claim a file was written; Sovereign validates and writes it.';
}
function nonEmpty(value: unknown): value is string { return typeof value === 'string' && Boolean(value.trim()); }
