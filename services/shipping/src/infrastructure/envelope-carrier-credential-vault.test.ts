import { beforeEach, describe, expect, it } from "vitest";
import { testCarrierVault } from "../testing/carrier-doubles";
import { InMemoryCarrierCredentialVault } from "./envelope-carrier-credential-vault";

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
