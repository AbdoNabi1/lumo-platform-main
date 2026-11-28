import {
  Lead,
  LEAD_STATUSES,
  LEAD_TRACKING_STATUSES,
  type LeadAttribution,
  type LeadClickId,
  type LeadProps,
  type LeadUtm,
} from "../domain/lead";
import { json, type LeadRow } from "./rows";

const COOKIE_KEYS = ["fbp", "fbc", "ttp", "scid", "ga"] as const;
const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const;
const SPAM_REASONS = ["honeypot", "too_fast"] as const;

function oneOf<T extends string>(values: readonly T[], column: string, value: string): T {
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`leads.${column} is not valid: ${value}`);
  return found;
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

function clickIdsOf(value: unknown): readonly LeadClickId[] {
  if (!Array.isArray(value)) return [];
  const out: LeadClickId[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { name, value: clickValue, capturedAt } = entry as Record<string, unknown>;
    if (
      typeof name === "string" &&
      typeof clickValue === "string" &&
      typeof capturedAt === "string"
    ) {
      out.push({ name, value: clickValue, capturedAt });
    }
  }
  return out;
}

function utmOf(value: unknown): LeadUtm {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const entry = raw[key];
    if (typeof entry === "string") utm[key] = entry;
  }
  return utm;
}

/**
 * Tolerant read of the stored attribution document: only string values survive. The visitor id, click ids and UTM
 * labels (Tracking P2-D8) are carried only when present, so a row written before they existed reads exactly as it did.
 */
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
  const visitorId = textOrNull(raw["visitorId"]);
  const clickIds = clickIdsOf(raw["clickIds"]);
  const utm = utmOf(raw["utm"]);
  return {
    pageUrl: textOrNull(raw["pageUrl"]),
    referrer: textOrNull(raw["referrer"]),
    ip: textOrNull(raw["ip"]),
    userAgent: textOrNull(raw["userAgent"]),
    cookies,
    ...(visitorId === null || visitorId === "" ? {} : { visitorId }),
    ...(clickIds.length === 0 ? {} : { clickIds }),
    ...(Object.keys(utm).length === 0 ? {} : { utm }),
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
