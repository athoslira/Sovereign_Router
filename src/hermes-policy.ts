export function isAllowedHermesProviderOverride(value: string | null | undefined, allowed: string[]): boolean {
	return !value || allowed.includes(value);
}

export function hermesProviderOverrideError(provider: string | null | undefined, allowedProviders: string[]): string | null {
	if (!isAllowedHermesProviderOverride(provider, allowedProviders)) return 'The Hermes provider override is not in the permitted list.';
	return null;
}
