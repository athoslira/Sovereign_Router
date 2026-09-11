import { App, TFolder, normalizePath } from 'obsidian';
import { completeExecutor } from './openrouter';
import type { SovereignRouterSettings } from './settings';
import { HermesClient, type HermesApprovalChoice, type HermesApprovalRequest } from './hermes';
import { AgentKernelClient, extractPlannedWritePaths, type ExecutionEnvelopeV1 } from './agent-kernel';
import { canTransitionWorkItem, createWorkEvent, plannerPrompt, verifierPrompt, workArtifactPath, type WorkArtifactKind, type WorkItem, type WorkStatus, type WorkWorkspaceMode } from './work-protocol';
import { WorkStore } from './work-store';

export interface CreateWorkItemInput { title: string; requirement: string; workspaceMode: WorkWorkspaceMode; workspaceHint: string; }

export class WorkService {
	constructor(private readonly app: App, private readonly store: WorkStore, private readonly settings: SovereignRouterSettings) {}

	async create(input: CreateWorkItemInput): Promise<WorkItem> {
		const now = new Date().toISOString();
		const item: WorkItem = {
			version: 1, id: `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			title: input.title.trim(), requirement: input.requirement.trim(), status: 'draft', workspaceMode: input.workspaceMode,
			workspaceHint: input.workspaceHint.trim(), createdAt: now, updatedAt: now, artifacts: [], events: [createWorkEvent('created', 'Work item created.')],
		};
		await this.writeArtifact(item, 'requirement', `# ${item.title}\n\n## Requirement\n\n${item.requirement}\n\n## Workspace\n\nMode: ${item.workspaceMode}${item.workspaceHint ? `\n\nHint: ${item.workspaceHint}` : ''}`, null);
		await this.store.save(item);
		return item;
	}

	async plan(item: WorkItem, apiKey: string): Promise<WorkItem> {
		this.assertTransition(item, 'planned');
		const result = await completeExecutor(this.settings.defaultExecutorModel, [{ role: 'user', content: plannerPrompt(item) }], null, null, apiKey);
		await this.writeArtifact(item, 'plan', result.content || '# Plan\n\nNo plan content was returned.', result.model);
		item.status = 'planned';
		item.events.push(createWorkEvent('planned', 'Plan artifact generated.', result.model));
		await this.store.save(item);
		return item;
	}

	async approve(item: WorkItem): Promise<WorkItem> {
		this.assertTransition(item, 'approved');
		item.status = 'approved';
		item.events.push(createWorkEvent('approved', 'Plan approved for execution.'));
		await this.store.save(item);
		return item;
	}

	async execute(item: WorkItem, apiKey: string, onUpdate: (text: string) => void, signal: AbortSignal, approve?: (request: HermesApprovalRequest) => Promise<HermesApprovalChoice>): Promise<WorkItem> {
		this.assertTransition(item, 'running');
		const client = new HermesClient(this.settings.hermesServiceUrl, apiKey);
		const plan = await this.readArtifact(item, 'plan');
		const instructions = `You are executing a governed Sovereign work item. Follow the approved plan. Do not commit, push, delete, or change files outside the configured workspace without Hermes approval. ${item.workspaceMode === 'isolated-worktree' ? 'Prepare or use an isolated Git worktree only through Hermes tools and after the runtime approval policy permits it.' : 'Use the existing workspace only if Hermes policy permits it.'}\n\nApproved plan:\n${plan || 'No plan artifact is available.'}`;
		item.status = 'running';
		item.events.push(createWorkEvent('started', 'Hermes execution started.'));
		await this.store.save(item);
		let output = '';
		let kernel: { client: AgentKernelClient; executionId: string } | null = null;
		try {
			if (this.settings.agentKernelEnabled) {
				if (!this.settings.agentKernelAllowedRoots.length) throw new Error('Configure at least one Agent Kernel allowed root before governed execution.');
				const kernelClient = new AgentKernelClient(this.settings.agentKernelBridgeUrl, apiKey);
				await kernelClient.health(signal);
				const executionId = `${item.id}-${Date.now()}`;
				const envelope: ExecutionEnvelopeV1 = { version: 1, id: executionId, sessionId: item.id, mode: 'governed', allowedRoots: this.settings.agentKernelAllowedRoots, plannedWritePaths: extractPlannedWritePaths(plan || ''), capabilities: ['tools', 'subagents'] };
				await kernelClient.createExecution(envelope, signal);
				kernel = { client: kernelClient, executionId };
			}
			const run = await client.startRun(item.requirement, item.id, instructions, this.settings.hermesDefaultModelAlias, signal);
			if (kernel) {
				try { await kernel.client.bindRun(kernel.executionId, run.id, signal); }
				catch (error) {
					try { await client.stopRun(run.id); } catch { /* Preserve the binding failure. */ }
					throw error;
				}
			}
			item.events.push(createWorkEvent('note', 'Hermes run identifier received.', null, run.id));
			await this.store.save(item);
			const pending = new Set<string>();
			await client.streamRun(run.id, {
				onDelta: (text) => { output += text; onUpdate(text); },
				onStatus: (status) => onUpdate(`\n[${status}]\n`),
				onApproval: (request) => {
					if (pending.has(request.runId)) return;
					pending.add(request.runId);
					void (approve ? approve(request) : Promise.resolve<HermesApprovalChoice>('deny'))
						.then((choice) => client.approveRun(request.runId, choice, false, signal))
						.catch((error: unknown) => onUpdate(`\n[Approval failed: ${error instanceof Error ? error.message : 'unknown error'}]\n`))
						.finally(() => pending.delete(request.runId));
				},
			}, signal);
			if (kernel) await kernel.client.checkpoint(kernel.executionId, 'completed', signal);
			await this.writeArtifact(item, 'execution', output || '# Execution evidence\n\nHermes completed without textual output.', null);
			item.status = 'verifying';
			item.events.push(createWorkEvent('note', 'Hermes execution finished; verification is required.', null, run.id));
		} catch (error) {
			if (kernel && !signal.aborted) {
				try { await kernel.client.checkpoint(kernel.executionId, 'failed', signal); } catch { /* Preserve the execution error. */ }
			}
			item.status = signal.aborted ? 'blocked' : 'failed';
			item.events.push(createWorkEvent(signal.aborted ? 'blocked' : 'failed', signal.aborted ? 'Execution was cancelled.' : error instanceof Error ? error.message : 'Hermes execution failed.'));
			throw error;
		} finally { await this.store.save(item); }
		return item;
	}

	async verify(item: WorkItem, apiKey: string): Promise<WorkItem> {
		this.assertTransition(item, 'verifying');
		const plan = await this.readArtifact(item, 'plan');
		const execution = await this.readArtifact(item, 'execution');
		const result = await completeExecutor(this.settings.defaultExecutorModel, [{ role: 'user', content: verifierPrompt(item, plan || 'No plan artifact.', execution || 'No execution evidence.') }], null, null, apiKey);
		await this.writeArtifact(item, 'evidence', result.content || 'VERDICT: PARTIAL\n\nNo verifier content was returned.', result.model);
		const verdict = result.content.trim().match(/^VERDICT:\s*(PASS|PARTIAL|FAIL)\b/im)?.[1];
		item.status = verdict === 'PASS' ? 'completed' : verdict === 'FAIL' ? 'failed' : 'blocked';
		item.events.push(createWorkEvent('verified', `Verification completed with ${verdict || 'PARTIAL'} verdict.`, result.model));
		await this.store.save(item);
		return item;
	}

	async cancel(item: WorkItem): Promise<WorkItem> { this.assertTransition(item, 'cancelled'); item.status = 'cancelled'; item.events.push(createWorkEvent('cancelled', 'Work item cancelled.')); await this.store.save(item); return item; }

	private assertTransition(item: WorkItem, target: WorkStatus): void { if (!canTransitionWorkItem(item.status, target)) throw new Error(`Cannot move work item from ${item.status} to ${target}.`); }
	private async readArtifact(item: WorkItem, kind: WorkArtifactKind): Promise<string | null> {
		const artifact = [...item.artifacts].reverse().find((entry) => entry.kind === kind);
		if (!artifact) return null;
		try { return await this.app.vault.adapter.read(artifact.path); } catch { return null; }
	}
	private async writeArtifact(item: WorkItem, kind: WorkArtifactKind, content: string, model: string | null): Promise<void> {
		const path = normalizePath(workArtifactPath(this.settings.workItemOutputRoot, item, kind));
		await this.ensureParents(path);
		const file = this.app.vault.getFileByPath(path);
		if (file) await this.app.vault.modify(file, content);
		else await this.app.vault.create(path, content);
		const artifact = { kind, path, createdAt: new Date().toISOString(), model };
		const index = item.artifacts.findIndex((entry) => entry.kind === kind);
		if (index >= 0) item.artifacts[index] = artifact;
		else item.artifacts.push(artifact);
	}
	private async ensureParents(path: string): Promise<void> {
		let current = '';
		for (const part of path.split('/').slice(0, -1)) {
			current = current ? `${current}/${part}` : part;
			const found = this.app.vault.getAbstractFileByPath(current);
			if (!found) await this.app.vault.createFolder(current);
			else if (!(found instanceof TFolder)) throw new Error(`${current} is not a folder.`);
		}
	}
}
