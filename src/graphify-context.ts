import { App, normalizePath } from 'obsidian';
import type { GraphifyContextStatus } from './local-context';

export class GraphifyContext {
	constructor(private readonly app: App, private readonly graphPath: string) {}
	async getStatus(): Promise<GraphifyContextStatus> {
		const path = normalizePath(this.graphPath.trim());
		const safePath = isSafeGraphifyPath(path) ? path : '.sovereign-router/graphify-out/graph.json';
		return { state: safePath === path && await this.app.vault.adapter.exists(safePath) ? 'ready' : 'unavailable', path: safePath };
	}
}

function isSafeGraphifyPath(path: string): boolean {
	return Boolean(path) && !path.startsWith('/') && !path.startsWith('..') && !/^[a-z]:/i.test(path) && path.split('/').every((part) => part !== '..');
}
