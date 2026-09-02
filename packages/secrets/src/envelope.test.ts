import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnvelopeCipher, KeyAliasRegistry, type KeyWrapCipher } from "./envelope";

/**
 * A faithful in-test {@link KeyWrapCipher} (AES-256-GCM via node:crypto) — not a stub: it really wraps
 * data keys under a KEK ref and encrypts payloads under a data key, so the envelope round-trip is exercised
 * end to end. In production this seam is a KMS/Vault/HSM-backed `CryptoPort`.
 */
function testCipher(): KeyWrapCipher {
  const key = (ref: string): Buffer => scryptSync(ref, "envelope-test", 32);
  const seal = (plaintext: string, ref: string): string => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key(ref), iv);
    const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
    return `${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
  };
  const unseal = (blob: string, ref: string): string => {
    const [iv, tag, ct] = blob.split(":");
    if (iv === undefined || tag === undefined || ct === undefined) throw new Error("bad blob");
    const d = createDecipheriv("aes-256-gcm", key(ref), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  };
  return {
    encrypt: async (p, r) => seal(p, r),
    decrypt: async (c, r) => unseal(c, r),
    wrapKey: async (m, kek) => seal(m, kek),
    unwrapKey: async (w, kek) => unseal(w, kek),
    randomToken: async (bytes = 24) => randomBytes(bytes).toString("hex"),
  };
}

describe("KeyAliasRegistry", () => {
  it("resolves the current KEK ref and records version history on rotation", () => {
    const registry = new KeyAliasRegistry();
    registry.set("primary", "kek://v1");
    expect(registry.resolve("primary")).toBe("kek://v1");

    const previous = registry.rotate("primary", "kek://v2");
    expect(previous).toBe("kek://v1");
    expect(registry.resolve("primary")).toBe("kek://v2");
    expect(registry.versions("primary")).toEqual(["kek://v1", "kek://v2"]);
  });

  it("fails closed on an unknown alias or invalid input", () => {
    const registry = new KeyAliasRegistry();
    expect(() => registry.resolve("missing")).toThrow(/unknown key alias/);
    expect(() => registry.set("", "kek")).toThrow(/alias is required/);
    expect(() => registry.set("a", "")).toThrow(/kekRef is required/);
  });
});

describe("EnvelopeCipher", () => {
  it("seals and opens a payload with a per-message data key wrapped by the KEK", async () => {
    const registry = new KeyAliasRegistry();
    registry.set("primary", "kek://v1");
    const cipher = new EnvelopeCipher(testCipher(), registry);

    const sealed = await cipher.seal("super-secret", "primary");
    expect(sealed.kekRef).toBe("kek://v1");
    expect(sealed.ciphertext).not.toContain("super-secret");
    expect(await cipher.open(sealed)).toBe("super-secret");
  });

  it("uses a fresh data key per seal (envelopes differ for identical plaintext)", async () => {
    const registry = new KeyAliasRegistry();
    registry.set("primary", "kek://v1");
    const cipher = new EnvelopeCipher(testCipher(), registry);
    const a = await cipher.seal("same", "primary");
    const b = await cipher.seal("same", "primary");
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("still opens old envelopes after the alias is rotated to a new KEK version", async () => {
    const registry = new KeyAliasRegistry();
    registry.set("primary", "kek://v1");
    const cipher = new EnvelopeCipher(testCipher(), registry);

    const oldEnvelope = await cipher.seal("legacy", "primary");
    registry.rotate("primary", "kek://v2");

    const newEnvelope = await cipher.seal("fresh", "primary");
    expect(newEnvelope.kekRef).toBe("kek://v2");
    // Old data still decrypts under its embedded v1 KEK; new data under v2.
    expect(await cipher.open(oldEnvelope)).toBe("legacy");
    expect(await cipher.open(newEnvelope)).toBe("fresh");
  });

  it("rejects an unsupported envelope version", async () => {
    const registry = new KeyAliasRegistry();
    registry.set("primary", "kek://v1");
    const cipher = new EnvelopeCipher(testCipher(), registry);
    const sealed = await cipher.seal("x", "primary");
    await expect(cipher.open({ ...sealed, v: 99 })).rejects.toThrow(/unsupported envelope version/);
  });
});
