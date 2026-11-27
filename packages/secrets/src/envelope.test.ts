import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EnvelopeCipher,
  KeyAliasRegistry,
  type KeyWrapCipher,
  type SealedEnvelope,
} from "./envelope";

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

/** A cipher that records which KEK refs `unwrapKey` was asked to use, in order. */
function spyCipher(): { cipher: KeyWrapCipher; unwrapped: string[] } {
  const inner = testCipher();
  const unwrapped: string[] = [];
  return {
    unwrapped,
    cipher: {
      ...inner,
      unwrapKey: (wrapped, kek) => {
        unwrapped.push(kek);
        return inner.unwrapKey(wrapped, kek);
      },
    },
  };
}

const OPEN_FAILED = /^Sealed value could not be opened$/;
const KEK_A = "kek-test-aaaa";
const KEK_B = "kek-test-bbbb";
const KEK_ATTACKER = "kek-test-attacker";

/** A registry whose history is the given refs, oldest first (so the last one is current). */
function registryOf(alias: string, ...refsOldestFirst: string[]): KeyAliasRegistry {
  const registry = new KeyAliasRegistry();
  for (const ref of refsOldestFirst) registry.set(alias, ref);
  return registry;
}

/** What a v1 row looked like: the key reference sat next to the ciphertext. */
async function sealLegacyV1(
  plaintext: string,
  alias: string,
  kekRef: string,
): Promise<SealedEnvelope> {
  const raw = testCipher();
  const dek = await raw.randomToken(32);
  return {
    v: 1,
    alias,
    kekRef,
    wrappedDek: await raw.wrapKey(dek, kekRef),
    ciphertext: await raw.encrypt(plaintext, dek),
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

describe("KeyAliasRegistry.candidates (O15: the trusted, try-ordered keys for an alias)", () => {
  it("lists the current ref first, then earlier versions newest to oldest, without duplicates", () => {
    const registry = registryOf("primary", "kek-old", KEK_A, KEK_B);
    registry.set("primary", KEK_A);
    expect(registry.candidates("primary")).toEqual([KEK_A, KEK_B, "kek-old"]);
  });

  it("is empty for an unknown alias instead of throwing", () => {
    expect(new KeyAliasRegistry().candidates("missing")).toEqual([]);
  });

  it("returns a copy: callers cannot change the registry through it", () => {
    const registry = registryOf("primary", KEK_A);
    (registry.candidates("primary") as string[]).push(KEK_ATTACKER);
    expect(registry.candidates("primary")).toEqual([KEK_A]);
  });
});

describe("EnvelopeCipher", () => {
  it("seals and opens a payload with a per-message data key wrapped by the KEK", async () => {
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", "kek://v1"));

    const sealed = await cipher.seal("super-secret", "primary");
    expect(sealed.v).toBe(2);
    expect(sealed.ciphertext).not.toContain("super-secret");
    expect(await cipher.open(sealed)).toBe("super-secret");
  });

  it("uses a fresh data key per seal (envelopes differ for identical plaintext)", async () => {
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", "kek://v1"));
    const a = await cipher.seal("same", "primary");
    const b = await cipher.seal("same", "primary");
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("still opens old envelopes after the alias is rotated to a new KEK version", async () => {
    const registry = registryOf("primary", "kek://v1");
    const cipher = new EnvelopeCipher(testCipher(), registry);

    const oldEnvelope = await cipher.seal("legacy", "primary");
    registry.rotate("primary", "kek://v2");

    const newEnvelope = await cipher.seal("fresh", "primary");
    // Old data still decrypts under the alias's recorded earlier version; new data under v2.
    expect(await cipher.open(oldEnvelope)).toBe("legacy");
    expect(await cipher.open(newEnvelope)).toBe("fresh");
  });

  it("rejects an unsupported envelope version with the generic error", async () => {
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", "kek://v1"));
    const sealed = await cipher.seal("x", "primary");
    await expect(cipher.open({ ...sealed, v: 99 })).rejects.toThrow(OPEN_FAILED);
  });
});

describe("EnvelopeCipher envelope v2 (O15: no key reference in storage)", () => {
  it("seals {v:2, alias, wrappedDek, ciphertext} and nothing else: no kekRef, no ref anywhere in the JSON", async () => {
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A));
    const sealed = await cipher.seal("super-secret", "primary");
    expect(Object.keys(sealed).sort()).toEqual(["alias", "ciphertext", "v", "wrappedDek"]);
    expect(sealed.v).toBe(2);
    expect(JSON.stringify(sealed)).not.toContain(KEK_A);
    expect(await cipher.open(sealed)).toBe("super-secret");
  });

  it("opens an envelope after a JSON round trip (what a vault persists and reads back)", async () => {
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A));
    const stored = JSON.stringify(await cipher.seal("round-trip", "primary"));
    expect(await cipher.open(JSON.parse(stored) as SealedEnvelope)).toBe("round-trip");
  });
});

describe("EnvelopeCipher v1 compatibility: a stored kekRef is never used", () => {
  it("opens a v1 envelope using the registry's key, not the embedded one", async () => {
    const legacy = await sealLegacyV1("legacy-secret", "primary", KEK_A);
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A));
    expect(await cipher.open(legacy)).toBe("legacy-secret");
  });

  it("does NOT use the kekRef of a hostile v1 envelope: one sealed under an attacker key refuses to open", async () => {
    const forged = await sealLegacyV1("forged", "primary", KEK_ATTACKER);
    const { cipher: spied, unwrapped } = spyCipher();
    const cipher = new EnvelopeCipher(spied, registryOf("primary", KEK_A));
    await expect(cipher.open(forged)).rejects.toThrow(OPEN_FAILED);
    expect(unwrapped).toEqual([KEK_A]);
    expect(unwrapped).not.toContain(KEK_ATTACKER);
  });

  it("ignores a kekRef on a v2 envelope too", async () => {
    const forged = await sealLegacyV1("forged", "primary", KEK_ATTACKER);
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A));
    await expect(cipher.open({ ...forged, v: 2 })).rejects.toThrow(OPEN_FAILED);
  });
});

describe("EnvelopeCipher rotation (previous opens, current seals)", () => {
  it("opens data sealed under the previous key and seals new data under the current one", async () => {
    const before = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A));
    const old = await before.seal("old-data", "primary");
    const after = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A, KEK_B));
    expect(await after.open(old)).toBe("old-data");

    const fresh = await after.seal("new-data", "primary");
    const currentOnly = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_B));
    expect(await currentOnly.open(fresh)).toBe("new-data");
    const previousOnly = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A));
    await expect(previousOnly.open(fresh)).rejects.toThrow(OPEN_FAILED);
  });

  it("tries the current key first and only then the previous ones", async () => {
    const old = await new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A)).seal(
      "x",
      "primary",
    );
    const { cipher: spied, unwrapped } = spyCipher();
    const cipher = new EnvelopeCipher(spied, registryOf("primary", KEK_A, KEK_B));
    expect(await cipher.open(old)).toBe("x");
    expect(unwrapped).toEqual([KEK_B, KEK_A]);
  });
});

describe("EnvelopeCipher failures are one generic error", () => {
  it("wrong key everywhere, unknown alias, tampering, garbage and bad shapes all fail the same way", async () => {
    const sealed = await new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A)).seal(
      "payload-secret-value",
      "primary",
    );
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_B, KEK_ATTACKER));
    const inputs: unknown[] = [
      sealed,
      { ...sealed, alias: "other" },
      { ...sealed, ciphertext: "AAAA:BBBB:CCCC" },
      { ...sealed, wrappedDek: "AAAA:BBBB:CCCC" },
      { ...sealed, wrappedDek: 5 },
      { ...sealed, v: 3 },
      { ...sealed, v: "2" },
      { v: 2, alias: "primary" },
      null,
      "text",
      [],
    ];
    for (const input of inputs) {
      await expect(cipher.open(input as SealedEnvelope)).rejects.toThrow(OPEN_FAILED);
    }
  });

  it("names no key, alias, plaintext, ciphertext or cause", async () => {
    const sealed = await new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A)).seal(
      "payload-secret-value",
      "primary",
    );
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_B));
    const failure = await cipher.open(sealed).then(
      () => null,
      (error: unknown) => error as Error & { cause?: unknown },
    );
    expect(failure).not.toBeNull();
    const shown = `${failure?.message} ${JSON.stringify(failure)} ${String(failure?.stack)}`;
    const mustNotAppear = [
      KEK_A,
      KEK_B,
      "payload-secret-value",
      sealed.ciphertext,
      sealed.wrappedDek,
    ];
    for (const secret of mustNotAppear) {
      expect(shown).not.toContain(secret);
    }
    expect(failure?.cause).toBeUndefined();
  });

  it("seal fails closed on an unknown alias", async () => {
    const cipher = new EnvelopeCipher(testCipher(), new KeyAliasRegistry());
    await expect(cipher.seal("x", "missing")).rejects.toThrow(/unknown key alias/);
  });
});

describe("EnvelopeCipher.reseal (rotation re-wrap under the current key)", () => {
  it("returns null for a v2 envelope already under the current key", async () => {
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A, KEK_B));
    expect(await cipher.reseal(await cipher.seal("x", "primary"))).toBeNull();
  });

  it("re-seals a v2 envelope under the previous key as v2 under the current key, same plaintext", async () => {
    const old = await new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A)).seal(
      "keep-me",
      "primary",
    );
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A, KEK_B));
    const next = await cipher.reseal(old);
    expect(next).not.toBeNull();
    expect(next?.v).toBe(2);
    expect(Object.keys(next ?? {}).sort()).toEqual(["alias", "ciphertext", "v", "wrappedDek"]);
    const currentOnly = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_B));
    expect(await currentOnly.open(next as SealedEnvelope)).toBe("keep-me");
  });

  it("re-seals a v1 envelope (its stored kekRef dropped) even when it is under the current key", async () => {
    const legacy = await sealLegacyV1("legacy", "primary", KEK_A);
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A));
    const next = await cipher.reseal(legacy);
    expect(next?.v).toBe(2);
    expect(JSON.stringify(next)).not.toContain(KEK_A);
    expect(await cipher.open(next as SealedEnvelope)).toBe("legacy");
  });

  it("fails generically for an envelope no candidate opens (never re-seals garbage)", async () => {
    const legacy = await sealLegacyV1("x", "primary", KEK_ATTACKER);
    const cipher = new EnvelopeCipher(testCipher(), registryOf("primary", KEK_A));
    await expect(cipher.reseal(legacy)).rejects.toThrow(OPEN_FAILED);
  });
});
