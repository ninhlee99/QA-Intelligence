/**
 * JSON-RPC 2.0 message shapes and framing (ADR-019 §4): the wire format
 * MCP's stdio transport uses. This module knows nothing about MCP methods,
 * QA Intelligence domain contracts, or transports beyond newline-delimited
 * JSON — it is the reusable message layer other MCP modules build on.
 */

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = Readonly<{
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}>;

export type JsonRpcNotification = Readonly<{
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}>;

export type JsonRpcSuccessResponse = Readonly<{
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}>;

export type JsonRpcErrorObject = Readonly<{
  code: number;
  message: string;
  data?: unknown;
}>;

export type JsonRpcErrorResponse = Readonly<{
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}>;

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** Standard JSON-RPC 2.0 reserved error codes. */
export const JSON_RPC_ERROR_CODES = Object.freeze({
  parse_error: -32700,
  invalid_request: -32600,
  method_not_found: -32601,
  invalid_params: -32602,
  internal_error: -32603,
});

export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

export function jsonRpcSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccessResponse {
  return { jsonrpc: "2.0", id, result };
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    isObject(value) &&
    value["jsonrpc"] === "2.0" &&
    isJsonRpcId(value["id"]) &&
    value["id"] !== undefined &&
    typeof value["method"] === "string"
  );
}

export function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  return (
    isObject(value) &&
    value["jsonrpc"] === "2.0" &&
    !("id" in value) &&
    typeof value["method"] === "string"
  );
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number" || value === null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parses one newline-delimited JSON-RPC message. Never throws: a malformed
 * line fails closed with a structured parse-error result instead of
 * crashing the transport (ADR-019 §8 validation requirement).
 */
export function parseJsonRpcLine(
  line: string,
): Readonly<{ ok: true; message: JsonRpcRequest | JsonRpcNotification }> | Readonly<{ ok: false; error: JsonRpcErrorResponse }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, error: jsonRpcError(null, JSON_RPC_ERROR_CODES.parse_error, "Invalid JSON") };
  }
  if (isJsonRpcRequest(parsed)) {
    return { ok: true, message: parsed };
  }
  if (isJsonRpcNotification(parsed)) {
    return { ok: true, message: parsed };
  }
  const id = isObject(parsed) && isJsonRpcId(parsed["id"]) ? (parsed["id"] as JsonRpcId) : null;
  return {
    ok: false,
    error: jsonRpcError(id, JSON_RPC_ERROR_CODES.invalid_request, "Not a valid JSON-RPC 2.0 request or notification"),
  };
}

export function serializeJsonRpcMessage(message: JsonRpcMessage): string {
  return JSON.stringify(message);
}
