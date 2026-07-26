export function isSecureOrLocalHttpEndpoint(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.username || url.password || url.search || url.hash) return false;
		if (url.protocol === 'https:') return true;
		return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
	} catch {
		return false;
	}
}
