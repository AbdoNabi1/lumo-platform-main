import { EnvelopeCipher, KeyAliasRegistry, type KeyWrapCipher } from "@platform/secrets";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_KEK_ALIAS, TEST_KEK_REF, testEnvelopeVault } from "../testing/local-key-wrap-cipher";
import { EnvelopeCredentialVault } from "./envelope-credential-vault";

beforeEach(() => {
  expect.hasAssertions();
});

const SECRET = "EAAB1234567890abcdSECRETTOKEN";
const GENERIC_OPEN = "Ad platform credentials could not be opened";

async function failureOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("expected an Error rejection");
  }
  throw new Error("expected a rejection");
}

/** Asserts the exact generic opening error: fixed message, no cause, no plaintext. */
async function expectGenericOpenFailure(promise: Promise<unknown>): Promise<void> {
  const error = await failureOf(promise);
  expect(error.message).toBe(GENERIC_OPEN);
  expect(error.message).not.toContain(SECRET);
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
}

type Stored = Record<string, unknown>;

/** A vault whose "crypto" is the identity, so tests can hand-craft what "decrypts". */
function plainVault(): EnvelopeCredentialVault {
  const aliases = new KeyAliasRegistry();
  aliases.set(TEST_KEK_ALIAS, "x".repeat(40));
  const plain: KeyWrapCipher = {
    encrypt: (text) => Promise.resolve(text),
    decrypt: (text) => Promise.resolve(text),
    wrapKey: (text) => Promise.resolve(text),
    unwrapKey: (text) => Promise.resolve(text),
    randomToken: () => Promise.resolve("dek"),
  };
  return new EnvelopeCredentialVault(new EnvelopeCipher(plain, aliases), TEST_KEK_ALIAS);
}

function plainRow(ciphertext: string): string {
  return JSON.stringify({ v: 2, alias: TEST_KEK_ALIAS, wrappedDek: "dek", ciphertext });
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

  it("stores exactly {v: 2, alias, wrappedDek, ciphertext}: no key reference, no plaintext", async () => {
    const sealed = await testEnvelopeVault().seal("t-1", "meta", SECRET);
    expect(sealed).not.toContain(SECRET);
    expect(sealed).not.toContain("t-1");
    expect(sealed).not.toContain(TEST_KEK_REF);
    expect(sealed).not.toContain("kekRef");
    const envelope = JSON.parse(sealed) as Stored;
    expect(Object.keys(envelope).sort()).toEqual(["alias", "ciphertext", "v", "wrappedDek"]);
    expect(Object.hasOwn(envelope, "kekRef")).toBe(false);
    expect(envelope["alias"]).toBe(TEST_KEK_ALIAS);
    expect(envelope["v"]).toBe(2);
  });

  it("uses a fresh data key per seal (the same secret never seals to the same string)", async () => {
    const vault = testEnvelopeVault();
    expect(await vault.seal("t-1", "meta", SECRET)).not.toBe(
      await vault.seal("t-1", "meta", SECRET),
    );
  });

  it("refuses another tenant's copied envelope with the generic error", async () => {
    const vault = testEnvelopeVault();
    const sealed = await vault.seal("t-1", "meta", SECRET);
    await expectGenericOpenFailure(vault.open("t-2", "meta", sealed));
  });

  it("refuses the copied envelope for another platform with the generic error", async () => {
    const vault = testEnvelopeVault();
    const sealed = await vault.seal("t-1", "meta", SECRET);
    await expectGenericOpenFailure(vault.open("t-1", "tiktok", sealed));
  });

  it("refuses garbage and a tampered ciphertext, generically", async () => {
    const vault = testEnvelopeVault();
    const sealed = JSON.parse(await vault.seal("t-1", "meta", SECRET)) as { ciphertext: string };
    const [iv = "", , body = ""] = sealed.ciphertext.split(":");
    const wrongTag = Buffer.alloc(16).toString("base64");
    const tampered = JSON.stringify({ ...sealed, ciphertext: `${iv}:${wrongTag}:${body}` });
    for (const bad of ["not json", "{}", tampered, "stub:abc"]) {
      await expectGenericOpenFailure(vault.open("t-1", "meta", bad));
    }
  });

  it("never uses a key reference carried by a stored row: it is dropped and the trusted key opens", async () => {
    const vault = testEnvelopeVault();
    const row = JSON.parse(await vault.seal("t-1", "meta", SECRET)) as Stored;
    for (const kekRef of ["attacker-chosen-key-reference", null, TEST_KEK_REF]) {
      expect(await vault.open("t-1", "meta", JSON.stringify({ ...row, kekRef }))).toBe(SECRET);
    }
    // A row sealed under a different key does not open just because it names the right ref.
    const other = JSON.parse(
      await testEnvelopeVault("another-test-kek-0123456789-0123456789").seal("t-1", "meta", SECRET),
    ) as Stored;
    await expectGenericOpenFailure(
      vault.open("t-1", "meta", JSON.stringify({ ...other, kekRef: TEST_KEK_REF })),
    );
  });

  it("opens a legacy v1 row and re-seals it as a v2 envelope without a key reference", async () => {
    const vault = testEnvelopeVault();
    const row = JSON.parse(await vault.seal("t-1", "meta", SECRET)) as Stored;
    const legacy = JSON.stringify({ ...row, v: 1, kekRef: TEST_KEK_REF });
    expect(await vault.open("t-1", "meta", legacy)).toBe(SECRET);
    const renewed = await vault.reseal(legacy);
    expect(Object.keys(JSON.parse(renewed) as Stored).sort()).toEqual([
      "alias",
      "ciphertext",
      "v",
      "wrappedDek",
    ]);
    expect((JSON.parse(renewed) as Stored)["v"]).toBe(2);
    expect(await vault.open("t-1", "meta", renewed)).toBe(SECRET);
    await expectGenericOpenFailure(vault.open("t-2", "meta", renewed));
  });

  it("keeps opening rows sealed under the previous key during a rotation, and re-seals them", async () => {
    const before = testEnvelopeVault(TEST_KEK_REF);
    const sealed = await before.seal("t-1", "meta", SECRET);
    const after = testEnvelopeVault("rotated-test-kek-0123456789-0123456789", TEST_KEK_REF);
    expect(await after.open("t-1", "meta", sealed)).toBe(SECRET);
    const renewed = await after.reseal(sealed);
    expect(renewed).not.toBe(sealed);
    expect(await after.reseal(renewed)).toBe(renewed);
    const onlyNew = testEnvelopeVault("rotated-test-kek-0123456789-0123456789");
    expect(await onlyNew.open("t-1", "meta", renewed)).toBe(SECRET);
    await expectGenericOpenFailure(onlyNew.open("t-1", "meta", sealed));
  });

  it("refuses an unknown alias", async () => {
    const vault = testEnvelopeVault();
    const row = JSON.parse(await vault.seal("t-1", "meta", SECRET)) as Stored;
    await expectGenericOpenFailure(
      vault.open("t-1", "meta", JSON.stringify({ ...row, alias: "some-other-alias" })),
    );
  });

  it("refuses rows of the wrong shape", async () => {
    const vault = testEnvelopeVault();
    const row = JSON.parse(await vault.seal("t-1", "meta", SECRET)) as Stored;
    const bad: unknown[] = [
      { ...row, v: "1" },
      { ...row, alias: 7 },
      { ...row, wrappedDek: null },
      { ...row, ciphertext: 5 },
      { v: row["v"], alias: row["alias"], wrappedDek: row["wrappedDek"] },
    ];
    for (const value of bad) {
      await expectGenericOpenFailure(vault.open("t-1", "meta", JSON.stringify(value)));
    }
  });

  it("refuses malformed JSON and non-object JSON, generically", async () => {
    const vault = testEnvelopeVault();
    for (const bad of ["{not json", "", "null", "42", '"text"', "true", "[]", "[1,2]"]) {
      await expectGenericOpenFailure(vault.open("t-1", "meta", bad));
    }
  });

  it("refuses a payload that decrypts to JSON null, with the generic error (not a TypeError)", async () => {
    await expectGenericOpenFailure(plainVault().open("t-1", "meta", plainRow("null")));
  });

  it("refuses a payload that decrypts but is not the sealed shape, without echoing it", async () => {
    const vault = plainVault();
    const sealedShape = { v: 1, t: "t-1", p: "meta", s: SECRET };
    expect(await vault.open("t-1", "meta", plainRow(JSON.stringify(sealedShape)))).toBe(SECRET);
    const bad = [
      JSON.stringify({ ...sealedShape, v: 2 }),
      JSON.stringify({ ...sealedShape, s: 42 }),
      JSON.stringify({ ...sealedShape, t: "t-9" }),
      JSON.stringify({ ...sealedShape, p: "tiktok" }),
      JSON.stringify("text"),
      JSON.stringify(7),
      "not json at all",
    ];
    for (const ciphertext of bad) {
      await expectGenericOpenFailure(vault.open("t-1", "meta", plainRow(ciphertext)));
    }
  });

  it("turns a cipher failure while opening into the generic error with no cause", async () => {
    const aliases = new KeyAliasRegistry();
    aliases.set(TEST_KEK_ALIAS, "x".repeat(40));
    const failing: KeyWrapCipher = {
      encrypt: (text) => Promise.resolve(text),
      decrypt: () => Promise.reject(new Error(`backend rejected ${SECRET}`)),
      wrapKey: (text) => Promise.resolve(text),
      unwrapKey: () => Promise.reject(new Error(`backend rejected ${SECRET}`)),
      randomToken: () => Promise.resolve("dek"),
    };
    const vault = new EnvelopeCredentialVault(new EnvelopeCipher(failing, aliases), TEST_KEK_ALIAS);
    await expectGenericOpenFailure(vault.open("t-1", "meta", plainRow("{}")));
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
    const caught = await failureOf(vault.seal("t-1", "meta", SECRET));
    expect(caught.message).toBe("Ad platform credentials could not be sealed");
    expect(caught.message).not.toContain(SECRET);
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
    const caught = await failureOf(vault.seal("t-1", "meta", SECRET));
    expect(caught.message).toBe("Ad platform credentials could not be sealed");
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});
