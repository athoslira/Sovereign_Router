import { ItemView, MarkdownRenderer, Notice, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { buildDocumentContext, limitDocumentContent, type AttachedDocument } from '../document-context';
import { isSupportedDocument, isTextDocument, needsDoclingConversion } from '../document-files';
import { convertWithDocling, DoclingError } from '../docling';
import { HermesClient, HermesError } from '../hermes';
import { loadMcpCatalog, parseMcpToolCalls, toExecutorTools, type McpCatalog } from '../mcp-tools';
import { canCallMcpTool } from '../mcp-policy';
import type { McpToolCall } from '../mcp-types';
import type SovereignRouterPlugin from '../main';
import { modelLabel } from '../models';
import { completeExecutor, OpenRouterError, routeWithGatekeeper, StreamingUnavailableError, streamExecutor } from '../openrouter';
import { fallbackRoute, selectRoute } from '../routing';
import { SkillResolver } from '../skills';
import type { ChatMessage, OpenRouterToolCall, RouteResult, SessionRuntime, SkillReference, Usage, VaultContextReference } from '../types';
import { confirmMcpToolCall } from './tool-confirmation-modal';
import { openControlCenter } from './control-center-modal';
import { VaultFolderPicker } from './vault-folder-picker';

export const VIEW_TYPE_SOVEREIGN_ROUTER = 'sovereign-router-chat';

interface SessionDisplayMessage {
	role: 'user' | 'assistant';
	content: string;
	meta?: string;
	finOpsCost?: number;
	finOpsModel?: string;
}

interface AssistantElements {
	message: SessionDisplayMessage;
	bodyEl: HTMLElement | null;
	metaEl: HTMLElement | null;
}

interface ChatSession {
	id: string;
	number: number;
	history: ChatMessage[];
	messages: SessionDisplayMessage[];
	documents: AttachedDocument[];
	selectedModel: string;
	runtime: SessionRuntime;
	resolvedRuntime: Exclude<SessionRuntime, 'auto'> | null;
	model: string | null;
	skill: SkillReference | null;
	context: VaultContextReference | null;
	useMcp: boolean;
	abortController: AbortController | null;
	hermesClient: HermesClient | null;
	hermesRunId: string | null;
	isConvertingDocument: boolean;
}

function formatError(error: unknown): string {
	if (error instanceof OpenRouterError) {
		if (error.status === 401) return 'Your OpenRouter API key is invalid or unavailable.';
		if (error.status === 402) return 'Your OpenRouter account has insufficient credits.';
		if (error.status === 429) return 'OpenRouter is rate-limiting this request. Please try again shortly.';
		if (error.status && error.status >= 500) return 'OpenRouter or the selected provider is temporarily unavailable.';
		return error.message;
	}
	if (error instanceof HermesError) {
		if (error.status === 401 || error.status === 403) return 'The Hermes API key is invalid or unavailable.';
		if (error.status === 429) return 'Hermes is rate-limiting this request. Please try again shortly.';
		if (error.status && error.status >= 500) return 'Hermes is temporarily unavailable. Check the Hermes service and try again.';
		return error.message;
	}
	if (error instanceof DOMException && error.name === 'AbortError') return 'Response cancelled.';
	return 'The request could not be completed. Please check your network connection and settings.';
}

function formatUsage(model: string, usage?: Usage, suffix?: string): string {
	const parts = [modelLabel(model)];
	if (typeof usage?.cost === 'number') parts.push(`$${usage.cost.toFixed(6)}`);
	if ((usage?.prompt_tokens_details?.cached_tokens ?? 0) > 0) parts.push('cache hit');
	if (suffix) parts.push(suffix);
	return parts.join(' | ');
}

export class SovereignRouterView extends ItemView {
	private readonly sessions = new Map<string, ChatSession>();
	private readonly sessionOrder: string[] = [];
	private activeSessionId = '';
	private nextSessionNumber = 1;
	private messagesEl!: HTMLElement;
	private attachmentsEl!: HTMLElement;
	private sessionListEl!: HTMLElement;
	private sessionStatusEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private fileInput!: HTMLInputElement;
	private modelSelect!: HTMLSelectElement;
	private runtimeSelect!: HTMLSelectElement;
	private mcpToggle!: HTMLInputElement;
	private attachButton!: HTMLButtonElement;
	private folderButton!: HTMLButtonElement;
	private sendButton!: HTMLButtonElement;
	private cancelButton!: HTMLButtonElement;
	private newSessionButton!: HTMLButtonElement;
	private endSessionButton!: HTMLButtonElement;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: SovereignRouterPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_SOVEREIGN_ROUTER;
	}

	getDisplayText(): string {
		return 'Sovereign Router';
	}

	async onOpen(): Promise<void> {
		this.containerEl.empty();
		this.containerEl.addClass('sovereign-router-view');
		const header = this.containerEl.createDiv({ cls: 'sr-header' });
		header.createEl('h4', { text: 'Sovereign Router' });
		const controls = header.createDiv({ cls: 'sr-header-controls' });
		const controlCenterButton = controls.createEl('button', { text: 'Control', cls: 'sr-control-button', attr: { 'aria-label': 'Open control center' } });
		this.runtimeSelect = controls.createEl('select', { cls: 'sr-model-select', attr: { 'aria-label': 'Execution runtime' } });
		this.runtimeSelect.createEl('option', { text: 'Auto runtime', value: 'auto' });
		this.runtimeSelect.createEl('option', { text: 'Sovereign chat', value: 'chat' });
		this.runtimeSelect.createEl('option', { text: 'Hermes Agent', value: 'hermes' });
		this.modelSelect = controls.createEl('select', {
			cls: 'sr-model-select',
			attr: { 'aria-label': 'Executor model' },
		});
		this.modelSelect.createEl('option', { text: 'Auto route', value: '' });
		for (const model of this.plugin.manualModelOptions()) {
			this.modelSelect.createEl('option', { text: modelLabel(model), value: model });
		}
		const mcpControl = controls.createEl('label', { cls: 'sr-mcp-toggle' });
		this.mcpToggle = mcpControl.createEl('input', { attr: { type: 'checkbox', 'aria-label': 'Use MCP tools' } });
		mcpControl.createSpan({ text: 'MCP' });
		controls.createSpan({ text: 'Session only', cls: 'sr-header-note' });

		const sessionBar = this.containerEl.createDiv({ cls: 'sr-session-bar' });
		this.sessionListEl = sessionBar.createDiv({ cls: 'sr-session-list' });
		const sessionActions = sessionBar.createDiv({ cls: 'sr-session-actions' });
		this.newSessionButton = sessionActions.createEl('button', { text: 'New session', cls: 'sr-session-button' });
		this.endSessionButton = sessionActions.createEl('button', { text: 'End session', cls: 'sr-session-button' });
		this.sessionStatusEl = this.containerEl.createDiv({ cls: 'sr-session-status' });

		this.messagesEl = this.containerEl.createDiv({ cls: 'sr-messages' });
		const composer = this.containerEl.createDiv({ cls: 'sr-composer' });
		this.attachmentsEl = composer.createDiv({ cls: 'sr-attachments' });
		this.fileInput = composer.createEl('input', {
			cls: 'sr-file-input',
			attr: {
				type: 'file',
				multiple: 'true',
				accept: '.pdf,.docx,.pptx,.xlsx,.odt,.ods,.odp,.html,.htm,.epub,.txt,.md,.csv,.png,.jpg,.jpeg,.tiff',
			},
		});
		this.inputEl = composer.createEl('textarea', {
			cls: 'sr-input',
			attr: { placeholder: 'Ask anything...', rows: '3', 'aria-label': 'Chat message' },
		});
		const actions = composer.createDiv({ cls: 'sr-actions' });
		this.attachButton = actions.createEl('button', { text: 'Attach document', cls: 'sr-button sr-attach' });
		this.folderButton = actions.createEl('button', { text: 'Attach vault folder', cls: 'sr-button sr-folder' });
		this.cancelButton = actions.createEl('button', { text: 'Cancel', cls: 'sr-button sr-cancel' });
		this.sendButton = actions.createEl('button', { text: 'Send', cls: 'sr-button sr-send' });

		this.registerDomEvent(this.inputEl, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				void this.sendMessage();
			}
		});
		this.registerDomEvent(this.sendButton, 'click', () => void this.sendMessage());
		this.registerDomEvent(this.cancelButton, 'click', () => void this.cancelActiveRequest());
		this.registerDomEvent(this.attachButton, 'click', () => this.fileInput.click());
		this.registerDomEvent(this.folderButton, 'click', () => this.openFolderPicker());
		this.registerDomEvent(this.fileInput, 'change', () => {
			if (this.fileInput.files) void this.attachDocuments(this.fileInput.files);
		});
		this.registerDomEvent(this.modelSelect, 'change', () => {
			const session = this.activeSession;
			if (!session.model) session.selectedModel = this.modelSelect.value;
		});
		this.registerDomEvent(controlCenterButton, 'click', () => openControlCenter(this.app, this.plugin));
		this.registerDomEvent(this.runtimeSelect, 'change', () => {
			const session = this.activeSession;
			if (!session.resolvedRuntime) session.runtime = this.runtimeSelect.value as SessionRuntime;
			this.refreshSessionUi(session);
		});
		this.registerDomEvent(this.mcpToggle, 'change', () => {
			const session = this.activeSession;
			session.useMcp = this.mcpToggle.checked;
		});
		this.registerDomEvent(this.newSessionButton, 'click', () => this.createSession());
		this.registerDomEvent(this.endSessionButton, 'click', () => void this.endActiveSession());

		this.createSession();
	}

	async onClose(): Promise<void> {
		for (const session of this.sessions.values()) void this.cancelRequest(session);
		this.sessions.clear();
		this.sessionOrder.length = 0;
	}

	private get activeSession(): ChatSession {
		const session = this.sessions.get(this.activeSessionId);
		if (!session) throw new Error('No active chat session is available.');
		return session;
	}

	private createSession(): void {
		const number = this.nextSessionNumber++;
		const id = `session-${Date.now()}-${number}`;
		const session: ChatSession = {
			id,
			number,
			history: [],
			messages: [],
			documents: [],
			selectedModel: '',
			runtime: 'auto',
			resolvedRuntime: null,
			model: null,
			skill: null,
			context: null,
			useMcp: false,
			abortController: null,
			hermesClient: null,
			hermesRunId: null,
			isConvertingDocument: false,
		};
		this.sessions.set(id, session);
		this.sessionOrder.push(id);
		void this.activateSession(id);
	}

	private async activateSession(id: string): Promise<void> {
		if (!this.sessions.has(id)) return;
		this.activeSessionId = id;
		const session = this.activeSession;
		this.fileInput.value = '';
		this.modelSelect.value = session.selectedModel;
		this.runtimeSelect.value = session.runtime;
		this.mcpToggle.checked = session.useMcp;
		this.renderSessionTabs();
		this.renderAttachments();
		this.setBusy();
		await this.renderMessages(session);
	}

	private async endActiveSession(): Promise<void> {
		const session = this.activeSession;
		if (session.abortController || session.isConvertingDocument) return;
		const index = this.sessionOrder.indexOf(session.id);
		this.sessions.delete(session.id);
		this.sessionOrder.splice(index, 1);
		const nextSessionId = this.sessionOrder[index] ?? this.sessionOrder[index - 1];
		if (nextSessionId) await this.activateSession(nextSessionId);
		else this.createSession();
	}

	private renderSessionTabs(): void {
		this.sessionListEl.empty();
		for (const id of this.sessionOrder) {
			const session = this.sessions.get(id);
			if (!session) continue;
			const model = session.model ?? session.selectedModel;
			const state = session.resolvedRuntime === 'hermes' || session.runtime === 'hermes' ? 'Hermes Agent' : model ? modelLabel(model) : 'Auto route';
			const button = this.sessionListEl.createEl('button', {
				text: `Session ${session.number} · ${state}`,
				cls: 'sr-session-tab',
			});
			if (session.id === this.activeSessionId) button.addClass('is-active');
			this.registerDomEvent(button, 'click', () => void this.activateSession(session.id));
		}
		const session = this.activeSession;
		if (session.resolvedRuntime === 'hermes') {
			this.sessionStatusEl.setText('Active session · Hermes Agent is handling this task outside Obsidian.');
			return;
		}
		this.sessionStatusEl.setText(session.model
			? `Active session · ${modelLabel(session.model)} is locked for this task.`
			: 'New session · choose a model or use automatic routing for the first message.');
	}

	private isActive(session: ChatSession): boolean {
		return session.id === this.activeSessionId;
	}

	private canInteract(session: ChatSession): boolean {
		return !session.abortController && !session.isConvertingDocument;
	}

	private openFolderPicker(): void {
		const session = this.activeSession;
		if (!this.canInteract(session)) return;
		new VaultFolderPicker(this.app, (folder) => void this.attachVaultFolder(folder, session)).open();
	}

	private async attachDocuments(files: FileList): Promise<void> {
		const session = this.activeSession;
		if (!this.canInteract(session)) return;
		if (!this.plugin.settings.doclingServiceUrl) {
			new Notice('Configure a Docling service URL before attaching documents.');
			this.fileInput.value = '';
			return;
		}
		const secretName = this.plugin.settings.doclingSecretName;
		const apiKey = secretName ? this.app.secretStorage.getSecret(secretName) : null;
		if (secretName && !apiKey) {
			new Notice('The selected Docling API key is unavailable.');
			this.fileInput.value = '';
			return;
		}

		session.isConvertingDocument = true;
		this.refreshSessionUi(session, 'Converting...');
		try {
			for (const file of Array.from(files)) {
				try {
					const markdown = await convertWithDocling(file, this.plugin.settings.doclingServiceUrl, apiKey);
					const limited = limitDocumentContent(markdown);
					session.documents.push({ name: file.name, markdown: limited.content, truncated: limited.truncated });
					try {
						await this.plugin.contextIndex.addExternalDocument(file.name, limited.content);
					} catch (_error) {
						new Notice(`${file.name} is attached for this session, but could not be added to local context.`);
					}
					new Notice(`${file.name} attached for this chat session.`);
				} catch (error) {
					const message = error instanceof DoclingError ? error.message : `Could not convert ${file.name}.`;
					new Notice(message);
				}
			}
			if (this.isActive(session)) this.renderAttachments();
		} finally {
			session.isConvertingDocument = false;
			if (this.isActive(session)) {
				this.fileInput.value = '';
				this.refreshSessionUi(session);
			}
		}
	}

	private async attachVaultFolder(folder: TFolder, session: ChatSession): Promise<void> {
		if (!this.canInteract(session)) return;
		const prefix = folder.path ? `${folder.path}/` : '';
		const candidates = this.app.vault
			.getFiles()
			.filter((file) => file.path.startsWith(prefix) && isSupportedDocument(file.name));
		if (candidates.length === 0) {
			new Notice('No supported documents were found in this vault folder.');
			return;
		}

		const maximumFiles = 25;
		const availableSlots = Math.max(0, maximumFiles - session.documents.length);
		if (availableSlots === 0) {
			new Notice(`You can attach up to ${maximumFiles} documents to a chat session.`);
			return;
		}
		const files = candidates.slice(0, availableSlots);
		const secretName = this.plugin.settings.doclingSecretName;
		const doclingKey = secretName ? this.app.secretStorage.getSecret(secretName) : null;
		const canUseDocling = Boolean(this.plugin.settings.doclingServiceUrl) && (!secretName || Boolean(doclingKey));

		session.isConvertingDocument = true;
		this.refreshSessionUi(session, 'Reading...');
		let attached = 0;
		let skipped = candidates.length - files.length;
		try {
			for (const file of files) {
				try {
					const document = await this.readVaultDocument(file, folder.path, doclingKey, canUseDocling);
					if (!document) {
						skipped += 1;
						continue;
					}
					session.documents.push(document);
					attached += 1;
				} catch (_error) {
					skipped += 1;
				}
			}
			if (this.isActive(session)) this.renderAttachments();
			const summary = [`${attached} file${attached === 1 ? '' : 's'} attached from ${folder.path || 'vault root'}.`];
			if (skipped) summary.push(`${skipped} skipped.`);
			if (!canUseDocling && files.some((file) => needsDoclingConversion(file.name))) {
				summary.push('Configure Docling to include PDFs and Office documents.');
			}
			new Notice(summary.join(' '));
		} finally {
			session.isConvertingDocument = false;
			this.refreshSessionUi(session);
		}
	}

	private async readVaultDocument(
		file: TFile,
		folderPath: string,
		doclingKey: string | null,
		allowDocling: boolean,
	): Promise<AttachedDocument | null> {
		const relativeName = folderPath ? file.path.slice(folderPath.length + 1) : file.path;
		let content: string;
		if (isTextDocument(file.name)) {
			content = await this.app.vault.read(file);
		} else if (needsDoclingConversion(file.name) && allowDocling) {
			const binary = await this.app.vault.readBinary(file);
			content = await convertWithDocling(
				new File([binary], file.name, { type: 'application/octet-stream' }),
				this.plugin.settings.doclingServiceUrl,
				doclingKey,
			);
		} else {
			return null;
		}
		const limited = limitDocumentContent(content);
		return { name: relativeName, markdown: limited.content, truncated: limited.truncated };
	}

	private async sendMessage(): Promise<void> {
		const session = this.activeSession;
		const question = this.inputEl.value.trim();
		if (!question || !this.canInteract(session)) return;
		if ((session.runtime === 'hermes' || session.resolvedRuntime === 'hermes') && !this.hasHermesCredentials()) {
			new Notice('Configure the Hermes API URL and API key in Sovereign Router settings first.');
			return;
		}
		const secretName = this.plugin.settings.openRouterSecretName;
		const apiKey = secretName ? this.app.secretStorage.getSecret(secretName) : null;
		if (!apiKey && session.runtime !== 'hermes' && session.resolvedRuntime !== 'hermes') {
			new Notice('Select an OpenRouter API key in Sovereign Router settings first.');
			return;
		}

		this.inputEl.value = '';
		this.appendUser(session, question);
		session.history.push({ role: 'user', content: question });
		const assistant = this.appendAssistant(session);
		session.abortController = new AbortController();
		this.refreshSessionUi(session);
		let assistantText = '';
		let catalog: McpCatalog | null = null;
		try {
			if (session.runtime === 'hermes' || session.resolvedRuntime === 'hermes') {
				await this.runHermesSession(session, question, assistant, null, (text) => {
					assistantText += text;
					this.setAssistantContent(session, assistant, assistantText);
				});
				return;
			}
			if (!apiKey) throw new OpenRouterError('OpenRouter API key is unavailable.');
			const route = await this.routeForSession(session, question, apiKey);
			if (route.runtime === 'hermes') {
				await this.runHermesSession(session, question, assistant, route, (text) => {
					assistantText += text;
					this.setAssistantContent(session, assistant, assistantText);
				});
				return;
			}
			this.setAssistantMeta(session, assistant, route.note || `Using ${modelLabel(route.model)} for this session.`);
			const skill = await new SkillResolver(this.app, this.plugin.settings).resolve(route.skill);
			if (skill.note) this.setAssistantMeta(session, assistant, `${route.note ? `${route.note} ` : ''}${skill.note}`);
			const attachedContext = buildDocumentContext(session.documents);
			let vaultContext: string | null = null;
			if (route.context) {
				try {
					const resolved = await this.plugin.contextIndex.resolve(route.context.query);
					vaultContext = resolved.content;
					if (resolved.note) this.setAssistantMeta(session, assistant, resolved.note);
				} catch (_error) {
					this.setAssistantMeta(session, assistant, 'Local context is unavailable; continuing without it.');
				}
			}
			const documentContext = [attachedContext, vaultContext].filter((value): value is string => Boolean(value)).join('\n\n---\n\n') || null;
			catalog = session.useMcp ? await this.loadMcpCatalog() : null;
			const executorTools = catalog ? toExecutorTools(catalog.tools) : [];
			if (catalog?.warnings.length) new Notice(catalog.warnings.join(' '));
			if (session.useMcp && executorTools.length === 0) this.setAssistantMeta(session, assistant, 'No MCP tools available; answering without them.');
			const callbacks = {
				onDelta: (text: string) => {
					assistantText += text;
					this.setAssistantContent(session, assistant, assistantText);
					if (this.isActive(session)) this.scrollToBottom();
				},
				onUsage: (usage: Usage) => this.recordUsage(session, assistant, route.model, usage),
				onModel: (model: string) => {
					assistant.message.finOpsModel = model;
					this.setAssistantMeta(session, assistant, formatUsage(model));
				},
			};
			await this.runExecutorWithMcp(session, route.model, skill.content, documentContext, apiKey, callbacks, assistant, catalog, executorTools, (text) => {
				assistantText = text;
				this.setAssistantContent(session, assistant, text);
			}, () => assistantText, () => {
				assistantText = '';
				this.setAssistantContent(session, assistant, '');
			});
			if (this.isActive(session) && assistant.bodyEl?.isConnected) await this.renderMarkdown(assistant.bodyEl, assistantText);
		} catch (error) {
			const message = formatError(error);
			this.setAssistantMeta(session, assistant, 'Request error');
			if (assistantText) {
				assistantText = `${assistantText}\n\n_${message}_`;
				this.setAssistantContent(session, assistant, assistantText);
				session.history.push({ role: 'assistant', content: assistantText });
			} else {
				this.setAssistantContent(session, assistant, message);
			}
		} finally {
			await this.closeMcpClients(catalog);
			session.abortController = null;
			session.hermesRunId = null;
			session.hermesClient = null;
			this.refreshSessionUi(session);
			if (this.isActive(session)) this.scrollToBottom();
		}
	}

	private hasHermesCredentials(): boolean {
		const secretName = this.plugin.settings.hermesSecretName;
		return Boolean(this.plugin.settings.hermesServiceUrl && secretName && this.app.secretStorage.getSecret(secretName));
	}

	private async runHermesSession(
		session: ChatSession,
		question: string,
		assistant: AssistantElements,
		route: RouteResult | null,
		onDelta: (text: string) => void,
	): Promise<void> {
		const secretName = this.plugin.settings.hermesSecretName;
		const apiKey = secretName ? this.app.secretStorage.getSecret(secretName) : null;
		if (!apiKey || !this.plugin.settings.hermesServiceUrl) throw new HermesError('Configure the Hermes API URL and API key in Sovereign Router settings first.');
		const signal = session.abortController?.signal;
		if (!signal) throw new HermesError('The session request is no longer active.');
		const instructions = await this.buildHermesInstructions(session, route);
		const client = new HermesClient(this.plugin.settings.hermesServiceUrl, apiKey);
		session.hermesClient = client;
		session.resolvedRuntime = 'hermes';
		this.refreshSessionUi(session);
		this.setAssistantMeta(session, assistant, 'Hermes Agent | preparing external agent run');
		const run = await client.startRun(question, session.id, instructions, signal);
		session.hermesRunId = run.id;
		this.setAssistantMeta(session, assistant, 'Hermes Agent | running tools and streaming output');
		await client.streamRun(run.id, {
			onDelta: (text) => {
				onDelta(text);
				if (this.isActive(session)) this.scrollToBottom();
			},
			onStatus: (status) => this.setAssistantMeta(session, assistant, status),
		}, signal);
		session.history.push({ role: 'assistant', content: assistant.message.content });
		if (this.isActive(session) && assistant.bodyEl?.isConnected) await this.renderMarkdown(assistant.bodyEl, assistant.message.content);
	}

	private async buildHermesInstructions(session: ChatSession, route: RouteResult | null): Promise<string | null> {
		const sections = ['You are operating through Sovereign Router. Do not expose API keys or secrets. Ask for approval through the Hermes runtime before any dangerous action.'];
		if (route?.skill) {
			const skill = await new SkillResolver(this.app, this.plugin.settings).resolve(route.skill);
			if (skill.content) sections.push(`Follow this selected Sovereign skill when applicable:\n\n${skill.content}`);
		}
		const attachedContext = buildDocumentContext(session.documents);
		if (attachedContext) sections.push(`Attached context:\n\n${attachedContext}`);
		if (route?.context) {
			try {
				const resolved = await this.plugin.contextIndex.resolve(route.context.query);
				if (resolved.content) sections.push(`Relevant vault context:\n\n${resolved.content}`);
			} catch (_error) { /* Hermes can continue without vault context. */ }
		}
		return sections.join('\n\n');
	}

	private async routeForSession(session: ChatSession, question: string, apiKey: string): Promise<RouteResult> {
		if (session.model && session.resolvedRuntime !== 'hermes') {
			return {
				model: session.model,
				skill: session.skill,
				context: session.context,
				runtime: 'chat',
				note: `Using the session model: ${modelLabel(session.model)}.`,
			};
		}

		let route: RouteResult;
		if (session.selectedModel) {
			route = { model: session.selectedModel, skill: null, context: null, runtime: 'chat', note: `Manual model: ${modelLabel(session.selectedModel)}.` };
		} else {
			try {
				route = selectRoute(await routeWithGatekeeper(question, this.plugin.settings, apiKey), this.plugin.settings);
			} catch (_error) {
				route = fallbackRoute(this.plugin.settings, 'Gatekeeper unavailable; using the default model for this session.');
			}
		}
		if (session.runtime === 'chat') route = { ...route, runtime: 'chat' };
		if (route.runtime === 'hermes' && !this.hasHermesCredentials()) {
			route = { ...route, runtime: 'chat', note: 'Hermes is not configured; using the selected chat model.' };
		}
		if (route.runtime === 'chat') session.model = route.model;
		else session.resolvedRuntime = 'hermes';
		session.skill = route.skill;
		session.context = route.context;
		this.refreshSessionUi(session);
		return route;
	}

	private async loadMcpCatalog(): Promise<McpCatalog> {
		return loadMcpCatalog(this.plugin.settings.mcpServers, (secretName) => this.app.secretStorage.getSecret(secretName));
	}

	private async closeMcpClients(catalog: McpCatalog | null): Promise<void> {
		if (!catalog) return;
		const clients = [...catalog.clients.values()];
		await Promise.all(clients.map((client) => client.close()));
	}

	private async runExecutorWithMcp(
		session: ChatSession,
		model: string,
		skillContent: string | null,
		documentContext: string | null,
		apiKey: string,
		callbacks: { onDelta: (text: string) => void; onUsage: (usage: Usage) => void; onModel: (model: string) => void },
		assistant: AssistantElements,
		catalog: McpCatalog | null,
		executorTools: ReturnType<typeof toExecutorTools>,
		setText: (text: string) => void,
		getText: () => string,
		clearText: () => void,
	): Promise<void> {
		for (let round = 0; round < 3; round += 1) {
			let toolCalls: OpenRouterToolCall[];
			try {
				const signal = session.abortController?.signal;
				if (!signal) throw new Error('The session request is no longer active.');
				toolCalls = await streamExecutor(model, session.history, skillContent, documentContext, apiKey, callbacks, signal, executorTools);
			} catch (error) {
				if (!(error instanceof StreamingUnavailableError) || getText()) throw error;
				const fallback = await completeExecutor(model, session.history, skillContent, documentContext, apiKey, executorTools);
				setText(fallback.content);
				toolCalls = fallback.toolCalls;
				if (fallback.usage) this.recordUsage(session, assistant, fallback.model, fallback.usage, 'non-streaming fallback');
				else this.setAssistantMeta(session, assistant, formatUsage(fallback.model, undefined, 'non-streaming fallback'));
			}
			if (toolCalls.length === 0) {
				session.history.push({ role: 'assistant', content: getText() });
				return;
			}
			if (!catalog) throw new Error('The model requested MCP tools while MCP is disabled.');
			session.history.push({ role: 'assistant', content: getText() || null, tool_calls: toolCalls });
			this.setAssistantMeta(session, assistant, 'Using connected MCP tools...');
			await this.executeMcpToolCalls(session, toolCalls, catalog);
			if (round === 2) {
				setText('The MCP tool-call limit was reached. Please narrow the request and try again.');
				session.history.push({ role: 'assistant', content: getText() });
				return;
			}
			clearText();
			if (this.isActive(session) && assistant.bodyEl?.isConnected) assistant.bodyEl.empty();
		}
	}

	private async executeMcpToolCalls(session: ChatSession, toolCalls: OpenRouterToolCall[], catalog: McpCatalog): Promise<void> {
		const parsed = parseMcpToolCalls(toolCalls, catalog.tools);
		for (const call of parsed) {
			if ('error' in call) {
				session.history.push({ role: 'tool', content: call.error, tool_call_id: call.id });
				continue;
			}
			session.history.push({ role: 'tool', content: await this.executeMcpToolCall(session, call, catalog), tool_call_id: call.callId });
		}
	}

	private async executeMcpToolCall(session: ChatSession, call: McpToolCall, catalog: McpCatalog): Promise<string> {
		const server = this.plugin.settings.mcpServers.find((item) => item.id === call.tool.serverId);
		if (!server) return 'The requested MCP connection no longer exists.';
		const policy = canCallMcpTool(call.tool, server);
		if (!policy.allowed) return policy.reason || 'This MCP tool is not allowed.';
		if (policy.requiresConfirmation && !(await confirmMcpToolCall(this.app, call))) return 'The user declined this MCP action.';
		const client = catalog.clients.get(server.id);
		if (!client) return 'The MCP connection is unavailable.';
		try {
			return await client.callTool(call.tool.name, call.arguments, session.abortController?.signal);
		} catch (error) {
			return error instanceof Error ? `MCP tool error: ${error.message}` : 'MCP tool failed.';
		}
	}

	private async cancelActiveRequest(): Promise<void> {
		await this.cancelRequest(this.activeSession);
	}

	private async cancelRequest(session: ChatSession): Promise<void> {
		const client = session.hermesClient;
		const runId = session.hermesRunId;
		if (client && runId) {
			try {
				await client.stopRun(runId);
			} catch (_error) {
				// The AbortController below still stops the local stream if Hermes is unreachable.
			}
		}
		session.abortController?.abort();
	}

	private renderAttachments(): void {
		const session = this.activeSession;
		this.attachmentsEl.empty();
		for (const [index, document] of session.documents.entries()) {
			const chip = this.attachmentsEl.createDiv({ cls: 'sr-attachment' });
			chip.createSpan({ text: document.truncated ? `${document.name} (truncated)` : document.name });
			const remove = chip.createEl('button', { text: 'Remove', cls: 'sr-attachment-remove' });
			remove.disabled = !this.canInteract(session);
			this.registerDomEvent(remove, 'click', () => {
				if (!this.canInteract(session)) return;
				session.documents.splice(index, 1);
				this.renderAttachments();
			});
		}
	}

	private async renderMessages(session: ChatSession): Promise<void> {
		if (!this.isActive(session)) return;
		this.messagesEl.empty();
		for (const message of session.messages) {
			if (!this.isActive(session)) return;
			const elements = this.createMessageElement(message);
			if (message.role === 'assistant' && message.content) await this.renderMarkdown(elements.bodyEl, message.content);
		}
		if (this.isActive(session)) this.scrollToBottom();
	}

	private appendUser(session: ChatSession, content: string): void {
		const message: SessionDisplayMessage = { role: 'user', content };
		session.messages.push(message);
		if (this.isActive(session)) {
			this.createMessageElement(message);
			this.scrollToBottom();
		}
	}

	private appendAssistant(session: ChatSession): AssistantElements {
		const message: SessionDisplayMessage = { role: 'assistant', content: '', meta: 'Preparing request...' };
		session.messages.push(message);
		if (!this.isActive(session)) return { message, bodyEl: null, metaEl: null };
		const elements = this.createMessageElement(message);
		return { message, bodyEl: elements.bodyEl, metaEl: elements.metaEl };
	}

	private createMessageElement(message: SessionDisplayMessage): { bodyEl: HTMLElement; metaEl: HTMLElement | null } {
		const messageEl = this.messagesEl.createDiv({ cls: `sr-message sr-${message.role}` });
		if (message.role === 'user') return { bodyEl: messageEl.createDiv({ text: message.content, cls: 'sr-message-body' }), metaEl: null };
		const metaEl = messageEl.createDiv({ text: message.meta || '', cls: 'sr-message-meta' });
		return { bodyEl: messageEl.createDiv({ text: message.content, cls: 'sr-message-body' }), metaEl };
	}

	private setAssistantContent(session: ChatSession, assistant: AssistantElements, content: string): void {
		assistant.message.content = content;
		if (this.isActive(session) && assistant.bodyEl?.isConnected) assistant.bodyEl.setText(content);
	}

	private setAssistantMeta(session: ChatSession, assistant: AssistantElements, meta: string): void {
		assistant.message.meta = meta;
		if (this.isActive(session) && assistant.metaEl?.isConnected) assistant.metaEl.setText(meta);
	}

	private recordUsage(session: ChatSession, assistant: AssistantElements, model: string, usage: Usage, suffix?: string): void {
		assistant.message.finOpsModel = assistant.message.finOpsModel ?? model;
		if (typeof usage.cost === 'number') {
			this.plugin.operationalMetrics.recordDirectResponseCost(assistant.message.finOpsCost, usage.cost);
			assistant.message.finOpsCost = usage.cost;
		}
		this.setAssistantMeta(session, assistant, formatUsage(assistant.message.finOpsModel, usage, suffix));
	}

	private async renderMarkdown(element: HTMLElement, content: string): Promise<void> {
		element.empty();
		await MarkdownRenderer.renderMarkdown(content, element, '', this);
	}

	private refreshSessionUi(session: ChatSession, actionLabel?: string): void {
		if (!this.isActive(session)) return;
		this.attachButton.setText(actionLabel || 'Attach document');
		this.folderButton.setText(actionLabel || 'Attach vault folder');
		this.renderSessionTabs();
		this.setBusy();
	}

	private setBusy(): void {
		const session = this.activeSession;
		const controlsDisabled = !this.canInteract(session);
		this.sendButton.disabled = controlsDisabled;
		this.attachButton.disabled = controlsDisabled;
		this.folderButton.disabled = controlsDisabled;
		this.cancelButton.disabled = !session.abortController;
		this.inputEl.disabled = controlsDisabled;
		this.modelSelect.disabled = controlsDisabled || Boolean(session.model) || session.resolvedRuntime === 'hermes' || session.runtime === 'hermes';
		this.runtimeSelect.disabled = controlsDisabled || Boolean(session.model) || Boolean(session.resolvedRuntime);
		this.mcpToggle.disabled = controlsDisabled || session.resolvedRuntime === 'hermes' || session.runtime === 'hermes';
		this.endSessionButton.disabled = Boolean(session.abortController) || session.isConvertingDocument;
	}

	private scrollToBottom(): void {
		window.setTimeout(() => {
			this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		}, 0);
	}
}
