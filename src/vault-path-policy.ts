function hasUnsafeSegment(value: string): boolean {
	return value.split('/').some((segment) => segment === '.' || segment === '..');
}

function normalizeVaultPath(value: string): string {
	return value.replace(/\/+/g, '/');
}

/** Validates a user-supplied vault-relative directory. An empty root is allowed. */
export function safeVaultRelativeRoot(value: string): string | null {
	const candidate = value.trim().replace(/\\/g, '/');
	if (!candidate) return '';
	if (candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate) || hasUnsafeSegment(candidate)) return null;
	const normalized = normalizeVaultPath(candidate).replace(/^\/+|\/+$/g, '');
	return normalized && !hasUnsafeSegment(normalized) ? normalized : null;
}

/** Combines a trusted operation path with a validated vault-relative output root. */
export function vaultOutputPath(root: string, operationPath: string): string {
	const safeRoot = safeVaultRelativeRoot(root);
	const candidate = operationPath.trim().replace(/\\/g, '/');
	if (safeRoot === null || !candidate || candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate) || hasUnsafeSegment(candidate)) {
		throw new Error('Document output paths must be vault-relative and cannot contain traversal segments.');
	}
	const path = normalizeVaultPath(safeRoot ? `${safeRoot}/${candidate}` : candidate);
	if (path.startsWith('/') || hasUnsafeSegment(path)) throw new Error('Document output path is outside the vault.');
	return path;
}
