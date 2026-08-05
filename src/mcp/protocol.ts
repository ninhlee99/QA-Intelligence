/**
 * MCP protocol-level shapes (ADR-019 §4 scope): initialize, tools/list,
 * tools/call, and cancellation only. Field names and structure follow the
 * public Model Context Protocol specification so any compliant host can
 * connect without modification (ADR-019 §2). This module has no QA
 * Intelligence domain knowledge — it is the protocol vocabulary layer that
 * mcp-server.ts and the tool adapters build on.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export type McpImplementationInfo = Readonly<{
  name: string;
  version: string;
}>;

export type McpInitializeParams = Readonly<{
  protocolVersion: string;
  capabilities: Readonly<Record<string, unknown>>;
  clientInfo: McpImplementationInfo;
}>;

export type McpInitializeResult = Readonly<{
  protocolVersion: string;
  capabilities: Readonly<{ tools?: Readonly<{ listChanged?: boolean }> }>;
  serverInfo: McpImplementationInfo;
}>;

export type McpToolInputSchema = Readonly<{
  type: "object";
  properties?: Readonly<Record<string, unknown>>;
  required?: readonly string[];
}>;

export type McpTool = Readonly<{
  name: string;
  description: string;
  inputSchema: McpToolInputSchema;
}>;

export type McpListToolsResult = Readonly<{
  tools: readonly McpTool[];
}>;

export type McpCallToolParams = Readonly<{
  name: string;
  arguments?: Readonly<Record<string, unknown>>;
}>;

export type McpTextContent = Readonly<{
  type: "text";
  text: string;
}>;

export type McpCallToolResult = Readonly<{
  content: readonly McpTextContent[];
  isError: boolean;
}>;

export type McpCancelledParams = Readonly<{
  requestId: string | number;
  reason?: string;
}>;

export function isMcpInitializeParams(value: unknown): value is McpInitializeParams {
  if (!isObject(value)) return false;
  const clientInfo = value["clientInfo"];
  return (
    typeof value["protocolVersion"] === "string" &&
    isObject(value["capabilities"]) &&
    isObject(clientInfo) &&
    typeof clientInfo["name"] === "string" &&
    typeof clientInfo["version"] === "string"
  );
}

export function isMcpCallToolParams(value: unknown): value is McpCallToolParams {
  if (!isObject(value)) return false;
  if (typeof value["name"] !== "string" || value["name"].length === 0) return false;
  return value["arguments"] === undefined || isObject(value["arguments"]);
}

export function isMcpCancelledParams(value: unknown): value is McpCancelledParams {
  if (!isObject(value)) return false;
  const requestId = value["requestId"];
  return typeof requestId === "string" || typeof requestId === "number";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
