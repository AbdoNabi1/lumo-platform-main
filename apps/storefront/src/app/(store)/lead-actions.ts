"use server";

import { cookies, headers } from "next/headers";
import { trustedClientIp } from "@/lib/client-ip";
import {
  createLead,
  isCreateLeadResult,
  validationFieldsOf,
  type CreateLeadBody,
} from "@/lib/runtime-api";
import {
  isSessionId,
  LEAD_SENT_COOKIE,
  leadSentCookieOptions,
  VISITOR_SESSION_COOKIE,
  visitorSessionCookieOptions,
} from "@/lib/visitor-session";

export interface LeadFormInput {
  readonly formId: string;
  readonly name: string;
  readonly phone: string;
  readonly email?: string;
  readonly message?: string;
  /** The hidden trap field: a person leaves it empty. */
  readonly honeypot: string;
  /** Milliseconds between the form appearing and the submit. */
  readonly elapsedMs: number;
  /** One per submit attempt (the form mints it once), so a double click or a retry reuses it. */
  readonly submissionKey: string;
}

type LeadField = "name" | "phone" | "email" | "message";

export type LeadSubmissionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "validation";
      readonly fields: readonly LeadField[];
    }
  | { readonly ok: false; readonly reason: "rate_limited" | "unavailable" | "network" };

const FORM_FIELDS: readonly LeadField[] = ["name", "phone", "email", "message"];
const ATTRIBUTION_COOKIES = [
  ["fbp", "_fbp"],
  ["fbc", "_fbc"],
  ["ttp", "_ttp"],
  ["scid", "_scid"],
  ["ga", "_ga"],
] as const;
/** The route's own limits (`public-leads-routes.ts`); a value past them would 422 the whole lead. */
const MAX_URL = 2048;
const MAX_TEXT = 512;

const optional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
};

function mapFailure(status: number, body: unknown): LeadSubmissionResult {
  if (status === 422) {
    const named = new Set(validationFieldsOf(body));
    return { ok: false, reason: "validation", fields: FORM_FIELDS.filter((f) => named.has(f)) };
  }
  if (status === 429) return { ok: false, reason: "rate_limited" };
  if (status === 409 || status === 503) return { ok: false, reason: "unavailable" };
  return { ok: false, reason: "network" };
}

/**
 * Forwards a lead-form entry to the Runtime. Session identity is the first-party `morbeh_sid` the
 * middleware keeps alive; `morbeh_lead_sent` (set below after a forwarded lead) tells the next lead
 * in the same session to be suppressed. The shop is never taken from the input.
 */
export async function submitLead(input: LeadFormInput): Promise<LeadSubmissionResult> {
  const jar = await cookies();
  const requestHeaders = await headers();

  const stored = jar.get(VISITOR_SESSION_COOKIE)?.value;
  const sid = isSessionId(stored) ? stored : crypto.randomUUID();
  if (sid !== stored) jar.set(VISITOR_SESSION_COOKIE, sid, visitorSessionCookieOptions());
  const sessionAlreadyEmitted = jar.get(LEAD_SENT_COOKIE)?.value === sid;

  const attribution: Record<string, string> = {};
  for (const [key, cookie] of ATTRIBUTION_COOKIES) {
    const value = jar.get(cookie)?.value;
    // An identifier cut short matches nothing: leave it out rather than truncate it.
    if (value !== undefined && value !== "" && value.length <= MAX_TEXT) attribution[key] = value;
  }

  const email = optional(input.email);
  const message = optional(input.message);
  const body: CreateLeadBody = {
    formId: input.formId,
    name: input.name.trim(),
    phone: input.phone.trim(),
    ...(email === undefined ? {} : { email }),
    ...(message === undefined ? {} : { message }),
    sessionId: sid,
    sessionAlreadyEmitted,
    spamSignals: {
      honeypot: input.honeypot.trim() !== "",
      // A non-number from a caller that skipped the form counts as "instant" (spam), never a 422.
      elapsedMs: Number.isNaN(input.elapsedMs)
        ? 0
        : Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(input.elapsedMs))),
    },
    context: {
      pageUrl: requestHeaders.get("referer")?.slice(0, MAX_URL) ?? null,
      // The page's own referrer is unknown on the server.
      referrer: null,
      // Tracking P1-D7: the address OUR proxy appended (right-most untrusted hop), never the left-most
      // value, which the submitter can write. Null when the header is absent or not an address.
      ip: trustedClientIp(requestHeaders),
      userAgent: requestHeaders.get("user-agent")?.slice(0, MAX_TEXT) ?? null,
      cookies: attribution,
    },
  };

  const response = await createLead(body, input.submissionKey);
  if (response.status === 201) {
    if (!isCreateLeadResult(response.body)) return { ok: false, reason: "network" };
    if (response.body.emission !== "spam") jar.set(LEAD_SENT_COOKIE, sid, leadSentCookieOptions());
    return { ok: true };
  }
  return mapFailure(response.status, response.body);
}
