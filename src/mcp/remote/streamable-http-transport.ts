import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import { createSdkMcpServer, type SdkMcpServerDependencies } from "../sdk-mcp-server.js";

const MAX_BODY_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export type BearerAuthenticationFailure = Readonly<{
  status: 401;
  message: string;
}>;

export type BearerAuthenticationResult =
  | Readonly<{ ok: true; sessionKey?: string; buildServerDependencies(): SdkMcpServerDependencies }>
  | Readonly<{ ok: false; failure: BearerAuthenticationFailure }>;

/**
 * Resolves the bearer token from one HTTP request's Authorization header
 * into everything the MCP server needs to serve exactly that request
 * (ADR-020 §3.3). Denial (missing/expired/malformed/wrong-issuer token, no
 * Workspace membership, suspended Workspace) SHALL happen here, before any
 * JSON-RPC message is parsed — the same "no inaccessible Workspace, secret,
 * or protected artifact revealed" requirement ADR-016 §6 already states for
 * `tools/list`.
 */
export interface BearerAuthenticator {
  authenticate(bearerToken: string | undefined): Promise<BearerAuthenticationResult>;
}

export type StreamableHttpTransportOptions = Readonly<{
  authenticator: BearerAuthenticator;
  path?: string;
  /** Legacy MCP SSE compatibility endpoint. Defaults to /sse. */
  ssePath?: string;
  /** Legacy MCP SSE client-message endpoint. Defaults to /messages. */
  messagesPath?: string;
  /** Refuses to bind to a non-loopback address unless explicitly overridden (ADR-020 §3.4). Test-only. */
  allowInsecureBind?: boolean;
}>;

/**
 * Remote Streamable HTTP MCP transport (ADR-020 §3.1), now backed by the
 * official SDK's `WebStandardStreamableHTTPServerTransport` in stateless
 * mode (`sessionIdGenerator: undefined`) per ADR-023 §4 — the SDK owns
 * JSON-RPC parsing, protocol-version negotiation, and response shaping;
 * this class still owns everything ADR-020 requires that isn't generic MCP
 * transport concern: binding policy (loopback-only unless explicitly
 * overridden), the single `POST {path}` route, and per-request bearer
 * authentication performed before any JSON-RPC message reaches the SDK
 * server. A stateless SDK transport instance accepts exactly one
 * `handleRequest` call ever (a second call throws "Stateless transport
 * cannot be reused"), so — unlike the hand-rolled transport, which drove
 * its own McpServer directly and could freely feed it a synthetic
 * `initialize` before the caller's real message — this transport passes
 * `requireHandshake: false` to `createSdkMcpServer` and serves the
 * caller's message directly with no separate handshake round trip at all:
 * the SDK's own protocol layer does not itself require an `initialize`
 * before honoring a request over a session-less (stateless) transport, and
 * this repository's own initialized-gate is intentionally not enforced on
 * this path since ADR-020 §3.3 already authenticates the whole request
 * before any JSON-RPC message is parsed. The Web Standard transport (not
 * the Node-specific wrapper) is used directly to build that single
 * synthetic `Request` in-process from the already-read body. Each request
 * is authenticated independently (§3.3), re-verified through the same OIDC
 * seam a local `stdio` caller uses, and served by a fresh SDK server
 * instance and fresh transport instance — there is no session resumption
 * across requests (ADR-020 §3.1, §8), matching the hand-rolled transport's
 * prior behavior exactly.
 */
export class StreamableHttpTransport {
  readonly #options: StreamableHttpTransportOptions;
  readonly #server: Server;
  readonly #sseSessions = new Map<string, Readonly<{ transport: SSEServerTransport; sessionKey: string }>>();
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
    for (const session of this.#sseSessions.values()) void session.transport.close();
    this.#sseSessions.clear();
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
    const ssePath = this.#options.ssePath ?? "/sse";
    const messagesPath = this.#options.messagesPath ?? "/messages";
    const requestPath = (request.url ?? "").split("?")[0];
    if (request.method === "GET" && requestPath === ssePath) {
      await this.#openSse(request, response, messagesPath);
      return;
    }
    if (request.method === "POST" && requestPath === messagesPath) {
      await this.#postSse(request, response);
      return;
    }
    if (request.method !== "POST" || requestPath !== path) {
      response.writeHead(404, { "content-type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Not found" } }),
      );
      return;
    }

    const authentication = await this.#authenticate(request, response);
    if (authentication === undefined) return;

    const body = await readBody(request);
    if (body === undefined) {
      response.writeHead(413, { "content-type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request body too large" } }),
      );
      return;
    }

    const requestUrl = new URL(path, "http://mcp.local");
    const server = createSdkMcpServer({ ...authentication.buildServerDependencies(), requireHandshake: false });
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await server.connect(transport);

    // Each HTTP request is its own MCP session (ADR-020 §3.1: no session
    // resumption, transparent handshake): the caller's message is served
    // directly, with no prior `initialize` round trip required of it —
    // `requireHandshake: false` above is what makes this transport's own
    // initialized-gate not apply here.
    const webResponse = await transport.handleRequest(
      new Request(requestUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body,
      }),
    );
    await writeWebResponse(webResponse, response);
  }

  async #openSse(request: IncomingMessage, response: ServerResponse, messagesPath: string): Promise<void> {
    const authentication = await this.#authenticate(request, response);
    if (authentication === undefined) return;
    if (!authentication.sessionKey) {
      writeAuthenticationFailure(response, "Authenticated identity cannot be bound to an SSE session.");
      return;
    }
    const transport = new SSEServerTransport(messagesPath, response);
    const sessionId = transport.sessionId;
    this.#sseSessions.set(sessionId, { transport, sessionKey: authentication.sessionKey });
    transport.onclose = () => this.#sseSessions.delete(sessionId);
    const server = createSdkMcpServer(authentication.buildServerDependencies());
    try {
      await server.connect(transport);
    } catch (error) {
      this.#sseSessions.delete(sessionId);
      throw error;
    }
  }

  async #postSse(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authentication = await this.#authenticate(request, response);
    if (authentication === undefined) return;
    const sessionId = new URL(request.url ?? "/messages", "http://mcp.local").searchParams.get("sessionId");
    const session = sessionId ? this.#sseSessions.get(sessionId) : undefined;
    if (session === undefined) {
      response.writeHead(404, { "content-type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unknown SSE session" } }),
      );
      return;
    }
    if (!authentication.sessionKey || authentication.sessionKey !== session.sessionKey) {
      response.writeHead(403, { "content-type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "SSE session identity mismatch" } }),
      );
      return;
    }
    await session.transport.handlePostMessage(request, response);
  }

  async #authenticate(request: IncomingMessage, response: ServerResponse): Promise<Extract<BearerAuthenticationResult, { ok: true }> | undefined> {
    const authentication = await this.#options.authenticator.authenticate(extractBearerToken(request.headers["authorization"]));
    if (!authentication.ok) {
      writeAuthenticationFailure(response, authentication.failure.message);
      return undefined;
    }
    return authentication;
  }
}

function writeAuthenticationFailure(response: ServerResponse, message: string): void {
  response.writeHead(401, { "content-type": "application/json" }).end(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }),
  );
}

async function writeWebResponse(webResponse: Response, response: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  webResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });
  response.writeHead(webResponse.status, headers);
  const text = await webResponse.text();
  response.end(text);
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
