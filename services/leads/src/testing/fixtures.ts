import type { Clock, IdGenerator } from "@platform/contracts";
import type { SubmitLeadInput } from "../application/leads.use-cases";
import type { ShopFactsPort, SiteType } from "../application/ports";
import { Lead, type LeadProps } from "../domain/lead";

export const NOW = new Date("2026-11-22T10:00:00.000Z");

export function fixedClock(at: Date = NOW): Clock {
  return { now: () => new Date(at.getTime()) };
}

/** UUIDv7-shaped ids that sort ascending: `01930000-0000-7000-8000-000000000001`, `...0002`, ... */
export function sequentialIds(): IdGenerator {
  let n = 0;
  return {
    generate: () => {
      n += 1;
      return `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;
    },
  };
}

export function fakeShop(over: { siteType?: SiteType; currency?: string } = {}): ShopFactsPort {
  return {
    siteTypeOf: () => Promise.resolve(over.siteType ?? "lead_site"),
    currencyOf: () => Promise.resolve(over.currency ?? "EGP"),
  };
}

let submissionCounter = 0;

/** A fresh, valid submission key per call, so repeated `validInput()` calls are distinct attempts. */
export function nextSubmissionKey(): string {
  submissionCounter += 1;
  return `attempt-${String(submissionCounter).padStart(6, "0")}`;
}

export function validInput(over: Partial<SubmitLeadInput> = {}): SubmitLeadInput {
  return {
    tenantId: "t-1",
    submissionKey: nextSubmissionKey(),
    formId: "home-form",
    name: "أحمد علي",
    phone: "٠١٠١٢٣٤٥٦٧٨",
    email: " A@B.com ",
    message: "  Call me  ",
    sessionId: "s-1",
    sessionAlreadyEmitted: false,
    spamSignals: { honeypot: false, elapsedMs: 8000 },
    context: {
      pageUrl: "https://shop.example/",
      referrer: null,
      ip: "203.0.113.9",
      userAgent: "test-agent",
      cookies: { fbp: "fb.1.123.456" },
    },
    ...over,
  };
}

export function leadProps(over: Partial<LeadProps> = {}): LeadProps {
  return {
    id: "01930000-0000-7000-8000-000000000001",
    formId: "home-form",
    name: "أحمد علي",
    phone: "01012345678",
    phoneE164: "+201012345678",
    email: "a@b.com",
    message: null,
    status: "new",
    trackingStatus: "pending",
    eventId: "lead_01930000-0000-7000-8000-000000000001",
    sessionId: "s-1",
    submissionKey: `key-${over.id ?? "01930000-0000-7000-8000-000000000001"}`,
    spamReason: null,
    attribution: { pageUrl: null, referrer: null, ip: null, userAgent: null, cookies: {} },
    version: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function leadOf(over: Partial<LeadProps> = {}): Lead {
  return Lead.restore(leadProps(over));
}
