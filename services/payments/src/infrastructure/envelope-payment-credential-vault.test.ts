import { EnvelopeCipher, KeyAliasRegistry } from "@platform/secrets";
import { LocalKeyWrapCipher } from "@platform/secrets/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { EnvelopePaymentCredentialVault } from "./envelope-payment-credential-vault";

beforeEach(() => {
  expect.hasAssertions();
});

const ALIAS = "payments-credentials";
const KEK_A = "kek-test-aaaa";
const KEK_B = "kek-test-bbbb";
const KEK_ATTACKER = "kek-test-attacker";
const OPEN_FAILED = /^Merchant payment credentials could not be opened$/;
const SECRETS = { secretKey: "sk-test-1111" };

/** A vault whose registry history is the given refs, oldest first (the last is current). */
function vaultWith(...refsOldestFirst: string[]): EnvelopePaymentCredentialVault {
  const aliases = new KeyAliasRegistry();
  for (const ref of refsOldestFirst) aliases.set(ALIAS, ref);
  return new EnvelopePaymentCredentialVault(
    new EnvelopeCipher(new LocalKeyWrapCipher(), aliases),
    ALIAS,
  );
}

/** A row exactly as v1 stored it: the key reference sat next to the ciphertext. */
async function legacyV1Row(kekRef: string, tenant = "t-1"): Promise<string> {
  const cipher = new LocalKeyWrapCipher();
  const dek = await cipher.randomToken(32);
  const payload = JSON.stringify({ v: 1, t: tenant, p: "paymob", s: SECRETS });
  return JSON.stringify({
    v: 1,
    alias: ALIAS,
    kekRef,
    wrappedDek: await cipher.wrapKey(dek, kekRef),
    ciphertext: await cipher.encrypt(payload, dek),
  });
}

describe("EnvelopePaymentCredentialVault (O15: no key reference in storage)", () => {
  it("persists exactly {v:2, alias, wrappedDek, ciphertext}: no kekRef and no key anywhere in the blob", async () => {
    const sealed = await vaultWith(KEK_A).seal("t-1", "paymob", SECRETS);
    const stored = JSON.parse(sealed) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["alias", "ciphertext", "v", "wrappedDek"]);
    expect(stored["v"]).toBe(2);
    expect(stored["alias"]).toBe(ALIAS);
    expect(sealed).not.toContain("kekRef");
    expect(sealed).not.toContain(KEK_A);
    expect(sealed).not.toContain("sk-test-1111");
  });

  it("round-trips for the same tenant and provider", async () => {
    const vault = vaultWith(KEK_A);
    const sealed = await vault.seal("t-1", "paymob", SECRETS);
    expect(await vault.open("t-1", "paymob", sealed)).toEqual(SECRETS);
  });

  it("opens a legacy v1 row using the vault's own key, not the one embedded in the row", async () => {
    const vault = vaultWith(KEK_A);
    expect(await vault.open("t-1", "paymob", await legacyV1Row(KEK_A))).toEqual(SECRETS);
  });

  it("does NOT use the kekRef of a v1 row: an envelope sealed under an attacker's key stays closed", async () => {
    const vault = vaultWith(KEK_A);
    await expect(vault.open("t-1", "paymob", await legacyV1Row(KEK_ATTACKER))).rejects.toThrow(
      OPEN_FAILED,
    );
  });

  it("a kekRef added to a v2 row is ignored too", async () => {
    const vault = vaultWith(KEK_A);
    const stored = JSON.parse(await vault.seal("t-1", "paymob", SECRETS)) as Record<
      string,
      unknown
    >;
    const hostile = JSON.stringify({ ...stored, kekRef: KEK_ATTACKER });
    expect(await vault.open("t-1", "paymob", hostile)).toEqual(SECRETS);
  });

  it("rotation: the previous key still opens old rows, new rows are sealed under the current key", async () => {
    const old = await vaultWith(KEK_A).seal("t-1", "paymob", SECRETS);
    const rotated = vaultWith(KEK_A, KEK_B);
    expect(await rotated.open("t-1", "paymob", old)).toEqual(SECRETS);

    const fresh = await rotated.seal("t-1", "paymob", SECRETS);
    expect(await vaultWith(KEK_B).open("t-1", "paymob", fresh)).toEqual(SECRETS);
    await expect(vaultWith(KEK_A).open("t-1", "paymob", fresh)).rejects.toThrow(OPEN_FAILED);
  });

  it("every failure is the same generic message: garbage, tampering, wrong key, other alias, other tenant", async () => {
    const vault = vaultWith(KEK_A);
    const stored = JSON.parse(await vault.seal("t-1", "paymob", SECRETS)) as Record<
      string,
      unknown
    >;
    const sealed = JSON.stringify(stored);
    const cases: [string, string, string][] = [
      ["t-1", "paymob", "not json"],
      ["t-1", "paymob", "{}"],
      ["t-1", "paymob", "[]"],
      ["t-1", "paymob", "null"],
      ["t-1", "paymob", JSON.stringify({ ...stored, ciphertext: "AAAA:BBBB:CCCC" })],
      ["t-1", "paymob", JSON.stringify({ ...stored, alias: "shipping-credentials" })],
      ["t-1", "paymob", JSON.stringify({ ...stored, v: 3 })],
      ["t-2", "paymob", sealed],
      ["t-1", "other", sealed],
    ];
    for (const [tenant, provider, row] of cases) {
      const failure = await vault.open(tenant, provider, row).then(
        () => null,
        (error: unknown) => error as Error,
      );
      expect(failure?.message).toMatch(OPEN_FAILED);
    }
    await expect(vaultWith(KEK_B).open("t-1", "paymob", sealed)).rejects.toThrow(OPEN_FAILED);
  });

  it("names no key, secret or blob in a failure", async () => {
    const sealed = await vaultWith(KEK_A).seal("t-1", "paymob", SECRETS);
    const failure = await vaultWith(KEK_B)
      .open("t-1", "paymob", sealed)
      .then(
        () => null,
        (error: unknown) => error as Error & { cause?: unknown },
      );
    const shown = `${failure?.message} ${String(failure?.stack)}`;
    for (const secret of [KEK_A, KEK_B, "sk-test-1111", sealed]) {
      expect(shown).not.toContain(secret);
    }
    expect(failure?.cause).toBeUndefined();
  });
});

describe("EnvelopePaymentCredentialVault.reseal (rotation re-wrap)", () => {
  it("returns the very same string for a v2 row already under the current key", async () => {
    const vault = vaultWith(KEK_A, KEK_B);
    const sealed = await vault.seal("t-1", "paymob", SECRETS);
    expect(await vault.reseal(sealed)).toBe(sealed);
  });

  it("re-wraps a row under the previous key as v2 under the current one, payload and binding intact", async () => {
    const old = await vaultWith(KEK_A).seal("t-1", "paymob", SECRETS);
    const rotated = vaultWith(KEK_A, KEK_B);
    const next = await rotated.reseal(old);
    expect(next).not.toBe(old);
    expect(Object.keys(JSON.parse(next) as object).sort()).toEqual([
      "alias",
      "ciphertext",
      "v",
      "wrappedDek",
    ]);
    // Only the CURRENT key opens it now, and it is still bound to its tenant and provider.
    const currentOnly = vaultWith(KEK_B);
    expect(await currentOnly.open("t-1", "paymob", next)).toEqual(SECRETS);
    await expect(currentOnly.open("t-2", "paymob", next)).rejects.toThrow(OPEN_FAILED);
  });

  it("upgrades a legacy v1 row (kekRef dropped) even under the current key", async () => {
    const vault = vaultWith(KEK_A);
    const next = await vault.reseal(await legacyV1Row(KEK_A));
    expect(JSON.parse(next)).toEqual(expect.objectContaining({ v: 2 }));
    expect(next).not.toContain("kekRef");
    expect(await vault.open("t-1", "paymob", next)).toEqual(SECRETS);
  });

  it("refuses, generically, a row no trusted key opens or one under a foreign alias", async () => {
    const vault = vaultWith(KEK_A);
    await expect(vault.reseal(await legacyV1Row(KEK_ATTACKER))).rejects.toThrow(OPEN_FAILED);
    const stored = JSON.parse(await vault.seal("t-1", "paymob", SECRETS)) as object;
    await expect(
      vault.reseal(JSON.stringify({ ...stored, alias: "shipping-credentials" })),
    ).rejects.toThrow(OPEN_FAILED);
    await expect(vault.reseal("not json")).rejects.toThrow(OPEN_FAILED);
  });
});
