import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { McpServer } from "./mcp-server.js";

/**
 * Local `stdio` transport (ADR-016 §8, ADR-019 §4): reads newline-delimited
 * JSON-RPC messages from an input stream and writes responses to an output
 * stream. Streams are injected so this can run against real
 * process.stdin/stdout in production and against in-memory streams in
 * tests without spawning a subprocess.
 */
export class StdioTransport {
  readonly #server: McpServer;
  readonly #input: Readable;
  readonly #output: Writable;

  constructor(server: McpServer, input: Readable, output: Writable) {
    this.#server = server;
    this.#input = input;
    this.#output = output;
  }

  /** Resolves when the input stream ends (EOF / host disconnect). */
  async run(): Promise<void> {
    const lines = createInterface({ input: this.#input, terminal: false });
    for await (const line of lines) {
      await this.#server.handleLine(line);
    }
  }
}

export function stdioSender(output: Writable): (line: string) => void {
  return (line: string) => {
    output.write(line);
    output.write("\n");
  };
}
