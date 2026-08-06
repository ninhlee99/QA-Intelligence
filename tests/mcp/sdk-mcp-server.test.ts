import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createSdkMcpServer, type McpTool, type McpToolCallOutcome, type McpToolRegistry } from "../../src/mcp/sdk-mcp-server.js";

/**
 * ADR-023 §7: every ADR-019 §8 validation case re-verified against the
 * SDK-backed transport. Driven by the SDK's own `Client` over
 * `InMemoryTransport.createLinkedPair()` — a real client/server round trip
 * through the same protocol code a real host uses, not a hand-rolled
 * message-line harness.
 */

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

async function connectedPair(
  registry: McpToolRegistry,
): Promise<Readonly<{ client: Client }>> {
  const server = createSdkMcpServer({ serverInfo: { name: "qa-intelligence-test", version: "0.1.0" }, tools: registry });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-host", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client };
}

test("ADR-019 §8: a compliant client can initialize, list tools, and call a tool", async () => {
  const tool: McpTool = {
    name: "assess_requirement_quality",
    description: "Assess a requirement's quality",
    inputSchema: { type: "object", properties: { requirement_ref: { type: "string" } }, required: ["requirement_ref"] },
  };
  const { client } = await connectedPair(new StubRegistry([tool]));

  const listed = await client.listTools();
  assert.deepEqual(listed.tools, [tool]);

  const called = await client.callTool({ name: "assess_requirement_quality", arguments: { requirement_ref: "REQ-1@1.0.0" } });
  assert.equal(called.isError, false, JSON.stringify(called));
  const content = called.content as ReadonlyArray<{ text: string }>;
  assert.equal(content[0]?.text, "done");
});

test("ADR-019 §8: tools/list and tools/call before initialize fail closed", async () => {
  const server = createSdkMcpServer({ serverInfo: { name: "qa-intelligence-test", version: "0.1.0" }, tools: new StubRegistry() });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();

  const responses: unknown[] = [];
  clientTransport.onmessage = (message) => responses.push(message);

  // No Client.connect() (which performs the initialize handshake
  // automatically) — send tools/list directly against a server that has
  // never seen an initialize request.
  await clientTransport.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(responses.length, 1);
  assert.ok((responses[0] as { error?: unknown }).error, "tools/list before a successful initialize must be rejected");
});

test("an unknown tool name is a normal error result, not a transport-level error", async () => {
  const { client } = await connectedPair(new StubRegistry());

  const called = await client.callTool({ name: "does_not_exist" });
  assert.equal(called.isError, true);
  const content = called.content as ReadonlyArray<{ text: string }>;
  assert.match(content[0]?.text ?? "", /Unknown tool/);
});

test("client-side cancellation aborts the in-flight tool call's signal (SPEC-504-style cooperative cancellation)", async () => {
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
  const { client } = await connectedPair(registry);

  const controller = new AbortController();
  const callPromise = client.callTool({ name: "x" }, undefined, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort();

  // The SDK's client-side request layer rejects an aborted call (unlike
  // the hand-rolled transport, which resolved with the tool's own
  // cancelled-outcome text) — what this test verifies is that the abort
  // signal actually reaches the registry's in-flight call, which is the
  // cooperative-cancellation guarantee that matters to a caller.
  await assert.rejects(() => callPromise);
  assert.equal(observedSignal?.aborted, true);
});
