import {
  LoggingEmailSender,
  ResendEmailSender,
  ResendStoreEmailProvider,
  type EmailSender,
} from "@platform/admin";
import {
  EnvelopeEmailConnectionVault,
  EMAIL_CREDENTIALS_KEY_ALIAS,
  InMemoryEmailConnectionVault,
  type EmailConnectionVault,
  type StoreEmailProvider,
} from "@platform/notifications";
import { EnvelopeCipher, KeyAliasRegistry } from "@platform/secrets";
import { NodeCrypto } from "@platform/security";
import { logger } from "@platform/utils";
import type { RuntimeConfig } from "./config";

export interface EmailWiring {
  readonly emailSender: EmailSender;
  /**
   * Wave 1d (R1): `true` only when `emailSender` REALLY delivers (the Resend branch). The logging sender
   * answers every call successfully while sending nothing, so it must never back an invitation.
   */
  readonly deliveryConfigured: boolean;
}

/**
 * Plan 1C: Resend when a key is configured, otherwise a sender that logs recipient + subject only.
 * Wave 2b2 (D45): this is MORBEH's own account. It backs staff invitations, staff password reset and
 * Morbeh -> merchant mail ONLY. It is never handed to anything that sends a store's customer mail.
 */
export function resolveEmailWiring(
  config: Pick<RuntimeConfig, "RESEND_API_KEY" | "EMAIL_FROM">,
  fetchImpl?: typeof fetch,
): EmailWiring {
  if (config.RESEND_API_KEY === undefined) {
    return { emailSender: new LoggingEmailSender(logger), deliveryConfigured: false };
  }
  const emailSender = new ResendEmailSender({
    apiKey: config.RESEND_API_KEY,
    from: config.EMAIL_FROM,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
  return { emailSender, deliveryConfigured: true };
}

/**
 * Wave 1d (R1): what the admin wiring receives for staff invitations. The sender is passed ONLY when
 * delivery is real and `ADMIN_PUBLIC_URL` is set (the link is built from it); otherwise inviting answers
 * 503 NOT_CONFIGURED before anything is written. Password reset keeps using `emailSender` as before.
 */
export function staffInviteDelivery(
  email: Pick<EmailWiring, "emailSender" | "deliveryConfigured">,
  config: Pick<RuntimeConfig, "ADMIN_PUBLIC_URL">,
): { readonly staffInviteEmailSender?: EmailSender } {
  return email.deliveryConfigured && config.ADMIN_PUBLIC_URL !== undefined
    ? { staffInviteEmailSender: email.emailSender }
    : {};
}

/**
 * Wave 2b2 (D47/D48): how a store's customer mail is delivered: through the MERCHANT's own email
 * account. The provider takes the merchant's key per call and holds no platform key; the vault seals
 * that key under `EMAIL_CREDENTIALS_KEK_REF`.
 *
 * With no KEK: `APP_ENV=local` gets the in-memory stub vault (so a developer can click through the
 * page; the boot guard accepts it only there), any other environment gets NO vault, so saving a
 * connection answers 503 NOT_CONFIGURED "Not available yet" and no customer mail is sent.
 */
export function storeEmailDelivery(
  config: Pick<RuntimeConfig, "EMAIL_CREDENTIALS_KEK_REF" | "APP_ENV">,
  fetchImpl?: typeof fetch,
): { readonly emailVault?: EmailConnectionVault; readonly emailProvider: StoreEmailProvider } {
  const emailProvider = new ResendStoreEmailProvider(fetchImpl === undefined ? {} : { fetchImpl });
  if (config.EMAIL_CREDENTIALS_KEK_REF !== undefined) {
    return {
      emailVault: buildEmailConnectionVault(config.EMAIL_CREDENTIALS_KEK_REF),
      emailProvider,
    };
  }
  return config.APP_ENV === "local"
    ? { emailVault: new InMemoryEmailConnectionVault(), emailProvider }
    : { emailProvider };
}

/**
 * The real email credential vault (D48): `@platform/secrets`' envelope encryption over `NodeCrypto`,
 * the data key wrapped under a KEK derived from `kekRef`, under its OWN alias. The stored blob is
 * `{v, alias, wrappedDek, ciphertext}` only: with `NodeCrypto` the key reference IS the key material,
 * so it is resolved on open from this trusted alias registry, never from the row.
 */
export function buildEmailConnectionVault(kekRef: string): EmailConnectionVault {
  const aliases = new KeyAliasRegistry();
  aliases.set(EMAIL_CREDENTIALS_KEY_ALIAS, kekRef);
  return new EnvelopeEmailConnectionVault(
    new EnvelopeCipher(new NodeCrypto(), aliases),
    EMAIL_CREDENTIALS_KEY_ALIAS,
    (alias) => {
      try {
        return aliases.resolve(alias);
      } catch {
        return undefined;
      }
    },
  );
}
