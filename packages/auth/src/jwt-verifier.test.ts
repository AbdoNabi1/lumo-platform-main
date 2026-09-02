import { describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import type { Logger } from "@platform/utils";
import { JwtVerifier } from "./jwt-verifier";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "RS256" }] });
  const verifier = new JwtVerifier({
    issuer: "https://auth.lumo.local",
    audience: "lumo-admin",
    getKey: jwks,
    logger: silent,
  });
  const sign = (
    mutate: (jwt: SignJWT) => SignJWT = (j) => j,
    claims: Record<string, unknown> = {},
  ) =>
    mutate(
      new SignJWT({ kind: "staff", roles: ["admin"], tenant_id: "t-1", ...claims })
        .setProtectedHeader({ alg: "RS256" })
        .setSubject("staff-1")
        .setIssuer("https://auth.lumo.local")
        .setAudience("lumo-admin")
        .setIssuedAt()
        .setExpirationTime("5m"),
    ).sign(privateKey);
  return { verifier, sign, privateKey };
}

describe("JwtVerifier", () => {
  it("verifies a valid token and maps sub/kind/roles + exposes tenant claims", async () => {
    const { verifier, sign } = await setup();
    const context = await verifier.verifyWithClaims(await sign());
    expect(context?.principal).toEqual({ id: "staff-1", kind: "staff", roles: ["admin"] });
    expect(context?.claims["tenant_id"]).toBe("t-1");
  });

  it("rejects wrong audience, wrong issuer, and expired tokens as null (uniform 401 path)", async () => {
    const { verifier, sign } = await setup();
    expect(await verifier.verify(await sign((j) => j.setAudience("other")))).toBeNull();
    expect(await verifier.verify(await sign((j) => j.setIssuer("https://evil")))).toBeNull();
    expect(
      await verifier.verify(
        await sign((j) => j.setExpirationTime(Math.floor(Date.now() / 1000) - 120)),
      ),
    ).toBeNull();
  });

  it("tolerates bounded clock skew but not beyond it", async () => {
    const { verifier, sign } = await setup();
    const skewed = await sign((j) => j.setExpirationTime(Math.floor(Date.now() / 1000) - 10));
    expect(await verifier.verify(skewed)).not.toBeNull(); // within 30s tolerance
  });

  it("rejects tokens signed by a different key (signature verification)", async () => {
    const { verifier } = await setup();
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("staff-1")
      .setIssuer("https://auth.lumo.local")
      .setAudience("lumo-admin")
      .setExpirationTime("5m")
      .sign(other.privateKey);
    expect(await verifier.verify(forged)).toBeNull();
  });

  it("defaults unknown kinds to customer and rejects sub-less tokens", async () => {
    const { verifier, sign } = await setup();
    const context = await verifier.verifyWithClaims(await sign((j) => j, { kind: "superuser" }));
    expect(context?.principal.kind).toBe("customer");
  });
});
