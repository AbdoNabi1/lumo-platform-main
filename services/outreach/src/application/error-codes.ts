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
  "ONBOARDING_PIN_INVALID",
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
  // also listed by Meta's `message_template_status_update` reference (`NONE` is not a rejection)
  "PROMOTIONAL",
  "CATEGORY_NOT_AVAILABLE",
]);

/**
 * The numeric `code` values of Meta's "WhatsApp error codes" reference
 * (https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes/, read 2026-11-22):
 * authorization, integrity, template creation / send, phone migration, template insights, WABA, synchronization,
 * throttling, "other" and Marketing Messages API tables. This is an EXPLICIT list, not a digit family: a six-digit PIN
 * or any other number that merely looks like a provider code is not one unless Meta lists it.
 */
const META_ERROR_CODES: ReadonlySet<string> = new Set([
  "0",
  "1",
  "2",
  "3",
  "4",
  "10",
  "33",
  "100",
  "190",
  "200",
  "368",
  "80007",
  "130403",
  "130429",
  "130472",
  "130497",
  "131000",
  "131005",
  "131008",
  "131009",
  "131016",
  "131021",
  "131026",
  "131031",
  "131037",
  "131042",
  "131045",
  "131047",
  "131048",
  "131049",
  "131050",
  "131051",
  "131052",
  "131053",
  "131055",
  "131056",
  "131057",
  "131063",
  "131064",
  "131066",
  "132000",
  "132001",
  "132005",
  "132007",
  "132012",
  "132015",
  "132016",
  "132018",
  "132068",
  "132069",
  "133000",
  "133004",
  "133005",
  "133006",
  "133008",
  "133009",
  "133010",
  "133015",
  "133016",
  "134011",
  "134100",
  "134101",
  "134102",
  "135000",
  "200005",
  "200006",
  "200007",
  "1752041",
  "2388012",
  "2388019",
  "2388039",
  "2388040",
  "2388047",
  "2388072",
  "2388073",
  "2388091",
  "2388093",
  "2388103",
  "2388293",
  "2388299",
  "2494100",
  "2593079",
  "2593085",
  "2593107",
  "2593108",
]);

/** The only numeric interval Meta documents as a range: permission errors `200-299`. */
const META_ERROR_INTERVALS: ReadonlyArray<readonly [number, number]> = [[200, 299]];

/** Canonical decimal digits (no sign, leading zero, separator) of a documented code or a code inside a documented interval. */
function isMetaNumeric(code: string): boolean {
  if (!/^(0|[1-9][0-9]{0,6})$/.test(code)) return false;
  if (META_ERROR_CODES.has(code)) return true;
  const n = Number(code);
  return META_ERROR_INTERVALS.some(([low, high]) => n >= low && n <= high);
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
