import { EnvelopeCipher, KeyAliasRegistry } from "@platform/secrets";
import { LocalKeyWrapCipher } from "@platform/secrets/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_EMAIL_KEK, testEmailVault } from "../testing/email-connection-doubles";
import {
  EMAIL_CREDENTIALS_KEY_ALIAS,
  InMemoryEmailConnectionVault,
} from "./envelope-email-connection-vault";

const API_KEY = "re_live_AbCdEfGhIjKlMnOpQrStUv";
const OPEN_FAILED = /^Email credentials could not be opened$/;

beforeEach(() => {
  expect.hasAssertions();
});

describe("EnvelopeEmailConnectionVault (D48)", () => {
  it("round-trips for the same tenant and kind; the stored blob holds no plaintext", async () => {
    const vault = testEmailVault();
    const sealed = await vault.seal("t-1", "resend", { apiKey: API_KEY });
    expect(sealed).not.toContain(API_KEY);
    expect(await vault.open("t-1", "resend", sealed)).toEqual({ apiKey: API_KEY });
  });

  it("stores {v, alias, wrappedDek, ciphertext} ONLY: never a key reference", async () => {
    const vault = testEmailVault();
    const sealed = await vault.seal("t-1", "resend", { apiKey: API_KEY });
    const stored = JSON.parse(sealed) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["alias", "ciphertext", "v", "wrappedDek"]);
    expect(stored["alias"]).toBe(EMAIL_CREDENTIALS_KEY_ALIAS);
    expect(sealed).not.toContain("kekRef");
    expect(sealed).not.toContain(TEST_EMAIL_KEK);
  });

  it("a blob copied to another tenant or kind opens as nothing, naming nothing", async () => {
    const vault = testEmailVault();
    const sealed = await vault.seal("t-1", "resend", { apiKey: API_KEY });
    await expect(vault.open("t-2", "resend", sealed)).rejects.toThrow(OPEN_FAILED);
    await expect(vault.open("t-1", "sendgrid" as unknown as "resend", sealed)).rejects.toThrow(
      OPEN_FAILED,
    );
  });

  it("garbage, a tampered ciphertext, a row WITH a kekRef and an unknown alias all fail the same way", async () => {
    const vault = testEmailVault();
    const sealed = await vault.seal("t-1", "resend", { apiKey: API_KEY });
    const stored = JSON.parse(sealed) as Record<string, unknown>;
    const bad = [
      "not json",
      "{}",
      "[]",
      "null",
      JSON.stringify({ ...stored, ciphertext: "AAAA:BBBB:CCCC" }),
      JSON.stringify({ ...stored, kekRef: TEST_EMAIL_KEK }),
      JSON.stringify({ ...stored, kekRef: null }),
      JSON.stringify({ ...stored, alias: "payments-credentials" }),
      JSON.stringify({ ...stored, v: 2 }),
      JSON.stringify({ ...stored, v: "1" }),
    ];
    for (const row of bad) {
      const failure = await vault.open("t-1", "resend", row).then(
        () => null,
        (error: unknown) => error as Error,
      );
      expect(failure?.message).toMatch(OPEN_FAILED);
      expect(failure?.message).not.toContain(API_KEY);
    }
  });

  it("a different key encryption key cannot open it (rotation without the old key strands the row)", async () => {
    const sealed = await testEmailVault().seal("t-1", "resend", { apiKey: API_KEY });
    const other = testEmailVault("another-kek-not-the-same-0000000000");
    await expect(other.open("t-1", "resend", sealed)).rejects.toThrow(OPEN_FAILED);
  });

  it("a decrypted null or non-object payload is the same generic error", async () => {
    const aliases = new KeyAliasRegistry();
    aliases.set(EMAIL_CREDENTIALS_KEY_ALIAS, TEST_EMAIL_KEK);
    const cipher = new EnvelopeCipher(new LocalKeyWrapCipher(), aliases);
    const vault = testEmailVault();
    for (const payload of ["null", "7", '"x"', "[]", '{"v":1}']) {
      const envelope = await cipher.seal(payload, EMAIL_CREDENTIALS_KEY_ALIAS);
      const stored = JSON.stringify({
        v: envelope.v,
        alias: envelope.alias,
        wrappedDek: envelope.wrappedDek,
        ciphertext: envelope.ciphertext,
      });
      await expect(vault.open("t-1", "resend", stored)).rejects.toThrow(OPEN_FAILED);
    }
  });

  it("is a real backing; the in-memory twin is a stub that keeps the tenant and kind checks", async () => {
    expect(testEmailVault().backing).toBe("real");
    const stub = new InMemoryEmailConnectionVault();
    expect(stub.backing).toBe("stub");
    const sealed = await stub.seal("t-1", "resend", { apiKey: API_KEY });
    expect(await stub.open("t-1", "resend", sealed)).toEqual({ apiKey: API_KEY });
    await expect(stub.open("t-2", "resend", sealed)).rejects.toThrow(OPEN_FAILED);
    await expect(stub.open("t-1", "resend", "garbage")).rejects.toThrow(OPEN_FAILED);
  });
});
