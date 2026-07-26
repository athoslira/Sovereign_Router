import type { McpServerConfig, McpTool } from './mcp-types';
import { isSecureOrLocalHttpEndpoint } from './endpoint-policy';

export function isAllowedMcpEndpoint(value: string): boolean {
	return isSecureOrLocalHttpEndpoint(value);
}

export function isReadOnlyMcpTool(tool: McpTool): boolean {
	return tool.annotations.readOnlyHint === true && tool.annotations.destructiveHint !== true;
}

export function canCallMcpTool(tool: McpTool, server: McpServerConfig): { allowed: boolean; requiresConfirmation: boolean; reason?: string } {
	if (!server.enabled) return { allowed: false, requiresConfirmation: false, reason: 'The MCP connection is disabled.' };
	if (!isAllowedMcpEndpoint(server.url)) return { allowed: false, requiresConfirmation: false, reason: 'The MCP URL must use HTTPS, or HTTP only on localhost.' };
	if (isReadOnlyMcpTool(tool)) return { allowed: true, requiresConfirmation: false };
	if (!server.allowWriteTools) return { allowed: false, requiresConfirmation: false, reason: 'Write tools are disabled for this MCP connection.' };
	return { allowed: true, requiresConfirmation: true };
}
