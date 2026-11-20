/**
 * The ONLY error codes and reasons that may be stored, emitted or shown (I9). A code-looking string is not enough: a
 * six-digit PIN or an uppercase secret has the same shape as a provider code, so every value is checked against a fixed
 * allowlist and anything else collapses to {@link GENERIC_ERROR_CODE}. Provider text never passes through.
 */

export const GENERIC_ERROR_CODE = "PROVIDER_ERROR";

/** Codes this service raises itself (conflicts, local failures, onboarding states). */
const LOCAL_CODES: ReadonlySet<string> = new Set([
  GENERIC_ERROR_CODE,
  "AUTHORIZATION_EXPIRED",
  "CONNECTION_CHANGED",
  "CREDENTIALS_UNAVAILABLE",
  "EMAIL_CAP_REACHED",
  "EMAIL_MARKETING_NOT_AVAILABLE",
  "EMAIL_NOT_CONFIGURED",
  "ONBOARDING_IN_PROGRESS",
  "ONBOARDING_NOT_ACTIVE",
  "ONBOARDING_RECONCILIATION_REQUIRED",
  "PHONE_IN_USE",
  "SEND_OUTCOME_UNRECORDED",
  "SESSION_WINDOW_CLOSED",
  "TEMPLATE_ALREADY_EXISTS",
  "TEMPLATE_NOT_APPROVED",
  "TEMPLATE_STATUS_UNCERTAIN",
  "TEMPLATE_UNSUPPORTED",
  "WABA_IN_USE",
  "WHATSAPP_NOT_CONFIGURED",
  "WHATSAPP_NOT_CONNECTED",
]);

/** Codes the adapters synthesise for transport problems (never provider text). */
const ADAPTER_CODES: ReadonlySet<string> = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "INVALID_RESPONSE",
  "PHONE_LIST_INCOMPLETE",
  "TEMPLATE_SYNC_INCOMPLETE",
  "ASSET_MISMATCH",
]);

/** The error names of the email provider's documented API, mapped to themselves. */
const EMAIL_PROVIDER_REASONS: ReadonlySet<string> = new Set([
  "validation_error",
  "missing_required_field",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "concurrent_idempotent_requests",
  "invalid_from_address",
  "invalid_to_address",
  "invalid_parameter",
  "invalid_access",
  "invalid_api_key",
  "missing_api_key",
  "restricted_api_key",
  "security_error",
  "rate_limit_exceeded",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "not_found",
  "method_not_allowed",
  "application_error",
  "internal_server_error",
]);

/** Template rejection reasons Meta documents; anything else is not shown. */
const TEMPLATE_REASONS: ReadonlySet<string> = new Set([
  "ABUSIVE_CONTENT",
  "INCORRECT_CATEGORY",
  "INVALID_FORMAT",
  "SCAM",
  "TAG_CONTENT_MISMATCH",
]);

/**
 * Meta's documented numeric error code families: the legacy Graph API codes (below 1000), the app/API rate limits
 * (80xxx), the WhatsApp Cloud API codes (13xxxx) and the template-management codes (2388xxx / 2494xxx / 2593xxx).
 * Any other number is NOT accepted as a provider code, even though it is made of digits.
 */
function isMetaNumeric(code: string): boolean {
  if (!/^[0-9]{1,7}$/.test(code) || String(Number(code)) !== code) return false;
  const n = Number(code);
  return (
    n < 1000 ||
    (n >= 80000 && n <= 80999) ||
    (n >= 130000 && n <= 139999) ||
    (n >= 2388000 && n <= 2388999) ||
    (n >= 2494000 && n <= 2494999) ||
    (n >= 2593000 && n <= 2593999)
  );
}

/** A Meta-side code: a documented numeric code, `HTTP_<status>`, or an adapter transport code. `null` otherwise. */
export function metaProviderCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  if (isMetaNumeric(code) || /^HTTP_[1-5][0-9]{2}$/.test(code) || ADAPTER_CODES.has(code)) {
    return code;
  }
  return null;
}

/** The code if it is on the allowlist, else `null`. */
export function knownCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  if (LOCAL_CODES.has(code) || EMAIL_PROVIDER_REASONS.has(code)) return code;
  if (metaProviderCode(code) !== null) return code;
  if (code.startsWith("META_")) {
    return metaProviderCode(code.slice(5)) !== null || code === "META_ERROR" ? code : null;
  }
  return null;
}

/**
 * What may be displayed or stored as a failure code: an allowlisted code unchanged; any other non-empty value the fixed
 * generic code; nothing → `null`.
 */
export function safeCode(code: string | null | undefined): string | null {
  if (code === null || code === undefined || code === "") return null;
  return knownCode(code) ?? GENERIC_ERROR_CODE;
}

/** `META_<code>` for a validated provider code, `META_ERROR` for everything else. */
export function metaConflictCodeOf(code: unknown): string {
  const known = metaProviderCode(code);
  return known === null ? "META_ERROR" : `META_${known}`;
}

/** The first webhook error code as a stored value: a documented code, else the generic one; none → `null`. */
export function webhookErrorCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : raw;
  return metaProviderCode(text) ?? GENERIC_ERROR_CODE;
}

/** A template rejection reason that may be stored or shown; `null` for NONE, unknown or malformed values. */
export function templateReason(reason: unknown): string | null {
  return typeof reason === "string" && TEMPLATE_REASONS.has(reason) ? reason : null;
}
