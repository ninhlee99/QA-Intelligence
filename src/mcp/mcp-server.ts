import {
  jsonRpcError,
  jsonRpcSuccess,
  parseJsonRpcLine,
  serializeJsonRpcMessage,
  JSON_RPC_ERROR_CODES,
  type JsonRpcId,
  type JsonRpcMessage,
} from "./jsonrpc.js";
import {
  isMcpCallToolParams,
  isMcpCancelledParams,
  isMcpInitializeParams,
  MCP_PROTOCOL_VERSION,
  type McpCallToolResult,
  type McpImplementationInfo,
  type McpListToolsResult,
  type McpTool,
} from "./protocol.js";

export type McpToolCallOutcome =
  | Readonly<{ ok: true; text: string }>
  | Readonly<{ ok: false; text: string }>;

/**
 * The seam between the transport-agnostic MCP core and QA Intelligence
 * domain contracts (ADR-016 §4, ADR-019 §5). A registry entry SHALL call
 * through SPEC-508/SPEC-511 — never a Skill implementation or persistence
 * directly — and SHALL NOT throw for a domain-level failure; a domain
 * failure is a normal McpToolCallOutcome with ok:false, not a transport
 * error. This module never imports a Skill implementation, only this
 * interface, so that invariant is structurally enforced at the type level.
 */
export interface McpToolRegistry {
  list(): readonly McpTool[];
  call(name: string, args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<McpToolCallOutcome>;
}

export type McpServerDependencies = Readonly<{
  serverInfo: McpImplementationInfo;
  tools: McpToolRegistry;
  send(line: string): void;
}>;

/**
 * Transport-agnostic MCP JSON-RPC method handling (ADR-019 §4 scope):
 * initialize, tools/list, tools/call, and best-effort cancellation. Owns no
 * transport I/O itself — `send` is injected so this class can be driven by
 * stdio, a test harness, or (later, per ADR-019 §6) a different transport
 * without change.
 */
export class McpServer {
  readonly #serverInfo: McpImplementationInfo;
  readonly #tools: McpToolRegistry;
  readonly #send: (line: string) => void;
  readonly #inFlight = new Map<string, AbortController>();
  #initialized = false;

  constructor(dependencies: McpServerDependencies) {
    this.#serverInfo = dependencies.serverInfo;
    this.#tools = dependencies.tools;
    this.#send = dependencies.send;
  }

  /** Feeds one line of input. Never throws. */
  async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    const parsed = parseJsonRpcLine(trimmed);
    if (!parsed.ok) {
      this.#reply(parsed.error);
      return;
    }
    const message = parsed.message;
    if (!("id" in message)) {
      this.#handleNotification(message.method, message.params);
      return;
    }
    await this.#handleRequest(message.id, message.method, message.params);
  }

  async #handleRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    switch (method) {
      case "initialize": {
        if (!isMcpInitializeParams(params)) {
          this.#reply(jsonRpcError(id, JSON_RPC_ERROR_CODES.invalid_params, "Invalid initialize params"));
          return;
        }
        if (params.protocolVersion !== MCP_PROTOCOL_VERSION) {
          this.#reply(
            jsonRpcError(
              id,
              JSON_RPC_ERROR_CODES.invalid_params,
              `Unsupported protocol version: expected ${MCP_PROTOCOL_VERSION}, got ${params.protocolVersion}`,
            ),
          );
          return;
        }
        this.#initialized = true;
        this.#reply(
          jsonRpcSuccess(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: this.#serverInfo,
          }),
        );
        return;
      }
      case "tools/list": {
        if (!this.#requireInitialized(id)) return;
        const result: McpListToolsResult = { tools: this.#tools.list() };
        this.#reply(jsonRpcSuccess(id, result));
        return;
      }
      case "tools/call": {
        if (!this.#requireInitialized(id)) return;
        if (!isMcpCallToolParams(params)) {
          this.#reply(jsonRpcError(id, JSON_RPC_ERROR_CODES.invalid_params, "Invalid tools/call params"));
          return;
        }
        await this.#callTool(id, params.name, params.arguments ?? {});
        return;
      }
      default: {
        this.#reply(jsonRpcError(id, JSON_RPC_ERROR_CODES.method_not_found, `Unknown method: ${method}`));
        return;
      }
    }
  }

  #handleNotification(method: string, params: unknown): void {
    if (method === "notifications/initialized") {
      return;
    }
    if (method === "notifications/cancelled" && isMcpCancelledParams(params)) {
      this.#inFlight.get(String(params.requestId))?.abort();
      return;
    }
    // Unknown notifications are silently ignored per the JSON-RPC 2.0
    // notification contract: there is no response channel to report on.
  }

  async #callTool(
    id: JsonRpcId,
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const controller = new AbortController();
    const key = String(id);
    this.#inFlight.set(key, controller);
    try {
      const outcome = await this.#tools.call(name, args, controller.signal);
      const result: McpCallToolResult = {
        content: [{ type: "text", text: outcome.text }],
        isError: !outcome.ok,
      };
      this.#reply(jsonRpcSuccess(id, result));
    } catch (error) {
      this.#reply(
        jsonRpcError(
          id,
          JSON_RPC_ERROR_CODES.internal_error,
          error instanceof Error ? error.message : "Tool call failed",
        ),
      );
    } finally {
      this.#inFlight.delete(key);
    }
  }

  #requireInitialized(id: JsonRpcId): boolean {
    if (this.#initialized) return true;
    this.#reply(jsonRpcError(id, JSON_RPC_ERROR_CODES.invalid_request, "Server has not been initialized"));
    return false;
  }

  #reply(message: JsonRpcMessage): void {
    this.#send(serializeJsonRpcMessage(message));
  }
}
