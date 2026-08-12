#!/usr/bin/env node
/**
 * One-shot MCP tool caller via stdio.
 * Usage: node scripts/mcp-call.js <toolName> <jsonArgs>
 */
const { spawn } = require("child_process");
const path = require("path");

const toolName = process.argv[2];
const args = JSON.parse(process.argv[3] ?? "{}");

const WORKSPACE_ID = "workspace-claude-code-dev";
const entrypoint = path.join(__dirname, "../dist/src/mcp/dev-entrypoint.js");

const proc = spawn("node", [entrypoint], {
  env: { ...process.env, QA_INTELLIGENCE_DEV_WORKSPACE_ID: WORKSPACE_ID },
  stdio: ["pipe", "pipe", "pipe"],
});

proc.stderr.on("data", (d) => process.stderr.write("[server] " + d));

let buf = "";
let reqId = 0;
const send = (msg) => proc.stdin.write(JSON.stringify(msg) + "\n");
const nextId = () => ++reqId;

send({
  jsonrpc: "2.0",
  id: nextId(),
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mcp-call", version: "0.0.1" } },
});

const timeout = setTimeout(() => {
  process.stderr.write("TIMEOUT\n");
  proc.kill();
  process.exit(1);
}, 300_000); // 5 min

proc.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  const lines = buf.split("\n");
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
        send({ jsonrpc: "2.0", id: nextId(), method: "tools/call", params: { name: toolName, arguments: args } });
      } else if (msg.id === 2) {
        clearTimeout(timeout);
        const result = msg.result ?? msg.error;
        const content = result?.content ?? [];
        for (const item of content) {
          if (item.type === "text") {
            try {
              console.log(JSON.stringify(JSON.parse(item.text), null, 2));
            } catch {
              console.log(item.text);
            }
          }
        }
        if (msg.error) process.stderr.write("MCP error: " + JSON.stringify(msg.error) + "\n");
        proc.kill();
        process.exit(msg.error ? 1 : 0);
      }
    } catch (_) {}
  }
});
