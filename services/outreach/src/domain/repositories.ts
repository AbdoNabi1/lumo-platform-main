/**
 * Repository ports of the outreach context (Task 4). Pure types; no I/O, no Prisma.
 *
 * Conventions (binding, plan Task 4 amendments):
 * - Every method takes the tenant explicitly and an optional `tx` (the unit-of-work context). A read that accepts `tx`
 *   uses it. The only tenant-less port is {@link PhoneDirectory}, which is platform-scoped by construction.
 * - Version convention: a record carries the version it was READ at. `save(r, expectedVersion)` creates the row at
 *   version 1 when `expectedVersion === 0` and no row exists; otherwise it updates only where tenant + key +
 *   `version === expectedVersion` and stores `expectedVersion + 1`. A miss throws `ConcurrencyError`. Rows created by
 *   `insert`-style methods also start at version 1. The `version` field of a record passed IN is ignored.
 * - Duplicate-key writes return `"duplicate"` and never throw, but only for the INTENDED replay key. Any other unique
 *   violation propagates as `Error("unexpected unique conflict")` so the surrounding transaction rolls back.
 */
import type { OutboundStatus } from "./outbound-message";

/**
 * The tenant-scoped unit of work of the outreach context (ADR-0014). `run` opens ONE transaction whose `app.tenant_id`
 * is the given (trusted) shop from its first statement; every repository call made with the handed-in `tx` shares it.
 * Directory operations inside it switch to the platform scope for that operation only and restore the shop scope.
 */
export interface OutreachUnitOfWork {
  run<T>(tenantId: string, work: (tx: unknown) => Promise<T>): Promise<T>;
}

export type ConnectionStatus = "onboarding" | "connected" | "disconnected" | "error";
export type OnboardingStage = "verified" | "subscribed" | "registering" | "registered";

export interface WhatsAppConnectionRecord {
  tenantId: string;
  status: ConnectionStatus;
  wabaId: string;
  phoneNumberId: string;
  /** Filled only on a completed connection. */
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  sealedCredentials: string;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  lastStatusSyncAt: Date | null;
  lastError: string | null;
  onboardingAttemptId: string | null;
  onboardingStage: OnboardingStage | null;
  /** Meta error code only. */
  onboardingFailure: string | null;
  onboardingLeaseOwner: string | null;
  onboardingLeaseUntil: Date | null;
  version: number;
}

/** What the row must look like for a lease operation to apply (all compared inside the conditional write). */
export interface OnboardingExpectation {
  version: number;
  onboardingStage: OnboardingStage | null;
  onboardingAttemptId: string | null;
  phoneNumberId: string;
  wabaId: string;
}

/** The expectation of a live lease holder: the row must still carry this owner. */
export interface LeaseHolder extends OnboardingExpectation {
  owner: string;
}

export interface WhatsAppConnectionRepository {
  get(tenantId: string, tx?: unknown): Promise<WhatsAppConnectionRecord | null>;
  /** Version convention above. Throws `ConcurrencyError` on a miss. Every column is written. */
  save(r: WhatsAppConnectionRecord, expectedVersion: number, tx?: unknown): Promise<void>;
  /**
   * Takes the onboarding lease at WRITE time. The lease is judged by the DATABASE wall clock sampled by the statement
   * that writes (never by a time the caller read earlier): the scoped row is locked, then ONE conditional write applies
   * where tenant + version + stage + attempt + phone + WABA match AND `lease_until IS NULL OR lease_until < dbNow`.
   * `expected === null` creates the row (version 1) already holding the lease; a concurrent creator makes the insert
   * lose. `next` names the new owner (a non-null `onboardingLeaseOwner`; every other column of `next` is written); the
   * deadline is derived from the same clock, `dbNow + leaseMs`, and `next.onboardingLeaseUntil` is ignored. A miss
   * (version bump, other row shape or a live lease) throws `ConcurrencyError`; `leaseMs` must be positive and finite.
   */
  acquireOnboardingLease(
    next: WhatsAppConnectionRecord,
    expected: OnboardingExpectation | null,
    leaseMs: number,
    tx?: unknown,
  ): Promise<void>;
  /**
   * Extends the lease of the CURRENT owner only: tenant + the whole holder expectation + `lease_owner = owner` AND
   * `lease_until > dbNow` (the clock at the write). Writes `lease_until = dbNow + leaseMs` and bumps the version;
   * `ConcurrencyError` on a miss.
   */
  renewOnboardingLease(
    tenantId: string,
    holder: LeaseHolder,
    leaseMs: number,
    tx?: unknown,
  ): Promise<void>;
  /**
   * An owner-conditional write (stage, failure, reseal, release, finalize): the scoped row is locked, then ONE
   * conditional update applies where tenant + the whole holder expectation + `lease_owner = owner` AND
   * `lease_until > dbNow` (the clock at the write, not an earlier read). Every column of `next` is written, except the
   * lease deadline: a non-null `next.onboardingLeaseOwner` keeps the lease with `lease_until = dbNow + leaseMs`, a null
   * one releases it (both lease columns cleared). `ConcurrencyError` on a miss.
   */
  writeAsLeaseOwner(
    next: WhatsAppConnectionRecord,
    holder: LeaseHolder,
    leaseMs: number,
    tx?: unknown,
  ): Promise<void>;
}

export interface DirectoryEntry {
  shopTenantId: string;
  phoneNumberId: string;
  wabaId: string;
}

export type ClaimResult = "claimed" | "phone_in_use" | "waba_in_use";

/** Platform-scoped (`tenant_id` = the platform tenant). One phone and one WABA per shop; one owning shop per phone/WABA. */
export interface PhoneDirectory {
  find(
    phoneNumberId: string,
    tx?: unknown,
  ): Promise<{ shopTenantId: string; wabaId: string } | null>;
  findByWaba(
    wabaId: string,
    tx?: unknown,
  ): Promise<{ shopTenantId: string; phoneNumberId: string } | null>;
  findByShop(
    shopTenantId: string,
    tx?: unknown,
  ): Promise<{ phoneNumberId: string; wabaId: string } | null>;
  /**
   * Re-reads the owner of a phone INSIDE the caller's unit of work and holds a share lock on that row until the
   * transaction ends: a concurrent release / claim of the row waits for this transaction, so the owner it returns is
   * still the owner when the caller's writes commit. `tx` is required (a standalone read cannot fence anything).
   */
  fencePhone(
    phoneNumberId: string,
    tx: unknown,
  ): Promise<{ shopTenantId: string; wabaId: string } | null>;
  /** Same fence, keyed by WABA (template events). */
  fenceWaba(
    wabaId: string,
    tx: unknown,
  ): Promise<{ shopTenantId: string; phoneNumberId: string } | null>;
  /**
   * One `tx`, in this order: (1) release the shop's existing tuple when it differs from `(phone, waba, shop)`;
   * (2) insert `(phone, waba, shop)` skipping duplicates; (3) read back by phone and by WABA; (4) `claimed` ONLY when
   * the phone row equals the full tuple and the WABA row belongs to the shop; (5) otherwise `phone_in_use` /
   * `waba_in_use`. It never updates an owner. With a caller `tx` the caller rolls it back on a non-claim (that undoes
   * the release). WITHOUT `tx` the claim runs in an owned transaction that is rolled back on a non-claim, so a failed
   * standalone claim never leaves the shop's previous mapping released.
   */
  claim(
    phoneNumberId: string,
    wabaId: string,
    shopTenantId: string,
    tx?: unknown,
  ): Promise<ClaimResult>;
  /** Filters platform scope + phone + `shopTenantId`; a different shop's row is untouched. */
  release(phoneNumberId: string, shopTenantId: string, tx?: unknown): Promise<void>;
}

export type TemplateStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED"
  | "IN_APPEAL"
  | "DELETED"
  | "ARCHIVED"
  | "PENDING_DELETION"
  | "UNKNOWN";
export type TemplateCategoryValue = "UTILITY" | "MARKETING" | "AUTHENTICATION";

export interface TemplateRecord {
  id: string;
  tenantId: string;
  wabaId: string;
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: TemplateCategoryValue;
  components: unknown;
  status: TemplateStatus;
  rejectedReason: string | null;
  qualityScore: string | null;
  lastSyncedAt: Date | null;
  statusEventAt: Date | null;
  categoryEventAt: Date | null;
  /** Fetch-start time of the last authoritative sync or per-send fetch. Monotonic: never lowered. */
  reconciledAt: Date | null;
  /** Local counter incremented by EVERY write to the row (event, fetch, snapshot). Not a provider revision. */
  revision: number;
  version: number;
}

/** A template as fetched from Meta (authoritative). `id` is only used if the row has to be inserted. */
export interface FetchedTemplate {
  id: string;
  metaTemplateId: string;
  name: string;
  language: string;
  category: TemplateCategoryValue;
  components: unknown;
  status: TemplateStatus;
  rejectedReason: string | null;
  qualityScore: string | null;
}

export type TemplateEventResult = "applied" | "noop" | "stale" | "conflict" | "not_found";

/**
 * The verdict of one template event plus, when the winning compare-and-set wrote the row, the row exactly as that CAS
 * replaced it (`before`) and as it wrote it (`after`). A caller that needs the transition (the `status_changed`
 * event) takes it from here, never from a separate pre-read that a concurrent writer could make stale. `change` is
 * `null` for stale / noop (no write) / not_found; it is present for applied, conflict and a marker-only advance.
 */
export interface TemplateEventOutcome {
  result: TemplateEventResult;
  change: { before: TemplateRecord; after: TemplateRecord } | null;
}
export type TemplateFetchResult = "applied" | "raced" | "fence_newer";

export interface TemplateStatusChange {
  /** The stable local row id (the aggregate id of every template event of this row). */
  id: string;
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: TemplateCategoryValue;
  /** `null` when the row did not exist before. */
  from: TemplateStatus | null;
  to: TemplateStatus;
}

export interface TemplateSnapshotResult {
  /** Rows whose status actually changed (inserted rows count, from = null). */
  statusChanges: TemplateStatusChange[];
  /** Rows skipped because a local write landed after the fetch started. */
  raced: number;
  /** Rows skipped because a newer authoritative reconciliation already exists. */
  fenceNewer: number;
}

export interface TemplateRepository {
  list(tenantId: string, wabaId: string, tx?: unknown): Promise<TemplateRecord[]>;
  findByNameLanguage(
    tenantId: string,
    wabaId: string,
    name: string,
    language: string,
    tx?: unknown,
  ): Promise<TemplateRecord | null>;
  findByProviderId(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
    tx?: unknown,
  ): Promise<TemplateRecord | null>;
  /** Inserts a locally created template (version 1). Replay key: tenant + WABA + name + language. */
  insert(r: TemplateRecord, tx?: unknown): Promise<"inserted" | "duplicate">;
  /**
   * Atomic reconcile of one WABA against an authoritative fetch. Per row: raced when the stored revision differs from
   * its start revision, or the row has none. A supplied `revisionsByLocalId` (keyed by the stable local row id) is
   * COMPLETE and authoritative: the start revision is exactly its entry for the row, and a row it does not list (one
   * created after the fetch started) is raced, never judged by another row's revision. Only a caller that supplies no
   * local map is judged by `revisionsAtFetchStart` (keyed by the provider id the row carries). A row is skipped when
   * `reconciledAt > fetchStartedAt`, otherwise the snapshot values are applied with `reconciledAt = max(stored,
   * fetchStartedAt)` and `revision + 1`. A local row absent from the snapshot becomes `DELETED` only if its revision is
   * unchanged; an already `DELETED` absent row gets the same revision/fence check and refreshes `reconciledAt` and the
   * revision (a newer authoritative absence), reported as no status change.
   */
  replaceSnapshot(
    tenantId: string,
    wabaId: string,
    rows: FetchedTemplate[],
    fetch: {
      revisionsAtFetchStart: ReadonlyMap<string, number>;
      revisionsByLocalId?: ReadonlyMap<string, number>;
      fetchStartedAt: Date;
    },
    tx?: unknown,
  ): Promise<TemplateSnapshotResult>;
  /**
   * Same rule for one template (per-send fetch). A local row that no longer exists is reported as `raced`.
   * `stale` rules: `eventAt <= reconciledAt` or `eventAt < marker` of the kind; equal marker + same value → `noop`;
   * equal marker + different value → `conflict` (status UNKNOWN). `applied`/`conflict` increment `revision`.
   * A webhook NEVER moves a row out of `UNKNOWN`: a newer status event on an `UNKNOWN` row only advances its marker
   * (reported as `noop`); only `applyFetched` / `replaceSnapshot` clear `UNKNOWN`.
   */
  applyFetched(
    tenantId: string,
    wabaId: string,
    row: FetchedTemplate,
    fetch: { revisionAtFetchStart: number; fetchStartedAt: Date },
    tx?: unknown,
  ): Promise<TemplateFetchResult>;
  applyStatusEvent(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
    event: { status: TemplateStatus; reason: string | null; eventAt: Date },
    tx?: unknown,
  ): Promise<TemplateEventOutcome>;
  applyCategoryEvent(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
    event: { category: TemplateCategoryValue; eventAt: Date },
    tx?: unknown,
  ): Promise<TemplateEventOutcome>;
  /**
   * Re-creates a `DELETED` tombstone under a NEW provider id: the row is found by its scoped (tenant, WABA, name,
   * language) key AND its stable local `id`, must still be `DELETED` at `expectedRevision`, and is then rewritten in
   * place (same local id) with the new provider id, status, category and components. Its status/category event markers
   * are cleared (they belong to the old provider object) and its fence is raised to `at`. `raced` when the row is not
   * exactly that tombstone any more. Increments `revision`.
   */
  replaceTombstone(
    tenantId: string,
    wabaId: string,
    tombstone: { id: string; name: string; language: string; expectedRevision: number },
    row: FetchedTemplate,
    at: Date,
    tx?: unknown,
  ): Promise<"applied" | "raced">;
  /** Every language of `name` becomes `DELETED` (revision + 1). Already-deleted rows are untouched. */
  markDeletedByName(tenantId: string, wabaId: string, name: string, tx?: unknown): Promise<void>;
}

export type ConsentValue = "granted" | "revoked" | "unknown";
export type TransactionalConsentValue = "allowed" | "revoked" | "unknown";

export interface ContactRecord {
  id: string;
  tenantId: string;
  phoneE164: string | null;
  email: string | null;
  customerRef: string | null;
  displayName: string | null;
  whatsappMarketing: ConsentValue;
  whatsappTransactional: TransactionalConsentValue;
  emailMarketing: ConsentValue;
  lastInboundAt: Date | null;
  version: number;
}

export interface ConsentEventRecord {
  id: string;
  tenantId: string;
  contactId: string;
  channel: "whatsapp" | "email";
  purpose: "marketing" | "transactional";
  action: "grant" | "revoke";
  source: "admin" | "import" | "inbound_keyword" | "checkout" | "api";
  evidence: string | null;
  occurredAt: Date;
}

export interface ContactRepository {
  findByPhone(tenantId: string, e164: string, tx?: unknown): Promise<ContactRecord | null>;
  findByEmail(tenantId: string, email: string, tx?: unknown): Promise<ContactRecord | null>;
  findById(tenantId: string, id: string, tx?: unknown): Promise<ContactRecord | null>;
  /**
   * Identity columns only (phone, email, customerRef, displayName, lastInboundAt). It NEVER writes consent columns: a
   * created row starts at the defaults (`unknown`) and an update leaves consent untouched. A create that collides with
   * an existing row (id, phone or email) throws `ConcurrencyError` (the caller rereads the winner).
   */
  save(r: ContactRecord, expectedVersion: number, tx?: unknown): Promise<void>;
  /** Writes ONLY the three consent columns (use with a record produced by `applyConsent`). The row must exist. */
  saveConsent(r: ContactRecord, expectedVersion: number, tx?: unknown): Promise<void>;
  appendConsent(e: ConsentEventRecord, tx?: unknown): Promise<void>;
  /**
   * Sets `lastInboundAt = NULL` on every contact of the tenant that has one (the customer-service window opened on a
   * business number never applies to a different number). Tenant-scoped, bumps each touched row's version (so a
   * concurrent writer holding the old version loses its CAS), writes nothing else. Returns the number of rows cleared.
   */
  clearSessionWindows(tenantId: string, tx?: unknown): Promise<number>;
  /** Oldest first. */
  listConsentEvents(
    tenantId: string,
    contactId: string,
    tx?: unknown,
  ): Promise<ConsentEventRecord[]>;
}

export type OutboundChannel = "whatsapp" | "email";
export type OutboundKind = "template" | "session_text" | "session_interactive" | "email";
export type OutboundPurpose = "marketing" | "utility" | "transactional" | "authentication";

export interface OutboundRecord {
  id: string;
  tenantId: string;
  channel: OutboundChannel;
  kind: OutboundKind;
  contactId: string | null;
  recipient: string;
  templateName: string | null;
  templateLanguage: string | null;
  templateRevision: number | null;
  purpose: OutboundPurpose;
  payload: unknown;
  idempotencyKey: string;
  status: OutboundStatus;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  contextRef: string | null;
  acceptedAt: Date | null;
  correlationId: string;
  dispatchStartedAt: Date | null;
  providerIdempotencyKey: string | null;
  dispatchPhoneNumberId: string | null;
  dispatchWabaId: string | null;
  version: number;
}

export interface StatusEventRecord {
  id: string;
  tenantId: string;
  outboundMessageId: string;
  providerEventId: string;
  status: OutboundStatus;
  occurredAt: Date;
  raw: unknown;
}

export interface UnresolvedOutbound {
  tenantId: string;
  id: string;
  version: number;
}

export interface OutboundMessageRepository {
  findById(tenantId: string, id: string, tx?: unknown): Promise<OutboundRecord | null>;
  findByIdempotencyKey(tenantId: string, key: string, tx?: unknown): Promise<OutboundRecord | null>;
  findByProviderId(
    tenantId: string,
    providerMessageId: string,
    tx?: unknown,
  ): Promise<OutboundRecord | null>;
  findByCorrelationId(
    tenantId: string,
    correlationId: string,
    tx?: unknown,
  ): Promise<OutboundRecord | null>;
  /** Replay key: tenant + idempotencyKey. Any other unique conflict throws `Error("unexpected unique conflict")`. */
  insert(r: OutboundRecord, tx?: unknown): Promise<"inserted" | "duplicate">;
  /**
   * CAS on `version`. Writes ONLY status, providerMessageId, errorCode, errorMessage and acceptedAt; every other column
   * is fixed at insert. Throws `ConcurrencyError` on a miss.
   */
  update(r: OutboundRecord, expectedVersion: number, tx?: unknown): Promise<void>;
  /** Replay key: tenant + providerEventId. */
  recordStatusEvent(e: StatusEventRecord, tx?: unknown): Promise<"inserted" | "duplicate">;
  /** Tenant-scoped maintenance read: `pending` rows with `dispatchStartedAt < olderThan`, oldest first. */
  listUnresolved(
    tenantId: string,
    olderThan: Date,
    limit: number,
    tx?: unknown,
  ): Promise<UnresolvedOutbound[]>;
  /** `pending` → `unknown` only where tenant + id + `status = pending` + version match. Otherwise `skipped`. */
  markUnknownIfPending(
    tenantId: string,
    id: string,
    expectedVersion: number,
    tx?: unknown,
  ): Promise<"marked" | "skipped">;
}

export type InboundType = "text" | "button" | "interactive" | "image" | "other";

export interface InboundRecord {
  id: string;
  tenantId: string;
  contactId: string;
  providerMessageId: string;
  type: InboundType;
  text: string | null;
  buttonPayload: string | null;
  contextProviderMessageId: string | null;
  /** Provider timestamp. */
  occurredAt: Date;
  receivedAt: Date;
}

export interface InboundMessageRepository {
  /** Replay key: tenant + providerMessageId. */
  insert(r: InboundRecord, tx?: unknown): Promise<"inserted" | "duplicate">;
  findByProviderMessageId(
    tenantId: string,
    providerMessageId: string,
    tx?: unknown,
  ): Promise<InboundRecord | null>;
}

export interface UnmatchedStatusRecord {
  id: string;
  tenantId: string;
  phoneNumberId: string;
  providerEventId: string;
  providerMessageId: string;
  correlationId: string | null;
  status: OutboundStatus;
  occurredAt: Date;
  resolvedAt: Date | null;
}

export interface UnmatchedStatusRepository {
  /** Replay key: tenant + providerEventId. */
  put(e: UnmatchedStatusRecord, tx?: unknown): Promise<"inserted" | "duplicate">;
  /**
   * Returns (oldest first) and marks `resolvedAt` on the UNRESOLVED rows of this tenant AND this phone that match the
   * provider message id or the correlation id. With neither, it returns nothing. A row is taken once.
   */
  takeFor(
    tenantId: string,
    phoneNumberId: string,
    match: { providerMessageId?: string; correlationId?: string },
    tx?: unknown,
  ): Promise<UnmatchedStatusRecord[]>;
}

export interface EmailSendCounterRepository {
  /**
   * Atomic upsert-increment of the UTC hour and UTC day windows, guarded by the limits. Exceeding either window
   * (`count >= limit`) leaves BOTH unchanged; the hour cap is reported first. Call ONLY from the creator, in the same
   * `tx` as the outbound insert, after it returned `inserted`. Fails closed (throws, aborting the `tx`) when a window
   * row is missing after the seed or the increment does not touch exactly the two window rows.
   */
  reserve(
    tenantId: string,
    now: Date,
    limits: { perHour: number; perDay: number },
    tx: unknown,
  ): Promise<"reserved" | "hour_cap" | "day_cap">;
}

/** Every repository of the context, as wired by `wireOutreach` (Prisma or in-memory). */
export interface OutreachRepositories {
  connections: WhatsAppConnectionRepository;
  directory: PhoneDirectory;
  templates: TemplateRepository;
  contacts: ContactRepository;
  outbound: OutboundMessageRepository;
  inbound: InboundMessageRepository;
  unmatched: UnmatchedStatusRepository;
  emailCounters: EmailSendCounterRepository;
}

/** Thrown (as a plain `Error`) when a unique violation is not the intended replay key. */
export const UNEXPECTED_UNIQUE_CONFLICT = "unexpected unique conflict";
