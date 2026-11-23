import {
  Lead,
  LEAD_STATUSES,
  LEAD_TRACKING_STATUSES,
  type LeadAttribution,
  type LeadProps,
} from "../domain/lead";
import { json, type LeadRow } from "./rows";

const COOKIE_KEYS = ["fbp", "fbc", "ttp", "scid", "ga"] as const;
const SPAM_REASONS = ["honeypot", "too_fast"] as const;

function oneOf<T extends string>(values: readonly T[], column: string, value: string): T {
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`leads.${column} is not valid: ${value}`);
  return found;
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Tolerant read of the stored attribution document: only string values survive. */
function attributionOf(value: unknown): LeadAttribution {
  const raw =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const rawCookies =
    typeof raw["cookies"] === "object" && raw["cookies"] !== null
      ? (raw["cookies"] as Record<string, unknown>)
      : {};
  const cookies: Record<string, string> = {};
  for (const key of COOKIE_KEYS) {
    const cookie = rawCookies[key];
    if (typeof cookie === "string") cookies[key] = cookie;
  }
  return {
    pageUrl: textOrNull(raw["pageUrl"]),
    referrer: textOrNull(raw["referrer"]),
    ip: textOrNull(raw["ip"]),
    userAgent: textOrNull(raw["userAgent"]),
    cookies,
  };
}

/** Row → aggregate. Throws on a status, tracking status or spam reason outside the closed sets. */
export function rowToLead(row: LeadRow): Lead {
  const props: LeadProps = {
    id: row.id,
    formId: row.formId,
    name: row.name,
    phone: row.phone,
    phoneE164: row.phoneE164,
    email: row.email,
    message: row.message,
    status: oneOf(LEAD_STATUSES, "status", row.status),
    trackingStatus: oneOf(LEAD_TRACKING_STATUSES, "tracking_status", row.trackingStatus),
    eventId: row.eventId,
    sessionId: row.sessionId,
    submissionKey: row.submissionKey,
    spamReason: row.spamReason === null ? null : oneOf(SPAM_REASONS, "spam_reason", row.spamReason),
    attribution: attributionOf(row.attribution),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return Lead.restore(props);
}

/** Aggregate → `create` data; the tenant comes from the caller's argument, never from the lead. */
export function leadToRowData(tenantId: string, lead: Lead) {
  const p = lead.props;
  return {
    id: p.id,
    tenantId,
    formId: p.formId,
    name: p.name,
    phone: p.phone,
    phoneE164: p.phoneE164,
    email: p.email,
    message: p.message,
    status: p.status,
    trackingStatus: p.trackingStatus,
    eventId: p.eventId,
    sessionId: p.sessionId,
    submissionKey: p.submissionKey,
    spamReason: p.spamReason,
    attribution: json(p.attribution),
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
