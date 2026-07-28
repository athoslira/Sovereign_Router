import { App, requestUrl, TFile } from 'obsidian';
import type { SovereignRouterSettings } from './settings';
import { isAllowedGitHubRepository, isSafeRelativePath } from './skill-policy';
import type { SkillReference } from './types';

export interface ResolvedSkill { content: string | null; note: string | null; }

export class SkillResolver {
	constructor(private readonly app: App, private readonly settings: SovereignRouterSettings) {}

	async resolve(reference: SkillReference | null): Promise<ResolvedSkill> {
		if (!reference) return { content: null, note: null };
		if (!isSafeRelativePath(reference.path)) return { content: null, note: 'The selected skill path was rejected for safety.' };
		return reference.source === 'local' ? this.resolveLocal(reference.path) : this.resolveGitHub(reference);
	}

	findLocalByName(name: string): SkillReference | null {
		const normalized = name.toLowerCase();
		for (const directory of this.settings.skillSearchPaths) {
			if (!isSafeRelativePath(directory)) continue;
			for (const file of this.app.vault.getFiles()) {
				if (!file.path.startsWith(`${directory}/`) || !file.name.toLowerCase().endsWith('.md')) continue;
				const relative = file.path.slice(directory.length + 1);
				const candidates = [file.basename, relative.replace(/\.md$/i, ''), relative.replace(/\.md$/i, '').replace(/\//g, '-')];
				if (candidates.some((candidate) => candidate.toLowerCase() === normalized)) return { source: 'local', path: relative };
			}
		}
		return null;
	}

	private async resolveLocal(path: string): Promise<ResolvedSkill> {
		for (const directory of this.settings.skillSearchPaths) {
			if (!isSafeRelativePath(directory)) continue;
			const file = this.app.vault.getAbstractFileByPath(`${directory}/${path}`);
			if (file instanceof TFile) return { content: await this.app.vault.read(file), note: null };
		}
		return { content: null, note: 'The selected local skill was not found.' };
	}

	private async resolveGitHub(reference: Extract<SkillReference, { source: 'github' }>): Promise<ResolvedSkill> {
		if (!isAllowedGitHubRepository(reference.repository, this.settings.allowedGitHubRepos)) return { content: null, note: 'The selected GitHub repository is not on the allowed list.' };
		if (!isSafeRelativePath(reference.ref)) return { content: null, note: 'The selected GitHub reference was rejected for safety.' };
		const encodedPath = reference.path.split('/').map(encodeURIComponent).join('/');
		const url = `https://raw.githubusercontent.com/${reference.repository}/${encodeURIComponent(reference.ref)}/${encodedPath}`;
		try {
			const response = await requestUrl({ url, method: 'GET' });
			return { content: response.text, note: null };
		} catch {
			return { content: null, note: 'The selected remote skill could not be downloaded.' };
		}
	}
}
