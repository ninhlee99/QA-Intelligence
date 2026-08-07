import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type ServerNotification,
  type ServerRequest,
  type Tool as SdkTool,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * ADR-023 §4: the official MCP SDK's `Server` now owns protocol framing
 * (initialize handshake, protocol-version negotiation, JSON-RPC request/
 * response/notification wire format) that `jsonrpc.ts`/`protocol.ts`
 * hand-rolled under ADR-019. This module replaces those two files plus the
 * message-dispatch half of `mcp-server.ts` — but keeps the exact same
 * `McpToolRegistry`/`McpToolCallOutcome`/`McpTool` seam
 * `AgentRuntimeToolRegistry` and `agent-runtime-tool-registry.ts` already
 * implement and depend on unchanged (ADR-023 §4: the SDK replaces
 * transport/protocol code, not the domain seam translating `tools/call`
 * into the SPEC-508 Agent Runtime contract).
 */

export type McpTool = Readonly<{
  name: string;
  description: string;
  inputSchema: Readonly<{
    type: "object";
    properties?: Readonly<Record<string, object>>;
    required?: readonly string[];
  }>;
}>;

export type McpToolCallOutcome =
  | Readonly<{ ok: true; text: string }>
  | Readonly<{ ok: false; text: string }>;

/**
 * The seam between the transport-agnostic MCP core and QA Intelligence
 * domain contracts (ADR-016 §4, ADR-019 §5, preserved unchanged by ADR-023
 * §4). A registry entry SHALL call through SPEC-508/SPEC-511 — never a
 * Skill implementation or persistence directly — and SHALL NOT throw for a
 * domain-level failure; a domain failure is a normal McpToolCallOutcome
 * with ok:false, not a transport error.
 */
export interface McpToolRegistry {
  list(): readonly McpTool[];
  call(name: string, args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<McpToolCallOutcome>;
}

export type McpImplementationInfo = Readonly<{
  name: string;
  version: string;
}>;

export type SdkMcpServerDependencies = Readonly<{
  serverInfo: McpImplementationInfo;
  tools: McpToolRegistry;
  /**
   * ADR-019 §8's "tools/list and tools/call before initialize fail closed"
   * case, gated on the `notifications/initialized` signal, for the local
   * `stdio` transport (default `true`). The remote Streamable HTTP
   * transport performs its own discarded `initialize` round trip
   * per-request (ADR-020 §3.1's transparent handshake) rather than relying
   * on a client-sent `notifications/initialized`, so it passes `false`
   * here — the request was already authenticated end-to-end before
   * reaching this server, and the handshake gate would otherwise never
   * open for it.
   */
  requireHandshake?: boolean;
}>;

/**
 * Builds a real `@modelcontextprotocol/sdk` `Server` wired to one
 * `McpToolRegistry`. `tools/list`/`tools/call` handling is registered here,
 * mirroring exactly what the hand-rolled `McpServer` did (ADR-019 §4
 * scope: initialize, tools/list, tools/call, cancellation) — only the
 * transport and JSON-RPC framing underneath are now the SDK's, per ADR-023
 * §4. `RequestHandlerExtra.signal` gives cooperative cancellation for free,
 * replacing the hand-rolled `notifications/cancelled` -> AbortController
 * map ADR-019's McpServer maintained itself.
 */
export function createSdkMcpServer(dependencies: SdkMcpServerDependencies): Server {
  const server = new Server(dependencies.serverInfo, { capabilities: { tools: {} } });

  // ADR-019 §8's "tools/list and tools/call before initialize fail closed"
  // case is this repository's own requirement, not something the SDK's
  // protocol layer enforces on its behalf (it accepts requests as soon as a
  // transport is connected) — preserved explicitly so migrating to the SDK
  // does not silently drop it (ADR-023 §7 requires every ADR-019 §8 case
  // still pass).
  let initialized = dependencies.requireHandshake === false;
  server.oninitialized = () => {
    initialized = true;
  };

  server.setRequestHandler(ListToolsRequestSchema, () => {
    requireInitialized(initialized);
    return { tools: dependencies.tools.list().map(toSdkTool) };
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    async (
      request,
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
    ): Promise<CallToolResult> => {
      requireInitialized(initialized);
      const outcome = await dependencies.tools.call(request.params.name, request.params.arguments ?? {}, extra.signal);
      return {
        content: [{ type: "text", text: outcome.text }],
        isError: !outcome.ok,
      };
    },
  );

  return server;
}

function requireInitialized(initialized: boolean): void {
  if (!initialized) {
    throw new McpError(ErrorCode.InvalidRequest, "Server has not been initialized");
  }
}

function toSdkTool(tool: McpTool): SdkTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object",
      ...(tool.inputSchema.properties !== undefined ? { properties: tool.inputSchema.properties } : {}),
      ...(tool.inputSchema.required !== undefined ? { required: [...tool.inputSchema.required] } : {}),
    },
  };
}

export type { Transport };
