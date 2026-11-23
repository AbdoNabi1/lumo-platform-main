import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { buildPaginatedPage } from "@platform/repository";
import {
  businessEventId,
  decideLeadEmission,
  normalizeEmail,
  normalizePhone,
  type LeadEmissionLedgerPort,
} from "@platform/tracking";
import { err, ok, type Paginated, type Result } from "@platform/types";
import {
  BusinessRuleError,
  ConcurrencyError,
  type DomainError,
  type FieldIssue,
  NotFoundError,
  ValidationError,
} from "@platform/utils";
import {
  Lead,
  LEAD_STATUSES,
  type LeadAttribution,
  type LeadStatus,
  type LeadTrackingStatus,
} from "../domain/lead";
import type { LeadListQuery, LeadRepository } from "../domain/lead-repository";
import type { ShopFactsPort } from "./ports";

export const MIN_FILL_MS = 3000;
export const CURRENCY_CALLING_CODE: Readonly<Record<string, string>> = {
  EGP: "20",
  SAR: "966",
  AED: "971",
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const EXPORT_PAGE_SIZE = 250;
const MAX_SEARCH_LENGTH = 100;
const FORM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export interface LeadView {
  // explicit primitives, never the aggregate
  readonly id: string;
  readonly formId: string;
  readonly name: string;
  readonly phone: string;
  readonly phoneE164: string;
  readonly email: string | null;
  readonly message: string | null;
  readonly status: LeadStatus;
  readonly trackingStatus: LeadTrackingStatus;
  readonly eventId: string;
  readonly createdAt: string; // ISO
  readonly pageUrl: string | null;
  readonly referrer: string | null;
}

function toView(lead: Lead): LeadView {
  const p = lead.props;
  return {
    id: p.id,
    formId: p.formId,
    name: p.name,
    phone: p.phone,
    phoneE164: p.phoneE164,
    email: p.email,
    message: p.message,
    status: p.status,
    trackingStatus: p.trackingStatus,
    eventId: p.eventId,
    createdAt: p.createdAt.toISOString(),
    pageUrl: p.attribution.pageUrl,
    referrer: p.attribution.referrer,
  };
}

function toPage(rows: readonly Lead[], first: number): Paginated<LeadView> {
  const page = buildPaginatedPage(rows, first, (lead) => lead.props.id);
  return { items: page.items.map(toView), pageInfo: page.pageInfo };
}

function pageSizeOf(first: number | undefined): number {
  if (first === undefined || !Number.isFinite(first)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(Math.trunc(first), MAX_PAGE_SIZE));
}

// ---------------------------------------------------------------------------------- SubmitLead

export interface SubmitLeadInput {
  /** ADR-0014: the caller's verified tenant (never from the request body). */
  readonly tenantId: string;
  readonly formId: string;
  readonly name: string;
  readonly phone: string;
  readonly email?: string;
  readonly message?: string;
  readonly sessionId: string;
  readonly sessionAlreadyEmitted: boolean;
  readonly spamSignals: { readonly honeypot: boolean; readonly elapsedMs: number };
  readonly context: Omit<LeadAttribution, never>;
}

export interface SubmitLeadOutput {
  readonly leadId: string;
  readonly eventId: string;
  readonly emission: "emit" | "suppressed" | "spam";
}

export interface SubmitLeadDeps {
  readonly leads: LeadRepository;
  readonly ledger: LeadEmissionLedgerPort;
  readonly shop: ShopFactsPort;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

interface ValidLead {
  readonly name: string;
  readonly phone: string;
  readonly phoneE164: string;
  readonly email: string | null;
  readonly message: string | null;
}

/**
 * Saves every valid submission. Whether it must reach the ad platforms is decided first (spam →
 * never; same session → suppressed; else one Redis claim) and stored on the row in one write.
 */
export class SubmitLead implements UseCase<SubmitLeadInput, SubmitLeadOutput, DomainError> {
  private readonly deps: SubmitLeadDeps;

  constructor(deps: SubmitLeadDeps) {
    this.deps = deps;
  }

  async execute(input: SubmitLeadInput): Promise<Result<SubmitLeadOutput, DomainError>> {
    const { tenantId } = input;

    // 1. validate (every failure reported together)
    const currency = await this.deps.shop.currencyOf(tenantId);
    const validated = validate(input, CURRENCY_CALLING_CODE[currency]);
    if (!validated.ok) return validated;

    // 2. only lead sites take leads
    if ((await this.deps.shop.siteTypeOf(tenantId)) !== "lead_site") {
      return err(new BusinessRuleError("This shop does not take leads"));
    }

    // 3. identity
    const id = this.deps.idGenerator.generate();
    const eventId = businessEventId("lead", id);

    // 4/5. spam, then the once-per-session decision
    const spamReason = spamReasonOf(input.spamSignals);
    let status: LeadStatus = "new";
    let trackingStatus: LeadTrackingStatus;
    let emission: SubmitLeadOutput["emission"];
    if (spamReason !== null) {
      status = "spam";
      trackingStatus = "skipped_spam";
      emission = "spam";
    } else if (input.sessionAlreadyEmitted) {
      trackingStatus = "suppressed";
      emission = "suppressed";
    } else {
      emission = await decideLeadEmission(this.deps.ledger, {
        tenantId,
        sessionId: input.sessionId,
      });
      trackingStatus = emission === "emit" ? "pending" : "suppressed";
    }

    // 6. one write
    const at = this.deps.clock.now();
    await this.deps.leads.insert(
      tenantId,
      Lead.restore({
        id,
        formId: input.formId,
        ...validated.value,
        status,
        trackingStatus,
        eventId,
        sessionId: input.sessionId,
        spamReason,
        attribution: input.context,
        version: 0,
        createdAt: at,
        updatedAt: at,
      }),
    );
    return ok({ leadId: id, eventId, emission });
  }
}

function spamReasonOf(signals: SubmitLeadInput["spamSignals"]): "honeypot" | "too_fast" | null {
  if (signals.honeypot) return "honeypot";
  return signals.elapsedMs < MIN_FILL_MS ? "too_fast" : null;
}

function validate(
  input: SubmitLeadInput,
  callingCode: string | undefined,
): Result<ValidLead, ValidationError> {
  const issues: FieldIssue[] = [];
  const bad = (field: string, message: string): void => {
    issues.push({ field, message });
  };

  if (!FORM_ID_PATTERN.test(input.formId)) {
    bad("formId", "must be 1-64 letters, digits, underscores or hyphens");
  }

  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) bad("name", "must be 1-120 characters");

  const phone = input.phone.trim();
  let phoneE164: string | undefined;
  if (phone.length < 1 || phone.length > 32) {
    bad("phone", "must be a valid phone number");
  } else {
    phoneE164 = normalizePhone(phone, callingCode);
    if (phoneE164 === undefined) bad("phone", "must be a valid phone number");
  }

  let email: string | null = null;
  const rawEmail = input.email?.trim() ?? "";
  if (rawEmail !== "") {
    const normalized = normalizeEmail(rawEmail);
    if (normalized === undefined || rawEmail.length > 320) {
      bad("email", "must be a valid email");
    } else {
      email = normalized;
    }
  }

  const rawMessage = input.message?.trim() ?? "";
  if (rawMessage.length > 2000) bad("message", "must be at most 2000 characters");

  if (!SESSION_ID_PATTERN.test(input.sessionId)) {
    bad("sessionId", "must be 1-64 letters, digits or hyphens");
  }

  const elapsed = input.spamSignals.elapsedMs;
  if (!Number.isInteger(elapsed) || elapsed < 0) {
    bad("elapsedMs", "must be a non-negative integer");
  }

  if (issues.length > 0 || phoneE164 === undefined) {
    return err(new ValidationError("Invalid lead", issues));
  }
  return ok({
    name,
    phone,
    phoneE164,
    email,
    message: rawMessage === "" ? null : rawMessage,
  });
}

// ------------------------------------------------------------------------------------ reads

export interface ListLeadsInput extends Partial<Omit<LeadListQuery, "first">> {
  readonly tenantId: string;
  readonly first?: number;
}

export interface ListLeadsDeps {
  readonly leads: LeadRepository;
}

export class ListLeads implements UseCase<ListLeadsInput, Paginated<LeadView>, DomainError> {
  private readonly deps: ListLeadsDeps;

  constructor(deps: ListLeadsDeps) {
    this.deps = deps;
  }

  async execute(input: ListLeadsInput): Promise<Result<Paginated<LeadView>, DomainError>> {
    const search = input.search?.trim() ?? "";
    if (search.length > MAX_SEARCH_LENGTH) {
      return err(
        new ValidationError("Invalid lead search", [
          { field: "search", message: `must be at most ${String(MAX_SEARCH_LENGTH)} characters` },
        ]),
      );
    }
    const first = pageSizeOf(input.first);
    const rows = await this.deps.leads.list(input.tenantId, {
      first,
      ...(input.after !== undefined ? { after: input.after } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(search !== "" ? { search } : {}),
      ...(input.createdFrom !== undefined ? { createdFrom: input.createdFrom } : {}),
      ...(input.createdTo !== undefined ? { createdTo: input.createdTo } : {}),
    });
    return ok(toPage(rows, first));
  }
}

export interface GetLeadInput {
  readonly tenantId: string;
  readonly leadId: string;
}

export class GetLead implements UseCase<GetLeadInput, LeadView, DomainError> {
  private readonly deps: ListLeadsDeps;

  constructor(deps: ListLeadsDeps) {
    this.deps = deps;
  }

  async execute(input: GetLeadInput): Promise<Result<LeadView, DomainError>> {
    const lead = await this.deps.leads.get(input.tenantId, input.leadId);
    return lead === null ? err(new NotFoundError("Lead not found")) : ok(toView(lead));
  }
}

export interface ChangeLeadStatusInput {
  readonly tenantId: string;
  readonly leadId: string;
  readonly status: LeadStatus;
}

export interface ChangeLeadStatusDeps {
  readonly leads: LeadRepository;
  readonly clock: Clock;
}

/** Any status to any other; the same status again is a no-op success. Optimistic on `version`. */
export class ChangeLeadStatus implements UseCase<ChangeLeadStatusInput, LeadView, DomainError> {
  private readonly deps: ChangeLeadStatusDeps;

  constructor(deps: ChangeLeadStatusDeps) {
    this.deps = deps;
  }

  async execute(input: ChangeLeadStatusInput): Promise<Result<LeadView, DomainError>> {
    if (!LEAD_STATUSES.includes(input.status)) {
      return err(
        new ValidationError("Invalid lead status", [
          { field: "status", message: `must be one of ${LEAD_STATUSES.join(", ")}` },
        ]),
      );
    }
    const lead = await this.deps.leads.get(input.tenantId, input.leadId);
    if (lead === null) return err(new NotFoundError("Lead not found"));
    const next = lead.withStatus(input.status, this.deps.clock.now());
    if (next === lead) return ok(toView(lead));
    if (!(await this.deps.leads.updateStatus(input.tenantId, next))) {
      return err(new ConcurrencyError("The lead was changed by someone else; reload and retry"));
    }
    return ok(toView(next));
  }
}

export interface ListLeadExportRowsInput {
  readonly tenantId: string;
  readonly first?: number;
  readonly after?: string;
  readonly status?: LeadStatus;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
}

/** Cursor pages of a fixed 250 rows for the admin-web CSV builder (`first` is ignored). */
export class ListLeadExportRows implements UseCase<
  ListLeadExportRowsInput,
  Paginated<LeadView>,
  DomainError
> {
  private readonly deps: ListLeadsDeps;

  constructor(deps: ListLeadsDeps) {
    this.deps = deps;
  }

  async execute(input: ListLeadExportRowsInput): Promise<Result<Paginated<LeadView>, DomainError>> {
    const rows = await this.deps.leads.list(input.tenantId, {
      first: EXPORT_PAGE_SIZE,
      ...(input.after !== undefined ? { after: input.after } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.createdFrom !== undefined ? { createdFrom: input.createdFrom } : {}),
      ...(input.createdTo !== undefined ? { createdTo: input.createdTo } : {}),
    });
    return ok(toPage(rows, EXPORT_PAGE_SIZE));
  }
}
