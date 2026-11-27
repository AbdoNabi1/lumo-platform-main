import { beforeEach, describe, expect, it } from "vitest";
import { testCarrierVault } from "../testing/carrier-doubles";
import { EnvelopeCipher, KeyAliasRegistry } from "@platform/secrets";
import { LocalKeyWrapCipher } from "@platform/secrets/testing";
import {
  EnvelopeCarrierCredentialVault,
  InMemoryCarrierCredentialVault,
  SHIPPING_CREDENTIALS_KEY_ALIAS,
} from "./envelope-carrier-credential-vault";

beforeEach(() => {
  expect.hasAssertions();
});

describe("EnvelopeCarrierCredentialVault (spec §6)", () => {
  it("round-trips for the same tenant and carrier; the envelope holds no plaintext", async () => {
    const vault = testCarrierVault();
    const sealed = await vault.seal("t-1", "bosta", { apiKey: "bosta-live-key-123" });
    expect(sealed).not.toContain("bosta-live-key-123");
    expect(await vault.open("t-1", "bosta", sealed)).toEqual({ apiKey: "bosta-live-key-123" });
  });

  it("an envelope copied to another tenant or carrier fails to open, naming nothing", async () => {
    const vault = testCarrierVault();
    const sealed = await vault.seal("t-1", "bosta", { apiKey: "k" });
    await expect(vault.open("t-2", "bosta", sealed)).rejects.toThrow(
      /^Carrier credentials could not be opened$/,
    );
    await expect(vault.open("t-1", "bosta:webhook", sealed)).rejects.toThrow(/could not be opened/);
  });

  it("an envelope sealed for carrier X does not open as carrier Y, even for the same tenant", async () => {
    const vault = testCarrierVault();
    const sealed = await vault.seal("t-1", "aramex", { apiKey: "aramex-secret-value" });
    const failure = await vault.open("t-1", "bosta", sealed).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toBe("Carrier credentials could not be opened");
    expect(failure?.message).not.toContain("aramex-secret-value");
  });

  it("garbage, tampered or foreign-KEK envelopes fail with the same message and no echo", async () => {
    const vault = testCarrierVault();
    const sealed = await vault.seal("t-1", "bosta", { apiKey: "k-secret" });
    const envelope = JSON.parse(sealed) as Record<string, unknown>;
    const tampered = JSON.stringify({ ...envelope, ciphertext: "AAAA:BBBB:CCCC" });

    for (const bad of ["not json", "{}", tampered]) {
      await expect(vault.open("t-1", "bosta", bad)).rejects.toThrow(
        /^Carrier credentials could not be opened$/,
      );
    }
  });

  it("a stored kekRef is never used: the key comes from the vault's own registry (O15)", async () => {
    const vault = testCarrierVault();
    const sealed = await vault.seal("t-1", "bosta", { apiKey: "k-secret" });
    const envelope = JSON.parse(sealed) as Record<string, unknown>;
    expect(envelope).not.toHaveProperty("kekRef");
    const withHostileRef = JSON.stringify({ ...envelope, kekRef: "another-kek" });
    expect(await vault.open("t-1", "bosta", withHostileRef)).toEqual({ apiKey: "k-secret" });
  });

  it("the webhook secret is sealed under its own carrier key and opens only there", async () => {
    const vault = testCarrierVault();
    const sealed = await vault.seal("t-1", "bosta:webhook", { secret: "whsec" });
    expect(await vault.open("t-1", "bosta:webhook", sealed)).toEqual({ secret: "whsec" });
    await expect(vault.open("t-1", "bosta", sealed)).rejects.toThrow(/could not be opened/);
  });

  it("is a real backing", () => {
    expect(testCarrierVault().backing).toBe("real");
  });
});

describe("InMemoryCarrierCredentialVault (offline stand-in)", () => {
  it("reports itself as a stub, so the boot guard can refuse it outside local", () => {
    expect(new InMemoryCarrierCredentialVault().backing).toBe("stub");
  });

  it("round-trips and still re-checks tenant and carrier", async () => {
    const vault = new InMemoryCarrierCredentialVault();
    const sealed = await vault.seal("t-1", "bosta", { apiKey: "k1" });
    expect(await vault.open("t-1", "bosta", sealed)).toEqual({ apiKey: "k1" });
    await expect(vault.open("t-2", "bosta", sealed)).rejects.toThrow(
      /^Carrier credentials could not be opened$/,
    );
    await expect(vault.open("t-1", "aramex", sealed)).rejects.toThrow(
      /^Carrier credentials could not be opened$/,
    );
    await expect(vault.open("t-1", "bosta", "stub:@@@")).rejects.toThrow(
      /^Carrier credentials could not be opened$/,
    );
  });
});

const KEK_A = "kek-test-aaaa";
const KEK_B = "kek-test-bbbb";
const KEK_ATTACKER = "kek-test-attacker";
const OPEN_FAILED = /^Carrier credentials could not be opened$/;

/** A vault whose registry history is the given refs, oldest first (the last is current). */
function vaultWith(...refsOldestFirst: string[]): EnvelopeCarrierCredentialVault {
  const aliases = new KeyAliasRegistry();
  for (const ref of refsOldestFirst) aliases.set(SHIPPING_CREDENTIALS_KEY_ALIAS, ref);
  return new EnvelopeCarrierCredentialVault(
    new EnvelopeCipher(new LocalKeyWrapCipher(), aliases),
    SHIPPING_CREDENTIALS_KEY_ALIAS,
  );
}

/** A row exactly as v1 stored it: the key reference sat next to the ciphertext. */
async function legacyV1Row(kekRef: string): Promise<string> {
  const cipher = new LocalKeyWrapCipher();
  const dek = await cipher.randomToken(32);
  const payload = JSON.stringify({ v: 1, t: "t-1", c: "bosta", s: { apiKey: "bosta-key-1" } });
  return JSON.stringify({
    v: 1,
    alias: SHIPPING_CREDENTIALS_KEY_ALIAS,
    kekRef,
    wrappedDek: await cipher.wrapKey(dek, kekRef),
    ciphertext: await cipher.encrypt(payload, dek),
  });
}

describe("EnvelopeCarrierCredentialVault (O15: no key reference in storage)", () => {
  it("persists exactly {v:2, alias, wrappedDek, ciphertext}: no kekRef and no key in the blob", async () => {
    const sealed = await vaultWith(KEK_A).seal("t-1", "bosta", { apiKey: "bosta-key-1" });
    const stored = JSON.parse(sealed) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["alias", "ciphertext", "v", "wrappedDek"]);
    expect(stored["v"]).toBe(2);
    expect(sealed).not.toContain("kekRef");
    expect(sealed).not.toContain(KEK_A);
  });

  it("opens a legacy v1 row with the vault's own key, never the embedded one", async () => {
    expect(await vaultWith(KEK_A).open("t-1", "bosta", await legacyV1Row(KEK_A))).toEqual({
      apiKey: "bosta-key-1",
    });
    await expect(
      vaultWith(KEK_A).open("t-1", "bosta", await legacyV1Row(KEK_ATTACKER)),
    ).rejects.toThrow(OPEN_FAILED);
  });

  it("a row naming another alias is refused, generically", async () => {
    const vault = vaultWith(KEK_A);
    const stored = JSON.parse(await vault.seal("t-1", "bosta", { apiKey: "k" })) as object;
    const foreign = JSON.stringify({ ...stored, alias: "payments-credentials" });
    await expect(vault.open("t-1", "bosta", foreign)).rejects.toThrow(OPEN_FAILED);
    await expect(vault.reseal(foreign)).rejects.toThrow(OPEN_FAILED);
  });

  it("rotation: the previous key opens old rows; reseal moves them to the current key as v2", async () => {
    const old = await vaultWith(KEK_A).seal("t-1", "bosta", { apiKey: "bosta-key-1" });
    const rotated = vaultWith(KEK_A, KEK_B);
    expect(await rotated.open("t-1", "bosta", old)).toEqual({ apiKey: "bosta-key-1" });

    const next = await rotated.reseal(old);
    expect(next).not.toBe(old);
    expect(await vaultWith(KEK_B).open("t-1", "bosta", next)).toEqual({ apiKey: "bosta-key-1" });
    await expect(vaultWith(KEK_B).open("t-2", "bosta", next)).rejects.toThrow(OPEN_FAILED);
    // Already v2 under the current key: the very same string, nothing to write.
    expect(await rotated.reseal(next)).toBe(next);
  });

  it("reseal upgrades a legacy v1 row, drops its kekRef, and refuses what no trusted key opens", async () => {
    const vault = vaultWith(KEK_A);
    const next = await vault.reseal(await legacyV1Row(KEK_A));
    expect(next).not.toContain("kekRef");
    expect(JSON.parse(next)).toEqual(expect.objectContaining({ v: 2 }));
    expect(await vault.open("t-1", "bosta", next)).toEqual({ apiKey: "bosta-key-1" });
    await expect(vault.reseal(await legacyV1Row(KEK_ATTACKER))).rejects.toThrow(OPEN_FAILED);
    await expect(vault.reseal("not json")).rejects.toThrow(OPEN_FAILED);
  });
});
