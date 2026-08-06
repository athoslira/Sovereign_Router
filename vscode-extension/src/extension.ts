import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
type WorkStatus = 'draft' | 'planned' | 'approved' | 'running' | 'verifying' | 'completed' | 'blocked' | 'failed' | 'cancelled';
interface WorkArtifact { kind: string; path: string; }
interface WorkEvent { id: string; kind: string; message: string; createdAt: string; model: string | null; runId: string | null; }
interface WorkItem { id: string; title: string; status: WorkStatus; workspaceMode: 'existing' | 'isolated-worktree'; workspaceHint: string; artifacts: WorkArtifact[]; events: WorkEvent[]; updatedAt: string; }

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('sovereignRouter.openWorkItem', () => void openWorkItem()));
	context.subscriptions.push(vscode.commands.registerCommand('sovereignRouter.prepareWorktree', () => void prepareWorktree()));
}

async function openWorkItem(): Promise<void> {
	const selected = await pickWorkItem();
	if (!selected) return;
	const artifact = await vscode.window.showQuickPick(selected.item.artifacts.map((entry) => ({ label: entry.kind, detail: entry.path, artifact: entry })), { placeHolder: 'Open a work artifact' });
	if (!artifact) return;
	try {
		const artifactPath = await artifactPathInsideVault(selected.vaultPath, artifact.artifact.path);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(artifactPath));
		await vscode.window.showTextDocument(document, { preview: false });
	} catch (error) {
		vscode.window.showErrorMessage(`Could not open work artifact: ${error instanceof Error ? error.message : 'invalid path'}`);
	}
}

async function prepareWorktree(): Promise<void> {
	const selected = await pickWorkItem((item) => item.status === 'approved' && item.workspaceMode === 'isolated-worktree');
	if (!selected) return;
	const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspace) { vscode.window.showErrorMessage('Open the Git repository in VS Code before preparing a worktree.'); return; }
	const confirmation = await vscode.window.showWarningMessage(`Create an isolated Git worktree for “${selected.item.title}”?`, { modal: true }, 'Create worktree');
	if (confirmation !== 'Create worktree') return;
	try {
		const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: workspace });
		const repository = stdout.trim();
		const worktreePath = path.join(repository, '.sovereign-worktrees', selected.item.id);
		const branch = `sovereign/${safeSegment(selected.item.title)}-${selected.item.id.slice(-8)}`;
		await fs.mkdir(path.dirname(worktreePath), { recursive: true });
		await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', branch], { cwd: repository });
		selected.item.workspaceHint = worktreePath;
		selected.item.events.push({ id: `event-${Date.now()}`, kind: 'note', message: `VS Code prepared isolated worktree: ${worktreePath}`, createdAt: new Date().toISOString(), model: null, runId: null });
		await fs.writeFile(selected.filePath, JSON.stringify(selected.item), 'utf8');
		vscode.window.showInformationMessage(`Worktree created: ${worktreePath}`);
	} catch (error) { vscode.window.showErrorMessage(`Could not prepare worktree: ${error instanceof Error ? error.message : 'unknown error'}`); }
}

async function pickWorkItem(filter: (item: WorkItem) => boolean = () => true): Promise<{ item: WorkItem; filePath: string; vaultPath: string } | null> {
	const vaultPath = vscode.workspace.getConfiguration().get<string>('sovereignRouter.vaultPath', '').trim();
	if (!vaultPath) { vscode.window.showErrorMessage('Set Sovereign Router: Vault Path first.'); return null; }
	const directory = path.join(vaultPath, '.obsidian', 'plugins', 'sovereign-router', 'context', 'work-items');
	try {
		const entries = await fs.readdir(directory);
		const records = await Promise.all(entries.filter((name) => name.endsWith('.json')).map(async (name) => ({ item: JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) as WorkItem, filePath: path.join(directory, name), vaultPath })));
		const candidates = records.filter((record) => filter(record.item));
		const choice = await vscode.window.showQuickPick(candidates.map((record) => ({ label: record.item.title, description: record.item.status, detail: record.item.workspaceHint || record.item.workspaceMode, record })), { placeHolder: 'Select a Sovereign work item' });
		return choice?.record ?? null;
	} catch (error) { vscode.window.showErrorMessage(`Could not read work items: ${error instanceof Error ? error.message : 'unknown error'}`); return null; }
}

function safeSegment(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'work-item'; }

async function artifactPathInsideVault(vaultPath: string, artifactPath: string): Promise<string> {
	const vault = await fs.realpath(vaultPath);
	const candidate = path.resolve(vault, artifactPath);
	const relative = path.relative(vault, candidate);
	if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Artifact path is outside the configured vault.');
	const resolved = await fs.realpath(candidate);
	const resolvedRelative = path.relative(vault, resolved);
	if (resolvedRelative === '..' || resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative)) throw new Error('Artifact resolves outside the configured vault.');
	return resolved;
}
