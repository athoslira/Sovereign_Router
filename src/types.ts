export type ChatRole = 'user' | 'assistant' | 'tool';
export type SessionRuntime = 'auto' | 'chat' | 'hermes';
export interface OpenRouterToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}
export interface ChatMessage {
	role: ChatRole;
	content: string | null;
	tool_calls?: OpenRouterToolCall[];
	tool_call_id?: string;
}
export interface Usage { cost?: number; prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; }
export type SkillReference = { source: 'local'; path: string } | { source: 'github'; repository: string; ref: string; path: string };
export interface VaultContextReference { source: 'vault'; query: string; }
export interface GatekeeperDecision { model: string; skill: SkillReference | null; context: VaultContextReference | null; runtime: Exclude<SessionRuntime, 'auto'>; }
export interface RouteResult { model: string; skill: SkillReference | null; context: VaultContextReference | null; runtime: Exclude<SessionRuntime, 'auto'>; note: string | null; }
