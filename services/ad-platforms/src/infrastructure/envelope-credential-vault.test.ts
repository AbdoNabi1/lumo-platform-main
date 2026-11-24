import { EnvelopeCipher, KeyAliasRegistry, type KeyWrapCipher } from "@platform/secrets";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_KEK_ALIAS, testEnvelopeVault } from "../testing/local-key-wrap-cipher";
import { EnvelopeCredentialVault } from "./envelope-credential-vault";

beforeEach(() => {
  expect.hasAssertions();
});

const SECRET = "EAAB1234567890abcdSECRETTOKEN";
const GENERIC_OPEN = "Ad platform credentials could not be opened";

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a rejection");
}

describe("EnvelopeCredentialVault", () => {
  it("reports a real backing", () => {
    expect(testEnvelopeVault().backing).toBe("real");
  });

  it("seals and opens a secret for the same tenant and platform", async () => {
    const vault = testEnvelopeVault();
    const sealed = await vault.seal("t-1", "meta", SECRET);
    expect(await vault.open("t-1", "meta", sealed)).toBe(SECRET);
  });

  it("stores a self-describing envelope that does not contain the plaintext", async () => {
    const sealed = await testEnvelopeVault().seal("t-1", "meta", SECRET);
    expect(sealed).not.toContain(SECRET);
    expect(sealed).not.toContain("t-1");
    const envelope = JSON.parse(sealed) as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual([
      "alias",
      "ciphertext",
      "kekRef",
      "v",
      "wrappedDek",
    ]);
    expect(envelope["alias"]).toBe(TEST_KEK_ALIAS);
    expect(envelope["v"]).toBe(1);
  });

  it("uses a fresh data key per seal (the same secret never seals to the same string)", async () => {
    const vault = testEnvelopeVault();
    expect(await vault.seal("t-1", "meta", SECRET)).not.toBe(
      await vault.seal("t-1", "meta", SECRET),
    );
  });

  it("refuses to open another tenant's envelope with the generic message", async () => {
    const vault = testEnvelopeVault();
    const sealed = await vault.seal("t-1", "meta", SECRET);
    const message = await messageOf(vault.open("t-2", "meta", sealed));
    expect(message).toBe(GENERIC_OPEN);
    expect(message).not.toContain(SECRET);
  });

  it("refuses to open the envelope for another platform with the generic message", async () => {
    const vault = testEnvelopeVault();
    const sealed = await vault.seal("t-1", "meta", SECRET);
    const message = await messageOf(vault.open("t-1", "tiktok", sealed));
    expect(message).toBe(GENERIC_OPEN);
    expect(message).not.toContain(SECRET);
  });

  it("refuses garbage and a tampered ciphertext, generically", async () => {
    const vault = testEnvelopeVault();
    const sealed = JSON.parse(await vault.seal("t-1", "meta", SECRET)) as { ciphertext: string };
    const [iv = "", , body = ""] = sealed.ciphertext.split(":");
    const wrongTag = Buffer.alloc(16).toString("base64");
    const tampered = JSON.stringify({ ...sealed, ciphertext: `${iv}:${wrongTag}:${body}` });
    for (const bad of ["not json", "{}", tampered, "stub:abc"]) {
      expect(await messageOf(vault.open("t-1", "meta", bad))).toBe(GENERIC_OPEN);
    }
  });

  it("opens an envelope sealed before a KEK rotation (the envelope embeds the KEK ref it was sealed under)", async () => {
    const old = await testEnvelopeVault("old-kek-ref-0123456789-0123456789-abcdef").seal(
      "t-1",
      "meta",
      SECRET,
    );
    expect(await testEnvelopeVault().open("t-1", "meta", old)).toBe(SECRET);
  });

  it("refuses a payload that decrypts but is not the sealed shape, without echoing it", async () => {
    const aliases = new KeyAliasRegistry();
    aliases.set(TEST_KEK_ALIAS, "x".repeat(40));
    const plain: KeyWrapCipher = {
      encrypt: (text) => Promise.resolve(text),
      decrypt: (text) => Promise.resolve(text),
      wrapKey: (text) => Promise.resolve(text),
      unwrapKey: (text) => Promise.resolve(text),
      randomToken: () => Promise.resolve("dek"),
    };
    const vault = new EnvelopeCredentialVault(new EnvelopeCipher(plain, aliases), TEST_KEK_ALIAS);
    const wrongVersion = JSON.stringify({
      v: 1,
      alias: TEST_KEK_ALIAS,
      kekRef: "x",
      wrappedDek: "dek",
      ciphertext: JSON.stringify({ v: 2, t: "t-1", p: "meta", s: SECRET }),
    });
    const notString = JSON.stringify({
      v: 1,
      alias: TEST_KEK_ALIAS,
      kekRef: "x",
      wrappedDek: "dek",
      ciphertext: JSON.stringify({ v: 1, t: "t-1", p: "meta", s: 42 }),
    });
    for (const bad of [wrongVersion, notString]) {
      const message = await messageOf(vault.open("t-1", "meta", bad));
      expect(message).toBe(GENERIC_OPEN);
      expect(message).not.toContain(SECRET);
    }
  });

  it("turns a cipher failure while sealing into a generic error with no cause and no payload", async () => {
    const aliases = new KeyAliasRegistry();
    aliases.set(TEST_KEK_ALIAS, "x".repeat(40));
    const failing: KeyWrapCipher = {
      encrypt: () => Promise.reject(new Error(`backend rejected ${SECRET}`)),
      decrypt: () => Promise.reject(new Error("no")),
      wrapKey: () => Promise.reject(new Error("no")),
      unwrapKey: () => Promise.reject(new Error("no")),
      randomToken: () => Promise.resolve("dek"),
    };
    const vault = new EnvelopeCredentialVault(new EnvelopeCipher(failing, aliases), TEST_KEK_ALIAS);
    let caught: unknown;
    try {
      await vault.seal("t-1", "meta", SECRET);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Ad platform credentials could not be sealed");
    expect((caught as Error).message).not.toContain(SECRET);
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it("an unknown alias fails sealing generically (fail closed)", async () => {
    const vault = new EnvelopeCredentialVault(
      new EnvelopeCipher(
        {
          encrypt: () => Promise.resolve(""),
          decrypt: () => Promise.resolve(""),
          wrapKey: () => Promise.resolve(""),
          unwrapKey: () => Promise.resolve(""),
          randomToken: () => Promise.resolve(""),
        },
        new KeyAliasRegistry(),
      ),
      "missing-alias",
    );
    expect(await messageOf(vault.seal("t-1", "meta", SECRET))).toBe(
      "Ad platform credentials could not be sealed",
    );
  });
});
