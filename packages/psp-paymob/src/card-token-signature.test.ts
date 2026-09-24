import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import tokenFixture from "./__fixtures__/card-token-callback.json";
import transactionFixture from "./__fixtures__/transaction-processed-callback.json";
import {
  PAYMOB_CARD_TOKEN_HMAC_FIELDS,
  concatenateCardTokenFields,
  extractSignedCardToken,
  verifyPaymobCardTokenSignature,
} from "./card-token-signature";
import { concatenateSignedFields, verifyPaymobSignature } from "./webhook-signature";

/**
 * Known-answer vector copied from Paymob's own "HMAC Card Token Callback" page
 * (developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-for-card-tokens,
 * read 2026-09-24): the sample callback (`__fixtures__/card-token-callback.json`) and the
 * concatenation the page prints for it. Typed out literally so the FIELD ORDER is pinned against
 * Paymob's published example, not against our own reading of it. (The page masks its HMAC secret, so
 * the digest cannot be pinned to a published value; ours is computed independently with node:crypto.)
 */
const DOC_CONCATENATED_STRING =
  "MasterCard2026-08-24T13:28:31.015314kiyedi3052@claspira.com15978654xxxx-xxxx-xxxx-234610539285938815813f22ce8a4e77125c70f0bc69830e34c36df469351e2fa6be76428be4";

const SECRET = "test-hmac-secret-not-a-real-credential";
const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const hmacOf = (input: string, secret = SECRET): string =>
  createHmac("sha512", secret).update(input).digest("hex");

type Json = Record<string, unknown>;
const clone = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

describe("Paymob card-token callback signature", () => {
  it("lists exactly the 8 signed fields, in lexicographical order", () => {
    expect(PAYMOB_CARD_TOKEN_HMAC_FIELDS).toEqual([
      "card_subtype",
      "created_at",
      "email",
      "id",
      "masked_pan",
      "merchant_id",
      "order_id",
      "token",
    ]);
    expect([...PAYMOB_CARD_TOKEN_HMAC_FIELDS]).toEqual([...PAYMOB_CARD_TOKEN_HMAC_FIELDS].sort());
  });

  it("reproduces the concatenation printed in Paymob's own worked example", () => {
    expect(concatenateCardTokenFields(tokenFixture.obj)).toBe(DOC_CONCATENATED_STRING);
  });

  it("accepts the doc's sample callback signed with HMAC-SHA512 over that string", () => {
    expect(
      verifyPaymobCardTokenSignature({
        payload: bytes(tokenFixture),
        signature: hmacOf(DOC_CONCATENATED_STRING),
        secret: SECRET,
      }),
    ).toBe(true);
    expect(
      verifyPaymobCardTokenSignature({
        payload: bytes(tokenFixture),
        signature: hmacOf(DOC_CONCATENATED_STRING).toUpperCase(),
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("rejects a callback whose card token was swapped after signing (fails closed)", () => {
    const tampered = clone(tokenFixture);
    (tampered["obj"] as Json)["token"] = "attacker-supplied-token";
    expect(
      verifyPaymobCardTokenSignature({
        payload: bytes(tampered),
        signature: hmacOf(DOC_CONCATENATED_STRING),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it.each([...PAYMOB_CARD_TOKEN_HMAC_FIELDS])(
    "rejects a callback missing the signed field %s (fails closed)",
    (field) => {
      const missing = clone(tokenFixture);
      delete (missing["obj"] as Json)[field];
      expect(
        verifyPaymobCardTokenSignature({
          payload: bytes(missing),
          signature: hmacOf(DOC_CONCATENATED_STRING),
          secret: SECRET,
        }),
      ).toBe(false);
      expect(extractSignedCardToken(bytes(missing))).toBeNull();
    },
  );

  it("does not treat a null signed field as an empty string", () => {
    const nulled = clone(tokenFixture);
    (nulled["obj"] as Json)["email"] = null;
    expect(
      verifyPaymobCardTokenSignature({
        payload: bytes(nulled),
        signature: hmacOf(concatenateCardTokenFields(tokenFixture.obj) ?? ""),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects the wrong secret, an empty secret, a malformed hmac and a non-JSON body", () => {
    const good = hmacOf(DOC_CONCATENATED_STRING);
    const base = { payload: bytes(tokenFixture), signature: good, secret: SECRET };
    expect(verifyPaymobCardTokenSignature({ ...base, secret: "another-secret" })).toBe(false);
    expect(verifyPaymobCardTokenSignature({ ...base, secret: "" })).toBe(false);
    expect(verifyPaymobCardTokenSignature({ ...base, signature: good.slice(2) })).toBe(false);
    expect(verifyPaymobCardTokenSignature({ ...base, signature: `zz${good.slice(2)}` })).toBe(
      false,
    );
    expect(
      verifyPaymobCardTokenSignature({ ...base, payload: new TextEncoder().encode("not json") }),
    ).toBe(false);
  });

  it("refuses a body that is not typed as a TOKEN callback", () => {
    const wrongType = { ...clone(tokenFixture), type: "TRANSACTION" };
    expect(
      verifyPaymobCardTokenSignature({
        payload: bytes(wrongType),
        signature: hmacOf(DOC_CONCATENATED_STRING),
        secret: SECRET,
      }),
    ).toBe(false);
    expect(extractSignedCardToken(bytes(wrongType))).toBeNull();
  });

  it("extracts only signed values: the token, its order id and the card's display fields", () => {
    expect(extractSignedCardToken(bytes(tokenFixture))).toEqual({
      tokenId: "15978654",
      token: "3f22ce8a4e77125c70f0bc69830e34c36df469351e2fa6be76428be4",
      orderId: "593881581",
      maskedPan: "xxxx-xxxx-xxxx-2346",
      cardSubtype: "MasterCard",
    });
  });
});

/**
 * TRAP 1: same provider, same secret, TWO signing schemes. A body carrying the fields of BOTH
 * callbacks is signed under one scheme; the other scheme's verifier must reject it. (A plain token
 * body would be rejected by the transaction verifier merely for lacking its fields — the hybrid body
 * is what proves the schemes themselves differ, not just the payloads.)
 */
describe("the two Paymob signing schemes reject each other's signatures", () => {
  const hybrid = (): Json => {
    const transaction = clone(transactionFixture);
    const token = clone(tokenFixture);
    return {
      type: "TOKEN",
      obj: { ...(transaction["obj"] as Json), ...(token["obj"] as Json) },
    };
  };
  const hybridObj = hybrid()["obj"] as Json;

  // The hybrid's `id` collides (transaction id vs token id): the token's wins, and both schemes read
  // it as the object's own `id`, so the two concatenations are still different strings.
  const transactionScheme = hmacOf(concatenateSignedFields(hybridObj) ?? "");
  const tokenScheme = hmacOf(concatenateCardTokenFields(hybridObj) ?? "");

  it("the two schemes produce different signatures over the same body", () => {
    expect(transactionScheme).not.toBe(tokenScheme);
  });

  it("the token verifier accepts a token-scheme signature and rejects a transaction-scheme one", () => {
    const payload = bytes(hybrid());
    expect(
      verifyPaymobCardTokenSignature({ payload, signature: tokenScheme, secret: SECRET }),
    ).toBe(true);
    expect(
      verifyPaymobCardTokenSignature({ payload, signature: transactionScheme, secret: SECRET }),
    ).toBe(false);
  });

  it("the transaction verifier accepts a transaction-scheme signature and rejects a token-scheme one", () => {
    const payload = bytes(hybrid());
    expect(verifyPaymobSignature({ payload, signature: transactionScheme, secret: SECRET })).toBe(
      true,
    );
    expect(verifyPaymobSignature({ payload, signature: tokenScheme, secret: SECRET })).toBe(false);
  });
});
