import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Readable, Writable } from "node:stream";

/**
 * Local `stdio` transport (ADR-016 §8, ADR-020 §... / ADR-023 §4): the SDK's
 * `StdioServerTransport` now owns newline-delimited JSON-RPC framing over
 * an input/output stream — ADR-019's hand-rolled `readline`-based loop is
 * retired. Streams are still injected so this can run against real
 * process.stdin/stdout in production and against in-memory streams in
 * tests without spawning a subprocess (same test seam ADR-019 established).
 */
export class StdioTransport {
  readonly #server: Server;
  readonly #input: Readable;
  readonly #output: Writable;

  constructor(server: Server, input: Readable, output: Writable) {
    this.#server = server;
    this.#input = input;
    this.#output = output;
  }

  /** Resolves when the input stream ends (EOF / host disconnect). */
  async run(): Promise<void> {
    const transport = new StdioServerTransport(this.#input, this.#output);
    await this.#server.connect(transport);
    await new Promise<void>((resolve) => {
      this.#input.on("end", () => resolve());
      this.#input.on("close", () => resolve());
    });
    await this.#server.close();
  }
}
