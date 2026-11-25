import { generateKeyPairSync } from "node:crypto";
import { SignJWT, decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it, vi } from "vitest";
import { JwtVerifier } from "./jwt-verifier";
import { NativeTokenIssuer, loadSigningKey, localKeyResolver } from "./native-token-issuer";

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

function pem(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function issuer(raw = pem(), now = () => new Date()) {
  return new NativeTokenIssuer({
    privateKey: loadSigningKey(raw),
    issuer: "https://api.example.test/",
    audience: "morbeh-admin",
    ttlSeconds: 7200,
    now,
  });
}

describe("NativeTokenIssuer", () => {
  it("issues a token the existing JwtVerifier accepts, with roles, kind and tenant", async () => {
    const native = issuer();
    const { token, expiresIn } = await native.issue({
      sub: "staff-1",
      tenantId: "tenant-local",
      kind: "staff",
      roles: ["admin"],
      sid: "sess-1",
      email: "owner@example.test",
    });
    expect(expiresIn).toBe(7200);
    const verifier = new JwtVerifier({
      issuer: "https://api.example.test/",
      audience: "morbeh-admin",
      getKey: await localKeyResolver(native),
      logger: silent,
    });
    const context = await verifier.verifyWithClaims(token);
    expect(context?.principal).toEqual({ id: "staff-1", kind: "staff", roles: ["admin"] });
    expect(context?.claims["tenant_id"]).toBe("tenant-local");
    expect(context?.claims["sid"]).toBe("sess-1");
  });

  it("publishes only the public key", async () => {
    const { keys } = await issuer().jwks();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(keys[0]).not.toHaveProperty("d");
    expect(typeof keys[0]?.kid).toBe("string");
  });

  it("a token from another key, or an expired one, is refused", async () => {
    const mine = issuer();
    const theirs = issuer();
    const verifier = new JwtVerifier({
      issuer: "https://api.example.test/",
      audience: "morbeh-admin",
      getKey: await localKeyResolver(mine),
      logger: silent,
    });
    const forged = await theirs.issue({
      sub: "x",
      tenantId: "t",
      kind: "staff",
      roles: ["admin"],
      sid: "s",
    });
    expect(await verifier.verify(forged.token)).toBeNull();
    const old = issuer(pem(), () => new Date("2020-01-01T00:00:00Z"));
    const oldVerifier = new JwtVerifier({
      issuer: "https://api.example.test/",
      audience: "morbeh-admin",
      getKey: await localKeyResolver(old),
      logger: silent,
    });
    const expired = await old.issue({
      sub: "x",
      tenantId: "t",
      kind: "staff",
      roles: [],
      sid: "s",
    });
    expect(await oldVerifier.verify(expired.token)).toBeNull();
  });

  it("loads a base64-wrapped PEM (single-line env var) and rejects non-P-256 keys", () => {
    const raw = pem();
    expect(() => loadSigningKey(Buffer.from(raw).toString("base64"))).not.toThrow();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    expect(() => loadSigningKey(rsa)).toThrow(/P-256/);
    expect(() => loadSigningKey("not a key")).toThrow();
  });
});

describe("NativeTokenIssuer sign-in challenge", () => {
  const claims = { sub: "staff-1", tenantId: "tenant-a", email: "owner@example.test" };
  const verifierFor = async (native: NativeTokenIssuer, logger: unknown = silent) =>
    new JwtVerifier({
      issuer: "https://api.example.test/",
      audience: "morbeh-admin",
      getKey: await localKeyResolver(native),
      logger: logger as never,
    });

  it("round-trips sub, tenant, email and a unique jti, with the default 300 s lifetime", async () => {
    const native = issuer();
    const first = await native.issueChallenge(claims);
    const second = await native.issueChallenge(claims);
    expect(first.expiresIn).toBe(300);
    expect(first.jti).not.toBe(second.jti);
    expect(await native.verifyChallenge(first.token)).toEqual({ ...claims, jti: first.jti });
  });

  it("carries the challenge audience, typ and purpose and none of the session claims", async () => {
    const native = issuer();
    const { token, jti } = await native.issueChallenge(claims, 120);
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: "ES256", typ: "mfa-challenge+jwt" });
    const payload = decodeJwt(token);
    expect(payload.aud).toBe("morbeh-admin:mfa-challenge");
    expect(payload.iss).toBe("https://api.example.test/");
    expect(payload["purpose"]).toBe("staff-login-mfa");
    expect(payload["tenant_id"]).toBe("tenant-a");
    expect(payload["email"]).toBe("owner@example.test");
    expect(payload.jti).toBe(jti);
    expect(payload.exp! - payload.iat!).toBe(120);
    for (const claim of ["kind", "roles", "sid"]) expect(payload).not.toHaveProperty(claim);
  });

  it("expires: rejected once the lifetime plus the 30 s tolerance has passed", async () => {
    let current = new Date("2026-11-27T10:00:00.000Z");
    const native = issuer(pem(), () => current);
    const { token } = await native.issueChallenge(claims);
    current = new Date("2026-11-27T10:05:20.000Z"); // 320 s: inside lifetime + tolerance
    expect(await native.verifyChallenge(token)).not.toBeNull();
    current = new Date("2026-11-27T10:05:31.000Z"); // 331 s: past it
    expect(await native.verifyChallenge(token)).toBeNull();
  });

  it("a session token is not a challenge", async () => {
    const native = issuer();
    const session = await native.issue({
      sub: "staff-1",
      tenantId: "tenant-a",
      kind: "staff",
      roles: ["admin"],
      sid: "sess-1",
    });
    expect(await native.verifyChallenge(session.token)).toBeNull();
  });

  it("a challenge is not a session: JwtVerifier rejects it on audience", async () => {
    const native = issuer();
    const debug = vi.fn();
    const verifier = await verifierFor(native, { debug });
    const { token } = await native.issueChallenge(claims);
    expect(await verifier.verify(token)).toBeNull();
    expect(await verifier.verifyWithClaims(token)).toBeNull();
    expect(debug).toHaveBeenCalledWith("jwt verification failed", {
      reason: "JWTClaimValidationFailed",
    });
  });

  it("a tampered or malformed token, or one from another key, is null and never throws", async () => {
    const native = issuer();
    const { token } = await native.issueChallenge(claims);
    const [header, body, signature] = token.split(".");
    const tamperedBody = Buffer.from(
      JSON.stringify({ ...decodeJwt(token), tenant_id: "tenant-b" }),
    ).toString("base64url");
    expect(await native.verifyChallenge(`${header}.${tamperedBody}.${signature}`)).toBeNull();
    expect(
      await native.verifyChallenge(`${header}.${body}.${signature?.slice(0, -4)}AAAA`),
    ).toBeNull();
    expect(await native.verifyChallenge("not-a-jwt")).toBeNull();
    expect(await native.verifyChallenge("")).toBeNull();
    const foreign = await issuer().issueChallenge(claims);
    expect(await native.verifyChallenge(foreign.token)).toBeNull();
  });

  it("refuses a token signed with our key that lacks the challenge typ or purpose", async () => {
    const key = loadSigningKey(pem());
    const native = new NativeTokenIssuer({
      privateKey: key,
      issuer: "https://api.example.test/",
      audience: "morbeh-admin",
      ttlSeconds: 7200,
    });
    const sign = (header: Record<string, string>, extra: Record<string, unknown>) =>
      new SignJWT({ tenant_id: "tenant-a", email: "a@b.co", ...extra })
        .setProtectedHeader({ alg: "ES256", ...header })
        .setSubject("staff-1")
        .setIssuer("https://api.example.test/")
        .setAudience("morbeh-admin:mfa-challenge")
        .setJti("j-1")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(key);
    expect(
      await native.verifyChallenge(await sign({ typ: "JWT" }, { purpose: "staff-login-mfa" })),
    ).toBeNull();
    expect(
      await native.verifyChallenge(await sign({ typ: "mfa-challenge+jwt" }, { purpose: "other" })),
    ).toBeNull();
    expect(
      await native.verifyChallenge(
        await sign({ typ: "mfa-challenge+jwt" }, { purpose: "staff-login-mfa" }),
      ),
    ).toEqual({ sub: "staff-1", tenantId: "tenant-a", email: "a@b.co", jti: "j-1" });
  });
});
