export type WorkStatus = 'draft' | 'planned' | 'approved' | 'running' | 'verifying' | 'completed' | 'blocked' | 'failed' | 'cancelled';
export type WorkArtifactKind = 'requirement' | 'plan' | 'tickets' | 'execution' | 'evidence';
export type WorkEventKind = 'created' | 'planned' | 'approved' | 'started' | 'verified' | 'blocked' | 'failed' | 'cancelled' | 'note';
export type WorkWorkspaceMode = 'existing' | 'isolated-worktree';

export interface WorkArtifact {
	kind: WorkArtifactKind;
	path: string;
	createdAt: string;
	model: string | null;
}

export interface WorkEvent {
	id: string;
	kind: WorkEventKind;
	message: string;
	createdAt: string;
	model: string | null;
	runId: string | null;
}

export interface WorkItem {
	version: 1;
	id: string;
	title: string;
	requirement: string;
	status: WorkStatus;
	workspaceMode: WorkWorkspaceMode;
	workspaceHint: string;
	createdAt: string;
	updatedAt: string;
	artifacts: WorkArtifact[];
	events: WorkEvent[];
}

export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
	draft: 'Draft', planned: 'Planned', approved: 'Approved', running: 'Running', verifying: 'Verifying',
	completed: 'Completed', blocked: 'Blocked', failed: 'Failed', cancelled: 'Cancelled',
};

const TRANSITIONS: Record<WorkStatus, WorkStatus[]> = {
	draft: ['planned', 'cancelled'],
	planned: ['draft', 'approved', 'cancelled'],
	approved: ['running', 'cancelled'],
	running: ['verifying', 'blocked', 'failed', 'cancelled'],
	verifying: ['completed', 'blocked', 'failed', 'approved'],
	completed: [],
	blocked: ['planned', 'approved', 'cancelled'],
	failed: ['planned', 'approved', 'cancelled'],
	cancelled: ['draft'],
};

export function canTransitionWorkItem(from: WorkStatus, to: WorkStatus): boolean {
	return TRANSITIONS[from].includes(to);
}

export function safeWorkPathSegment(value: string): string {
	const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
		.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	return normalized.slice(0, 60) || 'work-item';
}

export function safeWorkOutputRoot(value: string): string | null {
	const normalized = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	if (!normalized) return null;
	const parts = normalized.split('/');
	return parts.every((part) => part && part !== '.' && part !== '..') ? normalized : null;
}

export function workArtifactPath(root: string, item: Pick<WorkItem, 'id' | 'title'>, kind: WorkArtifactKind): string {
	const folder = `${safeWorkPathSegment(item.title)}-${item.id.slice(-8)}`;
	return `${safeWorkOutputRoot(root) ?? 'Sovereign/Tasks'}/${folder}/${kind}.md`;
}

export function createWorkEvent(kind: WorkEventKind, message: string, model: string | null = null, runId: string | null = null): WorkEvent {
	const createdAt = new Date().toISOString();
	return { id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, message, createdAt, model, runId };
}

export function isWorkItem(value: unknown): value is WorkItem {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const item = value as Partial<WorkItem>;
	return item.version === 1 && typeof item.id === 'string' && typeof item.title === 'string'
		&& typeof item.requirement === 'string' && typeof item.status === 'string' && item.status in WORK_STATUS_LABELS
		&& Array.isArray(item.artifacts) && Array.isArray(item.events);
}

export function plannerPrompt(item: WorkItem): string {
	return `You are the planning stage of a governed software work item. Produce a concise Markdown implementation plan for the task below. Include: objective, non-goals, affected areas, ordered implementation steps, verification commands/tests, risks, and explicit ticket checklist. Do not claim code was changed. Prefer isolated worktrees when requested, but state that workspace preparation needs a host executor and user approval.\n\nTask: ${item.title}\n\nRequirement:\n${item.requirement}\n\nWorkspace mode: ${item.workspaceMode}${item.workspaceHint ? `\nWorkspace hint: ${item.workspaceHint}` : ''}`;
}

export function verifierPrompt(item: WorkItem, plan: string, execution: string): string {
	return `You are an independent verifier. Compare the execution evidence with the approved plan. Return Markdown beginning with exactly one verdict line: VERDICT: PASS, VERDICT: PARTIAL, or VERDICT: FAIL. Then list evidence, missing work, risks, and next actions. Do not make changes.\n\nTask: ${item.title}\n\nRequirement:\n${item.requirement}\n\nPlan:\n${plan}\n\nExecution evidence:\n${execution}`;
}
