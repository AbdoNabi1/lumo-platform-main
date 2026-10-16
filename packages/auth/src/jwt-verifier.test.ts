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
    issuer: "https://auth.morbeh.local",
    audience: "morbeh-admin",
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
        .setIssuer("https://auth.morbeh.local")
        .setAudience("morbeh-admin")
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
      .setIssuer("https://auth.morbeh.local")
      .setAudience("morbeh-admin")
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

describe("JwtVerifier — Hydra's `ext` claim envelope", () => {
  // Ory Hydra nests whatever a consent UI puts in `session.access_token` under an `ext` object in
  // the issued JWT; they only appear top-level when the deployment sets `allowed_top_level_claims`,
  // which neither infrastructure/docker/hydra/hydra.yml nor the Ory Network project does. Reading
  // only the top level meant `roles` was always empty for a real browser login — the runtime never
  // surfaced it (local authorization is permissive) but admin-web's role gate denied every page.
  it("reads kind/roles from `ext` when Hydra nests them there", async () => {
    const { verifier, sign } = await setup();
    const token = await sign((j) => j, {
      kind: undefined,
      roles: undefined,
      ext: { kind: "staff", roles: ["admin", "operator"] },
    });
    const context = await verifier.verifyWithClaims(token);
    expect(context?.principal).toEqual({
      id: "staff-1",
      kind: "staff",
      roles: ["admin", "operator"],
    });
  });

  it("prefers a top-level claim over `ext` when both are present", async () => {
    const { verifier, sign } = await setup();
    const token = await sign((j) => j, {
      kind: "staff",
      roles: ["admin"],
      ext: { kind: "service", roles: ["viewer"] },
    });
    const context = await verifier.verifyWithClaims(token);
    expect(context?.principal.kind).toBe("staff");
    expect(context?.principal.roles).toEqual(["admin"]);
  });

  it("ignores a non-object `ext` rather than throwing", async () => {
    const { verifier, sign } = await setup();
    const token = await sign((j) => j, { kind: undefined, roles: undefined, ext: "nonsense" });
    const context = await verifier.verifyWithClaims(token);
    expect(context?.principal).toEqual({ id: "staff-1", kind: "customer", roles: [] });
  });
});
