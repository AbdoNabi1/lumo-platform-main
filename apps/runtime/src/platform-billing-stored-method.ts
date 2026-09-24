import type { StoredMethodBillingDeps } from "@platform/licensing";
import type { PaymentCredentialVault } from "@platform/payments";
import {
  PaymobPaymentProvider,
  extractSignedCardToken,
  verifyPaymobCardTokenSignature,
} from "@platform/psp-paymob";
import type { Logger } from "@platform/utils";
import type { RuntimeConfig } from "./config";

/**
 * The provider key the sealed card token is bound to inside the vault envelope (alongside the payer).
 * Distinct from every merchant-credential key on purpose: a sealed MERCHANT PSP credential copied into
 * a billing row (or the reverse) does not open, because the envelope binds to this key.
 */
const TOKEN_VAULT_KEY = "platform-billing-card-token";

type StoredMethodConfig = Pick<
  RuntimeConfig,
  | "PLATFORM_BILLING_PAYMOB_SECRET_KEY"
  | "PLATFORM_BILLING_PAYMOB_HMAC_SECRET"
  | "PLATFORM_BILLING_PAYMOB_PUBLIC_KEY"
  | "PLATFORM_BILLING_PAYMOB_INTEGRATION_ID"
  | "PLATFORM_BILLING_PAYMOB_MOTO_INTEGRATION_ID"
  | "PLATFORM_BILLING_PAYMOB_REGION"
>;

/**
 * Morbeh's own billing account on Paymob, as Licensing's stored-method billing (G-74 (1)). Reads ONLY
 * the dedicated `PLATFORM_BILLING_PAYMOB_*` group — never a merchant's sealed credentials and never
 * anything the per-tenant resolvers use — so a renewal can never charge a merchant through their own
 * PSP account.
 *
 * All-or-nothing: none of the group set ⇒ `undefined` (stored-method billing simply absent, never a
 * stub); some but not all ⇒ throws naming what is missing; configured but no credential vault ⇒ throws,
 * because the card token would have nowhere real to be sealed.
 */
export function buildPlatformBillingStoredMethod(
  config: StoredMethodConfig,
  vault: PaymentCredentialVault | undefined,
  logger: Logger,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (url, init) =>
    fetch(url, init),
): StoredMethodBillingDeps | undefined {
  const required = {
    PLATFORM_BILLING_PAYMOB_SECRET_KEY: config.PLATFORM_BILLING_PAYMOB_SECRET_KEY,
    PLATFORM_BILLING_PAYMOB_HMAC_SECRET: config.PLATFORM_BILLING_PAYMOB_HMAC_SECRET,
    PLATFORM_BILLING_PAYMOB_PUBLIC_KEY: config.PLATFORM_BILLING_PAYMOB_PUBLIC_KEY,
    PLATFORM_BILLING_PAYMOB_INTEGRATION_ID: config.PLATFORM_BILLING_PAYMOB_INTEGRATION_ID,
  };
  const set = Object.values(required).filter((value) => value !== undefined);
  if (set.length === 0 && config.PLATFORM_BILLING_PAYMOB_MOTO_INTEGRATION_ID === undefined) {
    return undefined;
  }
  const missing = Object.entries(required)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Morbeh's Paymob billing account is half-configured: missing ${missing.join(", ")}. Set the whole group or none of it.`,
    );
  }
  if (vault === undefined) {
    throw new Error(
      "Morbeh's Paymob billing account needs PAYMENT_CREDENTIALS_KEK_REF: the merchant's card token is sealed with the credential vault, and there is no stub to seal it with.",
    );
  }
  const secretKey = required.PLATFORM_BILLING_PAYMOB_SECRET_KEY as string;
  const hmacSecret = required.PLATFORM_BILLING_PAYMOB_HMAC_SECRET as string;
  const integrationId = required.PLATFORM_BILLING_PAYMOB_INTEGRATION_ID as number;
  const motoIntegrationId = config.PLATFORM_BILLING_PAYMOB_MOTO_INTEGRATION_ID;
  if (motoIntegrationId === undefined) {
    logger.warn(
      "Morbeh's Paymob billing has no PLATFORM_BILLING_PAYMOB_MOTO_INTEGRATION_ID: merchants can enrol a card, but every renewal will fail visibly until Paymob enables a MOTO integration and it is set",
    );
  }

  const provider = new PaymobPaymentProvider({
    secretKey,
    hmacSecret,
    publicKey: required.PLATFORM_BILLING_PAYMOB_PUBLIC_KEY as string,
    integrationId,
    ...(motoIntegrationId === undefined ? {} : { motoIntegrationId }),
    region: config.PLATFORM_BILLING_PAYMOB_REGION,
    fetch: async (url, init) => fetchImpl(url, init),
    logger,
  });

  return {
    sealer: {
      backing: vault.backing === "real" ? "real" : "stub",
      seal: (tenantRef, token) => vault.seal(tenantRef, TOKEN_VAULT_KEY, { token }),
      open: async (tenantRef, sealed) => {
        const opened = await vault.open(tenantRef, TOKEN_VAULT_KEY, sealed);
        const token = opened["token"];
        if (token === undefined || token.length === 0) {
          throw new Error("sealed billing payment method holds no token");
        }
        return token;
      },
    },
    // The same class, on Morbeh's account: it implements BOTH the on-session port and the narrow
    // off-session one. Only the latter is handed to Licensing.
    charger: provider,
    enrolment: {
      startCheckout: async (request) => {
        const intent = await provider.createIntent({
          // The PAYER, for the PSP's own reconciliation metadata — not a tenant scope of any row.
          tenantId: request.tenantRef,
          orderRef: `billing:${request.idempotencyKey}`,
          amountMinor: request.amountMinor,
          currency: request.currency,
          idempotencyKey: request.idempotencyKey,
        });
        if (intent.clientHandle === undefined) {
          throw new Error("Paymob returned no checkout URL for the enrolment payment");
        }
        return { providerOrderId: intent.providerIntentId, checkoutUrl: intent.clientHandle };
      },
    },
    cardTokenVerifier: {
      verify: (rawBody, signature) => {
        if (!verifyPaymobCardTokenSignature({ payload: rawBody, signature, secret: hmacSecret })) {
          return null;
        }
        const signed = extractSignedCardToken(rawBody);
        return signed === null
          ? null
          : {
              tokenId: signed.tokenId,
              token: signed.token,
              providerOrderId: signed.orderId,
              maskedPan: signed.maskedPan,
              cardSubtype: signed.cardSubtype,
            };
      },
    },
  };
}
