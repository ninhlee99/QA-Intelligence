import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { WorkspaceContext, WorkspaceContextIssuanceResult, WorkspaceContextIssuer } from "../../requirement-review/public.js";

const STATE_TTL_MS = 10 * 60 * 1000;

export type OidcProviderEndpoints = Readonly<{
  authorization_endpoint: string;
  token_endpoint: string;
}>;

export type OauthCallbackServerOptions = Readonly<{
  provider: OidcProviderEndpoints;
  client_id: string;
  /** Public URL this service's own /callback path is reachable at (may differ from the local bind for a hosted deployment). */
  redirect_uri: string;
  scope: string;
  issuer: WorkspaceContextIssuer;
  environment: string;
  path?: string;
  now?(): Date;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}>;

type PendingAuthorization = Readonly<{
  code_verifier: string;
  created_at: number;
}>;

/**
 * Terminates the Authorization Code + PKCE (RFC 7636) leg for the remote MCP
 * profile (ADR-020 §3.2). This service issues no authorization decisions of
 * its own: it starts the browser redirect, receives the callback, exchanges
 * the resulting `code` for tokens directly with the identity provider's
 * token endpoint, and hands the resulting `id_token` to
 * `WorkspaceContextIssuer.issue()` — the same production seam (ADR-014 §2)
 * a Streamable HTTP bearer-token request is later re-verified against. A
 * Host Integration Package is configured with this service's URL, never
 * with raw IdP credentials (ADR-016 §5).
 */
export class OauthCallbackServer {
  readonly #options: OauthCallbackServerOptions;
  readonly #server: Server;
  readonly #pending = new Map<string, PendingAuthorization>();

  constructor(options: OauthCallbackServerOptions) {
    this.#options = options;
    this.#server = createServer((request, response) => {
      this.#handle(request.url ?? "/").then(
        (result) => {
          response.writeHead(result.status, result.headers ?? {}).end(result.body);
        },
        () => {
          response.writeHead(500).end("Internal error");
        },
      );
    });
  }

  listen(port: number, host: string): Promise<void> {
    return new Promise((resolve) => {
      this.#server.listen(port, host, () => resolve());
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  /** The bound TCP port once `listen()` has resolved; `undefined` if not listening. */
  address(): AddressInfo | undefined {
    const address = this.#server.address();
    return address === null || typeof address === "string" ? undefined : address;
  }

  /** Builds the URL a browser should be sent to; also registers this authorization attempt's PKCE verifier. */
  startAuthorization(): string {
    this.#evictExpired();
    const state = randomUUID();
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    this.#pending.set(state, { code_verifier: codeVerifier, created_at: (this.#options.now?.() ?? new Date()).getTime() });

    const url = new URL(this.#options.provider.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.#options.client_id);
    url.searchParams.set("redirect_uri", this.#options.redirect_uri);
    url.searchParams.set("scope", this.#options.scope);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async #handle(rawUrl: string): Promise<Readonly<{ status: number; headers?: Record<string, string>; body: string }>> {
    const path = this.#options.path ?? "/callback";
    const url = new URL(rawUrl, "http://internal.invalid");
    if (url.pathname === "/authorize") {
      return { status: 302, headers: { location: this.startAuthorization() }, body: "" };
    }
    if (url.pathname !== path) {
      return { status: 404, body: "Not found" };
    }

    const error = url.searchParams.get("error");
    if (error !== null) {
      return { status: 400, body: `Authorization denied: ${error}` };
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (code === null || state === null) {
      return { status: 400, body: "Missing code or state." };
    }

    this.#evictExpired();
    const pending = this.#pending.get(state);
    if (pending === undefined) {
      return { status: 400, body: "Unknown or expired authorization state." };
    }
    this.#pending.delete(state);

    const exchanged = await this.#exchangeCodeForToken(code, pending.code_verifier);
    if (!exchanged.ok) {
      return { status: 502, body: `Token exchange failed: ${exchanged.message}` };
    }

    const issued = await this.#options.issuer.issue({
      id_token: exchanged.id_token,
      operation_id: `mcp-remote-login:${state}`,
      request_id: state,
      correlation_id: state,
      environment: this.#options.environment,
    });

    if (!issued.ok) {
      return { status: 403, body: describeIssuanceFailure(issued) };
    }

    return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(sanitizeForDisplay(issued.value)) };
  }

  async #exchangeCodeForToken(
    code: string,
    codeVerifier: string,
  ): Promise<Readonly<{ ok: true; id_token: string }> | Readonly<{ ok: false; message: string }>> {
    const fetchImpl = this.#options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(this.#options.provider.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: this.#options.redirect_uri,
          client_id: this.#options.client_id,
          code_verifier: codeVerifier,
        }).toString(),
      });
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : "unreachable token endpoint" };
    }
    if (!response.ok) {
      return { ok: false, message: `token endpoint returned ${response.status}` };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, message: "token endpoint returned a non-JSON response" };
    }
    const idToken = isObject(payload) ? payload["id_token"] : undefined;
    if (typeof idToken !== "string" || idToken.length === 0) {
      return { ok: false, message: "token endpoint response is missing id_token" };
    }
    return { ok: true, id_token: idToken };
  }

  #evictExpired(): void {
    const now = (this.#options.now?.() ?? new Date()).getTime();
    for (const [state, pending] of this.#pending) {
      if (now - pending.created_at > STATE_TTL_MS) {
        this.#pending.delete(state);
      }
    }
  }
}

function describeIssuanceFailure(result: Extract<WorkspaceContextIssuanceResult, { ok: false }>): string {
  return `${result.failure.code}: ${result.failure.message}`;
}

/** Never surfaces integrity_proof or other signed material in a human-facing response body. */
function sanitizeForDisplay(context: WorkspaceContext): Readonly<{ workspace_id: string; actor_id: string; roles: readonly string[] }> {
  return { workspace_id: context.workspace_id, actor_id: context.actor_id, roles: context.roles };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
