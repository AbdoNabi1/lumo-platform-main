import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import callbackFixture from "./__fixtures__/transaction-processed-callback.json";
import {
  PAYMOB_HMAC_FIELDS,
  concatenateSignedFields,
  extractSignedTransaction,
  verifyPaymobSignature,
} from "./webhook-signature";

/**
 * Known-answer vector: the sample transaction-processed callback and the resulting concatenated
 * string are copied from Paymob's own "HMAC Transaction Callback" page (developers.paymob.com,
 * `webhook-callbacks-and-hmac/hmac/hmac-transaction-callback`, last updated 2026-06-01). The
 * expected string below is typed out literally here — never produced by the code under test — so
 * this pins the field ORDER and value formatting against Paymob's published example, not against
 * our own reading of it. (The page masks its sample HMAC secret, so the digest itself cannot be
 * pinned to a published value; the digest below is computed independently with `node:crypto`.)
 */
const DOC_CONCATENATED_STRING =
  "1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue";

const SECRET = "test-hmac-secret-not-a-real-credential";
const payload = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const hmacOf = (input: string, secret = SECRET): string =>
  createHmac("sha512", secret).update(input).digest("hex");

type Json = Record<string, unknown>;

describe("Paymob webhook signature (transaction processed callback)", () => {
  it("lists exactly the 20 signed fields, in Paymob's published order", () => {
    expect(PAYMOB_HMAC_FIELDS).toEqual([
      "amount_cents",
      "created_at",
      "currency",
      "error_occured",
      "has_parent_transaction",
      "obj.id",
      "integration_id",
      "is_3d_secure",
      "is_auth",
      "is_capture",
      "is_refunded",
      "is_standalone_payment",
      "is_voided",
      "order.id",
      "owner",
      "pending",
      "source_data.pan",
      "source_data.sub_type",
      "source_data.type",
      "success",
    ]);
  });

  it("reproduces the concatenated string printed in Paymob's own worked example", () => {
    expect(concatenateSignedFields(callbackFixture.obj)).toBe(DOC_CONCATENATED_STRING);
  });

  it("accepts the doc's sample callback signed with HMAC-SHA512 over that string", () => {
    expect(
      verifyPaymobSignature({
        payload: payload(callbackFixture),
        signature: hmacOf(DOC_CONCATENATED_STRING),
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("is not Stripe's scheme: neither a Stripe-shaped HMAC nor an HMAC over the raw body verifies", () => {
    const body = JSON.stringify(callbackFixture);
    const stripeShaped = createHmac("sha256", SECRET).update(`1.${body}`).digest("hex");
    const sha512OverBody = createHmac("sha512", SECRET).update(body).digest("hex");
    for (const signature of [stripeShaped, sha512OverBody]) {
      expect(
        verifyPaymobSignature({
          payload: new TextEncoder().encode(body),
          signature,
          secret: SECRET,
        }),
      ).toBe(false);
    }
  });

  it("rejects a wrong secret", () => {
    expect(
      verifyPaymobSignature({
        payload: payload(callbackFixture),
        signature: hmacOf(DOC_CONCATENATED_STRING, "some-other-merchant-secret"),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it.each(PAYMOB_HMAC_FIELDS.map((path) => [path]))(
    "rejects a callback whose signed field %s was altered after signing",
    (path) => {
      const signature = hmacOf(DOC_CONCATENATED_STRING);
      const tampered = structuredClone(callbackFixture) as unknown as Json;
      // Signed paths are relative to `obj`, except `obj.id` and `order.id` which the spec spells
      // from the envelope / the nested order — resolve them to the leaf's holder.
      const holderPath = path === "obj.id" ? [] : path.split(".").slice(0, -1);
      let holder = tampered.obj as Json;
      for (const segment of holderPath) holder = holder[segment] as Json;
      const leaf = path.split(".").at(-1) as string;
      const original = holder[leaf];
      holder[leaf] =
        typeof original === "boolean"
          ? !original
          : typeof original === "number"
            ? original + 1
            : `${String(original)}x`;
      expect(verifyPaymobSignature({ payload: payload(tampered), signature, secret: SECRET })).toBe(
        false,
      );
    },
  );

  it("does not cover merchant_order_id — which is why callers must correlate on signed fields only", () => {
    const signature = hmacOf(DOC_CONCATENATED_STRING);
    const edited = structuredClone(callbackFixture) as unknown as { obj: { order: Json } };
    edited.obj.order.merchant_order_id = "another-tenants-order";
    expect(verifyPaymobSignature({ payload: payload(edited), signature, secret: SECRET })).toBe(
      true,
    );
    expect(JSON.stringify(extractSignedTransaction(payload(edited)))).not.toContain(
      "another-tenants-order",
    );
  });

  it("fails closed when a signed field is missing or null (never guesses how Paymob renders it)", () => {
    const signature = hmacOf(DOC_CONCATENATED_STRING);
    const broken = structuredClone(callbackFixture) as unknown as { obj: { source_data: Json } };
    delete broken.obj.source_data.pan;
    expect(verifyPaymobSignature({ payload: payload(broken), signature, secret: SECRET })).toBe(
      false,
    );
    broken.obj.source_data.pan = null;
    expect(verifyPaymobSignature({ payload: payload(broken), signature, secret: SECRET })).toBe(
      false,
    );
  });

  it("rejects malformed input without throwing", () => {
    const signature = hmacOf(DOC_CONCATENATED_STRING);
    for (const bad of ["", "not json", "[]", "null", '{"obj":1}']) {
      expect(
        verifyPaymobSignature({
          payload: new TextEncoder().encode(bad),
          signature,
          secret: SECRET,
        }),
      ).toBe(false);
    }
    for (const badSig of ["", "zz", "abc", signature.slice(2), `${signature}00`]) {
      expect(
        verifyPaymobSignature({
          payload: payload(callbackFixture),
          signature: badSig,
          secret: SECRET,
        }),
      ).toBe(false);
    }
    expect(
      verifyPaymobSignature({ payload: payload(callbackFixture), signature, secret: "" }),
    ).toBe(false);
  });

  it("accepts an upper-case hex signature (hex is case-insensitive)", () => {
    expect(
      verifyPaymobSignature({
        payload: payload(callbackFixture),
        signature: hmacOf(DOC_CONCATENATED_STRING).toUpperCase(),
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("extracts only the signed values, typed, from the raw bytes", () => {
    expect(extractSignedTransaction(payload(callbackFixture))).toEqual({
      transactionId: "192036465",
      orderId: "217503754",
      amountCents: 100000,
      currency: "EGP",
      success: true,
      pending: false,
      isAuth: false,
      isCapture: false,
      isVoided: false,
      isRefunded: false,
      hasParentTransaction: false,
      errorOccured: false,
    });
    expect(extractSignedTransaction(new TextEncoder().encode("nope"))).toBeNull();
  });
});
