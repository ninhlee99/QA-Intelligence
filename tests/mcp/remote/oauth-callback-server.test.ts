import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DeterministicWorkspaceContextIssuer,
  type DeterministicIdentityClaims,
  type MembershipRecord,
} from "../../../src/adapters/oidc/workspace-context-issuer.js";
import { OauthCallbackServer } from "../../../src/mcp/remote/oauth-callback-server.js";

const EXPECTED_ISSUER = "https://idp.test.invalid";
const EXPECTED_AUDIENCE = "qa-intelligence-remote-test";
const WORKSPACE_ID = "workspace-remote-002";
const ACTOR_ID = "actor-remote-002";
const REDIRECT_URI = "http://127.0.0.1:0/callback";

const MEMBERSHIP: MembershipRecord = {
  workspace_id: WORKSPACE_ID,
  actor_id: ACTOR_ID,
  actor_type: "human",
  roles: ["mcp-remote-caller"],
  permissions: ["agent:execute"],
  policy_version: "policy@1.0.0",
};

function encodeToken(claims: DeterministicIdentityClaims): string {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
}

function makeIssuer(overrides: Readonly<{ workspaceStatus?: "active" | "suspended" }> = {}) {
  return new DeterministicWorkspaceContextIssuer({
    expected_issuer: EXPECTED_ISSUER,
    expected_audience: EXPECTED_AUDIENCE,
    workspace: { workspace_id: WORKSPACE_ID, status: overrides.workspaceStatus ?? "active" },
    membership: {
      resolve: (actorId, workspaceId) =>
        actorId === MEMBERSHIP.actor_id && workspaceId === WORKSPACE_ID ? MEMBERSHIP : undefined,
    },
    decoder: {
      decode: (idToken) => {
        try {
          return JSON.parse(Buffer.from(idToken, "base64url").toString("utf8")) as DeterministicIdentityClaims;
        } catch {
          return undefined;
        }
      },
    },
    signProof: (canonicalClaims) => `fixture-sha256:${canonicalClaims.length}`,
    context_issuer: "https://workspace-manager.test.invalid",
    clock: { now: () => new Date("2026-08-06T08:00:00.000Z") },
  });
}

/** A fake token endpoint that only accepts the exact PKCE verifier it was given the challenge for. */
function fakeTokenEndpointFetch(
  expectedCode: string,
  codeChallenge: string,
  respondWith: DeterministicIdentityClaims | "invalid_grant",
): typeof fetch {
  return (async (_url: string | URL, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ""));
    const verifier = body.get("code_verifier") ?? "";
    const challengeFromVerifier = createHash("sha256").update(verifier).digest("base64url");
    const codeMatches = body.get("code") === expectedCode;
    const pkceMatches = challengeFromVerifier === codeChallenge;

    if (respondWith === "invalid_grant" || !codeMatches || !pkceMatches) {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }
    return new Response(JSON.stringify({ id_token: encodeToken(respondWith) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function extractStateAndChallenge(authorizationUrl: string): Readonly<{ state: string; challenge: string }> {
  const url = new URL(authorizationUrl);
  return {
    state: url.searchParams.get("state") ?? "",
    challenge: url.searchParams.get("code_challenge") ?? "",
  };
}

test("ADR-020 §9: a valid authorization code round-trips through issue() to a signed WorkspaceContext", async () => {
  const expectedCode = "auth-code-001";
  let capturedChallenge = "";

  const server = new OauthCallbackServer({
    provider: { authorization_endpoint: "https://idp.test.invalid/authorize", token_endpoint: "https://idp.test.invalid/token" },
    client_id: "qa-intelligence-remote-client",
    redirect_uri: REDIRECT_URI,
    scope: "openid",
    issuer: makeIssuer(),
    environment: "test",
    fetchImpl: (async (url, init) => {
      const tokenFetch = fakeTokenEndpointFetch(expectedCode, capturedChallenge, {
        sub: ACTOR_ID,
        iss: EXPECTED_ISSUER,
        aud: EXPECTED_AUDIENCE,
      });
      return tokenFetch(url, init);
    }) as typeof fetch,
  });

  const authorizationUrl = server.startAuthorization();
  const { state, challenge } = extractStateAndChallenge(authorizationUrl);
  capturedChallenge = challenge;

  await server.listen(0, "127.0.0.1");
  try {
    const port = server.address()?.port;
    const response = await fetch(
      `http://127.0.0.1:${port}/callback?code=${encodeURIComponent(expectedCode)}&state=${encodeURIComponent(state)}`,
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { workspace_id: string; actor_id: string; roles: string[] };
    assert.equal(payload.workspace_id, WORKSPACE_ID);
    assert.equal(payload.actor_id, ACTOR_ID);
    assert.deepEqual(payload.roles, [...MEMBERSHIP.roles]);
  } finally {
    await server.close();
  }
});

test("ADR-020 §9: an unknown or expired state fails closed without calling the token endpoint", async () => {
  let tokenEndpointCalled = false;
  const server = new OauthCallbackServer({
    provider: { authorization_endpoint: "https://idp.test.invalid/authorize", token_endpoint: "https://idp.test.invalid/token" },
    client_id: "qa-intelligence-remote-client",
    redirect_uri: REDIRECT_URI,
    scope: "openid",
    issuer: makeIssuer(),
    environment: "test",
    fetchImpl: (async () => {
      tokenEndpointCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });

  await server.listen(0, "127.0.0.1");
  try {
    const port = server.address()?.port;
    const response = await fetch(`http://127.0.0.1:${port}/callback?code=some-code&state=never-issued-state`);
    assert.equal(response.status, 400);
    assert.equal(tokenEndpointCalled, false);
  } finally {
    await server.close();
  }
});

test("ADR-020 §9: an id_token for a suspended Workspace fails closed (403), not a widened allow", async () => {
  const expectedCode = "auth-code-002";
  let capturedChallenge = "";

  const server = new OauthCallbackServer({
    provider: { authorization_endpoint: "https://idp.test.invalid/authorize", token_endpoint: "https://idp.test.invalid/token" },
    client_id: "qa-intelligence-remote-client",
    redirect_uri: REDIRECT_URI,
    scope: "openid",
    issuer: makeIssuer({ workspaceStatus: "suspended" }),
    environment: "test",
    fetchImpl: (async (url, init) => {
      const tokenFetch = fakeTokenEndpointFetch(expectedCode, capturedChallenge, {
        sub: ACTOR_ID,
        iss: EXPECTED_ISSUER,
        aud: EXPECTED_AUDIENCE,
      });
      return tokenFetch(url, init);
    }) as typeof fetch,
  });

  const authorizationUrl = server.startAuthorization();
  const { state, challenge } = extractStateAndChallenge(authorizationUrl);
  capturedChallenge = challenge;

  await server.listen(0, "127.0.0.1");
  try {
    const port = server.address()?.port;
    const response = await fetch(
      `http://127.0.0.1:${port}/callback?code=${encodeURIComponent(expectedCode)}&state=${encodeURIComponent(state)}`,
    );
    assert.equal(response.status, 403);
  } finally {
    await server.close();
  }
});

test("ADR-020 §9: the identity provider denying authorization surfaces as a 400, not a crash", async () => {
  const server = new OauthCallbackServer({
    provider: { authorization_endpoint: "https://idp.test.invalid/authorize", token_endpoint: "https://idp.test.invalid/token" },
    client_id: "qa-intelligence-remote-client",
    redirect_uri: REDIRECT_URI,
    scope: "openid",
    issuer: makeIssuer(),
    environment: "test",
  });

  await server.listen(0, "127.0.0.1");
  try {
    const port = server.address()?.port;
    const response = await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`);
    assert.equal(response.status, 400);
  } finally {
    await server.close();
  }
});

test("ADR-020 §9: token exchange with a wrong PKCE verifier is rejected by the token endpoint, not silently accepted", async () => {
  const expectedCode = "auth-code-003";

  const server = new OauthCallbackServer({
    provider: { authorization_endpoint: "https://idp.test.invalid/authorize", token_endpoint: "https://idp.test.invalid/token" },
    client_id: "qa-intelligence-remote-client",
    redirect_uri: REDIRECT_URI,
    scope: "openid",
    issuer: makeIssuer(),
    environment: "test",
    fetchImpl: (async (url, init) => {
      // Intentionally checks against a challenge that will never match the
      // server's real PKCE verifier, simulating a token endpoint that
      // correctly rejects a mismatched verifier/challenge pair.
      const tokenFetch = fakeTokenEndpointFetch(expectedCode, "mismatched-challenge", {
        sub: ACTOR_ID,
        iss: EXPECTED_ISSUER,
        aud: EXPECTED_AUDIENCE,
      });
      return tokenFetch(url, init);
    }) as typeof fetch,
  });

  const authorizationUrl = server.startAuthorization();
  const { state } = extractStateAndChallenge(authorizationUrl);

  await server.listen(0, "127.0.0.1");
  try {
    const port = server.address()?.port;
    const response = await fetch(
      `http://127.0.0.1:${port}/callback?code=${encodeURIComponent(expectedCode)}&state=${encodeURIComponent(state)}`,
    );
    assert.equal(response.status, 502);
  } finally {
    await server.close();
  }
});
