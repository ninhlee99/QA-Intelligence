import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { exportJWK, generateKeyPair, type JWK } from "jose";

/**
 * Local JWKS HTTP fixture server plus ephemeral RSA keypair generation,
 * shared by every real-driver test that needs a real JWKS endpoint without
 * depending on an external identity provider (mirrors the "real driver, not
 * a fake" intent of pg-transaction-manager.real.test.ts for the OIDC/JWKS
 * seam, ADR-014, SPEC-506 §7).
 */

type GeneratedKeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

export type SigningKey = Readonly<{
  kid: string;
  privateKey: GeneratedKeyPair["privateKey"];
  jwk: JWK;
}>;

export async function generateSigningKey(kid: string): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";
  return { kid, privateKey, jwk };
}

export function startJwksServer(
  getKeys: () => readonly SigningKey[],
): Promise<{ url: string; close(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ keys: getKeys().map((key) => key.jwk) }));
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}/jwks.json`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) =>
              error ? closeReject(error) : closeResolve(),
            );
          }),
      });
    });
    server.on("error", reject);
  });
}
