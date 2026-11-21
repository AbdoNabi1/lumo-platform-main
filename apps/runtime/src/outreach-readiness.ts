import type { AdminOutreachDeps } from "@platform/admin";
import {
  EnvelopeOutreachCredentialVault,
  MetaGraphClient,
  OUTREACH_CREDENTIALS_KEY_ALIAS,
  ResendEmailClient,
  type OutreachCredentialVault,
} from "@platform/outreach";
import { NodeCrypto } from "@platform/security";
import { EnvelopeCipher, KeyAliasRegistry } from "@platform/secrets";
import { logger } from "@platform/utils";
import type { RuntimeConfig } from "./config";

/** The only fields the outreach readiness reads. */
export type OutreachReadinessConfig = Pick<
  RuntimeConfig,
  | "META_APP_ID"
  | "META_APP_SECRET"
  | "META_WHATSAPP_CONFIG_ID"
  | "META_WEBHOOK_VERIFY_TOKEN"
  | "META_GRAPH_API_VERSION"
  | "OUTREACH_CREDENTIALS_KEK_REF"
  | "RESEND_API_KEY"
  | "OUTREACH_EMAIL_FROM"
>;

const GRAPH_VERSION = /^v\d+\.\d+$/;
const filled = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * The ONE place that decides what Outreach can do from the environment (every other piece — port construction, the
 * signup values, the webhook secrets — keys off this result, so they cannot drift apart).
 *  - WhatsApp needs ALL of `META_APP_ID`, `META_APP_SECRET`, `META_WHATSAPP_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN` and
 *    `OUTREACH_CREDENTIALS_KEK_REF`, plus a well-formed Graph version. Anything less is "not configured": no port, no vault,
 *    no signup values, and the webhook routes fail closed.
 *  - Email needs `RESEND_API_KEY` and `OUTREACH_EMAIL_FROM`.
 */
export function outreachReadiness(c: OutreachReadinessConfig): {
  whatsapp: boolean;
  email: boolean;
} {
  return {
    whatsapp:
      filled(c.META_APP_ID) &&
      filled(c.META_APP_SECRET) &&
      filled(c.META_WHATSAPP_CONFIG_ID) &&
      filled(c.META_WEBHOOK_VERIFY_TOKEN) &&
      filled(c.OUTREACH_CREDENTIALS_KEK_REF) &&
      GRAPH_VERSION.test(c.META_GRAPH_API_VERSION),
    email: filled(c.RESEND_API_KEY) && filled(c.OUTREACH_EMAIL_FROM),
  };
}

/**
 * The real credential vault: envelope encryption over `NodeCrypto`, under its OWN alias and KEK
 * (`OUTREACH_CREDENTIALS_KEK_REF`), so rotating it never touches payments or carriers.
 */
function buildOutreachCredentialVault(kekRef: string): OutreachCredentialVault {
  const aliases = new KeyAliasRegistry();
  aliases.set(OUTREACH_CREDENTIALS_KEY_ALIAS, kekRef);
  return new EnvelopeOutreachCredentialVault(
    new EnvelopeCipher(new NodeCrypto(), aliases),
    OUTREACH_CREDENTIALS_KEY_ALIAS,
  );
}

export type RuntimeOutreachConfig = OutreachReadinessConfig &
  Pick<
    RuntimeConfig,
    "OUTREACH_EMAIL_CAP_PER_HOUR" | "OUTREACH_EMAIL_CAP_PER_DAY" | "OUTREACH_UNRESOLVED_AFTER_MS"
  >;

/**
 * Builds the ports the admin composition receives from the environment. Not ready ⇒ the port is simply absent (never a
 * stub): the API answers `available:false` / `WHATSAPP_NOT_CONFIGURED` and the webhook routes fail closed. `fetchImpl`
 * is the only seam for HTTP to Meta and Resend (tests inject a recording fake; production uses the global `fetch`).
 */
export function buildOutreachWiring(
  config: RuntimeOutreachConfig,
  fetchImpl?: typeof fetch,
): AdminOutreachDeps {
  const ready = outreachReadiness(config);
  const whatsapp =
    ready.whatsapp &&
    config.META_APP_ID !== undefined &&
    config.META_APP_SECRET !== undefined &&
    config.META_WHATSAPP_CONFIG_ID !== undefined &&
    config.META_WEBHOOK_VERIFY_TOKEN !== undefined &&
    config.OUTREACH_CREDENTIALS_KEK_REF !== undefined
      ? {
          port: new MetaGraphClient({
            appId: config.META_APP_ID,
            appSecret: config.META_APP_SECRET,
            apiVersion: config.META_GRAPH_API_VERSION,
            ...(fetchImpl === undefined ? {} : { fetchImpl }),
          }),
          vault: buildOutreachCredentialVault(config.OUTREACH_CREDENTIALS_KEK_REF),
          signup: {
            appId: config.META_APP_ID,
            configId: config.META_WHATSAPP_CONFIG_ID,
            graphApiVersion: config.META_GRAPH_API_VERSION,
          },
          webhook: {
            appSecret: config.META_APP_SECRET,
            verifyToken: config.META_WEBHOOK_VERIFY_TOKEN,
          },
        }
      : undefined;
  const email =
    ready.email && config.RESEND_API_KEY !== undefined && config.OUTREACH_EMAIL_FROM !== undefined
      ? {
          port: new ResendEmailClient({
            apiKey: config.RESEND_API_KEY,
            ...(fetchImpl === undefined ? {} : { fetchImpl }),
          }),
          from: config.OUTREACH_EMAIL_FROM,
        }
      : undefined;
  return {
    ...(whatsapp === undefined
      ? {}
      : {
          whatsapp: whatsapp.port,
          vault: whatsapp.vault,
          signup: whatsapp.signup,
          webhook: whatsapp.webhook,
        }),
    ...(email === undefined ? {} : { email: email.port, emailFrom: email.from }),
    emailCaps: {
      perHour: config.OUTREACH_EMAIL_CAP_PER_HOUR,
      perDay: config.OUTREACH_EMAIL_CAP_PER_DAY,
    },
    unresolvedAfterMs: config.OUTREACH_UNRESOLVED_AFTER_MS,
  };
}

/**
 * Boot guard (the carriers pattern): merchants' Meta tokens must never be "sealed" by the stand-in vault outside
 * `APP_ENV=local`. No vault at all is allowed (Outreach is then simply not configured); a `stub` vault is refused
 * outside `local`, where it only warns.
 */
export function assertProductionOutreachVaultConfigured(
  config: Pick<RuntimeConfig, "APP_ENV">,
  vault: Pick<OutreachCredentialVault, "backing"> | undefined,
): void {
  if (vault === undefined || vault.backing !== "stub") return;
  const problem =
    "the in-memory outreach credential vault must never seal merchants' Meta tokens outside APP_ENV=local. " +
    "Set OUTREACH_CREDENTIALS_KEK_REF (with the rest of the WhatsApp variables).";
  if (config.APP_ENV === "local") {
    logger.warn(`Outreach guard (APP_ENV=local, not enforced): ${problem}`);
    return;
  }
  throw new Error(`api: ${problem}`);
}
