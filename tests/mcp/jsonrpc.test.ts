import assert from "node:assert/strict";
import test from "node:test";

import {
  jsonRpcError,
  jsonRpcSuccess,
  parseJsonRpcLine,
  serializeJsonRpcMessage,
  JSON_RPC_ERROR_CODES,
} from "../../src/mcp/jsonrpc.js";

test("parses a valid JSON-RPC request", () => {
  const parsed = parseJsonRpcLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
  assert.equal(parsed.ok, true);
  assert.ok(parsed.ok);
  assert.equal(parsed.message.method, "initialize");
});

test("parses a valid JSON-RPC notification (no id)", () => {
  const parsed = parseJsonRpcLine('{"jsonrpc":"2.0","method":"notifications/initialized"}');
  assert.equal(parsed.ok, true);
  assert.ok(parsed.ok);
  assert.equal("id" in parsed.message, false);
});

test("fails closed with parse_error on malformed JSON instead of throwing", () => {
  const parsed = parseJsonRpcLine("{not json");
  assert.equal(parsed.ok, false);
  assert.ok(!parsed.ok);
  assert.equal(parsed.error.error.code, JSON_RPC_ERROR_CODES.parse_error);
});

test("fails closed with invalid_request on a well-formed but non-JSON-RPC object", () => {
  const parsed = parseJsonRpcLine('{"hello":"world"}');
  assert.equal(parsed.ok, false);
  assert.ok(!parsed.ok);
  assert.equal(parsed.error.error.code, JSON_RPC_ERROR_CODES.invalid_request);
});

test("fails closed on a wrong jsonrpc version", () => {
  const parsed = parseJsonRpcLine('{"jsonrpc":"1.0","id":1,"method":"initialize"}');
  assert.equal(parsed.ok, false);
});

test("preserves the request id in an invalid_request error when recoverable", () => {
  const parsed = parseJsonRpcLine('{"jsonrpc":"1.0","id":"abc","method":"x"}');
  assert.equal(parsed.ok, false);
  assert.ok(!parsed.ok);
  assert.equal(parsed.error.id, "abc");
});

test("round-trips a success response through serialization", () => {
  const message = jsonRpcSuccess(1, { ok: true });
  const line = serializeJsonRpcMessage(message);
  assert.deepEqual(JSON.parse(line), { jsonrpc: "2.0", id: 1, result: { ok: true } });
});

test("round-trips an error response through serialization", () => {
  const message = jsonRpcError(1, JSON_RPC_ERROR_CODES.method_not_found, "nope");
  const line = serializeJsonRpcMessage(message);
  assert.deepEqual(JSON.parse(line), {
    jsonrpc: "2.0",
    id: 1,
    error: { code: JSON_RPC_ERROR_CODES.method_not_found, message: "nope" },
  });
});
