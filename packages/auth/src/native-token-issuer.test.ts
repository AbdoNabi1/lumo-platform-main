import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
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
