import assert from "node:assert/strict";
import test from "node:test";

import { McpServer, type McpToolCallOutcome, type McpToolRegistry } from "../../src/mcp/mcp-server.js";
import { MCP_PROTOCOL_VERSION } from "../../src/mcp/protocol.js";
import type { McpTool } from "../../src/mcp/protocol.js";

function harness(tools: McpToolRegistry): Readonly<{ server: McpServer; sent: unknown[] }> {
  const sent: unknown[] = [];
  const server = new McpServer({
    serverInfo: { name: "qa-intelligence-test", version: "0.1.0" },
    tools,
    send: (line) => sent.push(JSON.parse(line)),
  });
  return { server, sent };
}

class StubRegistry implements McpToolRegistry {
  readonly calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = [];
  constructor(
    private readonly tools: readonly McpTool[] = [],
    private readonly outcome: McpToolCallOutcome = { ok: true, text: "done" },
  ) {}
  list(): readonly McpTool[] {
    return this.tools;
  }
  async call(name: string, args: Readonly<Record<string, unknown>>): Promise<McpToolCallOutcome> {
    this.calls.push({ name, args });
    if (!this.tools.some((tool) => tool.name === name)) {
      return { ok: false, text: `Unknown tool: ${name}` };
    }
    return this.outcome;
  }
}

test("ADR-019 §8: a compliant client can initialize, list tools, and call a tool", async () => {
  const tool: McpTool = {
    name: "assess_requirement_quality",
    description: "Assess a requirement's quality",
    inputSchema: { type: "object", properties: { requirement_ref: { type: "string" } }, required: ["requirement_ref"] },
  };
  const { server, sent } = harness(new StubRegistry([tool]));

  await server.handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test-host", version: "1.0.0" } },
    }),
  );
  await server.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  await server.handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "assess_requirement_quality", arguments: { requirement_ref: "REQ-1@1.0.0" } },
    }),
  );

  assert.equal(sent.length, 3);
  assert.deepEqual((sent[0] as { result: { serverInfo: unknown } }).result.serverInfo, {
    name: "qa-intelligence-test",
    version: "0.1.0",
  });
  assert.deepEqual((sent[1] as { result: { tools: unknown[] } }).result.tools, [tool]);
  const callResult = (sent[2] as { result: { content: Array<{ text: string }>; isError: boolean } }).result;
  assert.equal(callResult.isError, false);
  assert.equal(callResult.content[0]?.text, "done");
});

test("ADR-019 §8: an unsupported protocol version is rejected before any tool is exposed", async () => {
  const registry = new StubRegistry([{ name: "x", description: "x", inputSchema: { type: "object" } }]);
  const { server, sent } = harness(registry);

  await server.handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "old-host", version: "0.0.1" } },
    }),
  );
  await server.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));

  assert.equal(sent.length, 2);
  assert.ok((sent[0] as { error?: unknown }).error, "initialize should fail for a version mismatch");
  assert.ok((sent[1] as { error?: unknown }).error, "tools/list before a successful initialize must be rejected");
});

test("ADR-019 §8: tools/list and tools/call before initialize fail closed", async () => {
  const { server, sent } = harness(new StubRegistry());

  await server.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
  await server.handleLine(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "x" } }),
  );

  assert.equal(sent.length, 2);
  assert.ok((sent[0] as { error?: unknown }).error);
  assert.ok((sent[1] as { error?: unknown }).error);
});

test("ADR-019 §8: malformed JSON-RPC input fails closed with a structured error, never a crash", async () => {
  const { server, sent } = harness(new StubRegistry());

  await server.handleLine("not json at all {{{");
  await server.handleLine('{"hello":"world"}');

  assert.equal(sent.length, 2);
  assert.ok((sent[0] as { error?: unknown }).error);
  assert.ok((sent[1] as { error?: unknown }).error);
});

test("an unknown tool name is a normal error result, not a transport-level error", async () => {
  const { server, sent } = harness(new StubRegistry());
  await server.handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "h", version: "1" } },
    }),
  );
  await server.handleLine(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "does_not_exist" } }),
  );

  const result = (sent[1] as { result: { isError: boolean; content: Array<{ text: string }> } }).result;
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? "", /Unknown tool/);
});

test("notifications/cancelled aborts the in-flight tool call's signal", async () => {
  let observedSignal: AbortSignal | undefined;
  const registry: McpToolRegistry = {
    list: () => [],
    async call(_name, _args, signal) {
      observedSignal = signal;
      await new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(undefined));
      });
      return { ok: false, text: "cancelled" };
    },
  };
  const { server, sent } = harness(registry);
  await server.handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "h", version: "1" } },
    }),
  );

  const callPromise = server.handleLine(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "x" } }),
  );
  // Give the call a tick to register itself before cancelling.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await server.handleLine(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2 } }));
  await callPromise;

  assert.equal(observedSignal?.aborted, true);
  const callResult = (sent[1] as { result: { content: Array<{ text: string }> } }).result;
  assert.equal(callResult.content[0]?.text, "cancelled");
});
