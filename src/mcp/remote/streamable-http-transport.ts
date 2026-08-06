import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer, type McpServerDependencies } from "../mcp-server.js";

const MAX_BODY_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export type BearerAuthenticationFailure = Readonly<{
  status: 401;
  message: string;
}>;

export type BearerAuthenticationResult =
  | Readonly<{ ok: true; buildServerDependencies(): Omit<McpServerDependencies, "send"> }>
  | Readonly<{ ok: false; failure: BearerAuthenticationFailure }>;

/**
 * Resolves the bearer token from one HTTP request's Authorization header
 * into everything McpServer needs to serve exactly that request (ADR-020
 * §3.3). Denial (missing/expired/malformed/wrong-issuer token, no Workspace
 * membership, suspended Workspace) SHALL happen here, before any JSON-RPC
 * message is parsed — the same "no inaccessible Workspace, secret, or
 * protected artifact revealed" requirement ADR-016 §6 already states for
 * `tools/list`.
 */
export interface BearerAuthenticator {
  authenticate(bearerToken: string | undefined): Promise<BearerAuthenticationResult>;
}

export type StreamableHttpTransportOptions = Readonly<{
  authenticator: BearerAuthenticator;
  path?: string;
  /** Refuses to bind to a non-loopback address unless explicitly overridden (ADR-020 §3.4). Test-only. */
  allowInsecureBind?: boolean;
}>;

/**
 * Remote Streamable HTTP MCP transport (ADR-020 §3.1): a single stateless
 * `POST {path}` endpoint. Each request is authenticated independently
 * (§3.3), re-verified through the same OIDC seam a local `stdio` caller
 * uses, and served by a fresh McpServer instance carrying its own
 * `initialize` handshake — there is no session resumption or server-push
 * (GET/SSE) in this scope (ADR-020 §3.1, §8). McpServer itself is
 * unmodified; this transport only supplies the per-request `send` and
 * Workspace-context-resolving tool registry a fresh McpServer needs.
 */
export class StreamableHttpTransport {
  readonly #options: StreamableHttpTransportOptions;
  readonly #server: Server;
  #listening = false;

  constructor(options: StreamableHttpTransportOptions) {
    this.#options = options;
    this.#server = createServer((request, response) => {
      this.#handle(request, response).catch(() => {
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json" }).end(
            JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } }),
          );
        }
      });
    });
  }

  async listen(port: number, host: string): Promise<void> {
    if (!LOOPBACK_HOSTS.has(host) && this.#options.allowInsecureBind !== true) {
      throw new Error(
        `Refusing to bind StreamableHttpTransport to non-loopback host "${host}" without allowInsecureBind (ADR-020 §3.4). Put TLS termination and this bind decision behind a reviewed deployment, not a default.`,
      );
    }
    await new Promise<void>((resolve) => {
      this.#server.listen(port, host, () => resolve());
    });
    this.#listening = true;
  }

  close(): Promise<void> {
    if (!this.#listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.#server.close((error) => (error ? reject(error) : resolve()));
      this.#listening = false;
    });
  }

  /** The bound TCP port once `listen()` has resolved; `undefined` if not listening. */
  address(): AddressInfo | undefined {
    const address = this.#server.address();
    return address === null || typeof address === "string" ? undefined : address;
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = this.#options.path ?? "/mcp";
    if (request.method !== "POST" || (request.url ?? "").split("?")[0] !== path) {
      response.writeHead(404, { "content-type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Not found" } }),
      );
      return;
    }

    const bearerToken = extractBearerToken(request.headers["authorization"]);
    const authentication = await this.#options.authenticator.authenticate(bearerToken);
    if (!authentication.ok) {
      response.writeHead(authentication.failure.status, { "content-type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: authentication.failure.message } }),
      );
      return;
    }

    const body = await readBody(request);
    if (body === undefined) {
      response.writeHead(413, { "content-type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request body too large" } }),
      );
      return;
    }

    let reply: string | undefined;
    const server = new McpServer({
      ...authentication.buildServerDependencies(),
      send: (line) => {
        reply = line;
      },
    });

    // Each HTTP request is its own MCP session (ADR-020 §3.1: no session
    // resumption): perform the handshake transparently, then forward the
    // client's actual message, so a caller never needs a prior `initialize`
    // round trip of its own.
    await server.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "__streamable-http-handshake__",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "streamable-http-client", version: "0.0.0" },
        },
      }),
    );
    reply = undefined;
    await server.handleLine(body);

    response.writeHead(200, { "content-type": "application/json" }).end(reply ?? "");
  }
}

function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1];
}

function readBody(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        resolve(undefined);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
