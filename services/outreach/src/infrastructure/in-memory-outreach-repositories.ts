import type { Clock } from "@platform/contracts";
import { ConcurrencyError } from "@platform/utils";
import {
  UNEXPECTED_UNIQUE_CONFLICT,
  type ClaimResult,
  type ConsentEventRecord,
  type ContactRecord,
  type ContactRepository,
  type EmailSendCounterRepository,
  type FetchedTemplate,
  type InboundMessageRepository,
  type InboundRecord,
  type LeaseHolder,
  type OnboardingExpectation,
  type OutboundMessageRepository,
  type OutboundRecord,
  type PhoneDirectory,
  type StatusEventRecord,
  type TemplateCategoryValue,
  type TemplateEventResult,
  type TemplateFetchResult,
  type TemplateRecord,
  type TemplateRepository,
  type TemplateSnapshotResult,
  type TemplateStatus,
  type UnmatchedStatusRecord,
  type UnmatchedStatusRepository,
  type UnresolvedOutbound,
  type WhatsAppConnectionRecord,
  type WhatsAppConnectionRepository,
} from "../domain/repositories";
import {
  applyCategoryEventTo,
  applyFetchedTo,
  applyStatusEventTo,
  insertTemplateRow,
  patchedRow,
  reconcileSnapshotTo,
  type TemplateRowAccess,
} from "../domain/template-reconcile";
import {
  InMemoryOutreachTransaction,
  settle,
  transactionOf,
  type InMemoryOutreachStore,
} from "./in-memory-outreach-store";

const unexpectedConflict = (): Error => new Error(UNEXPECTED_UNIQUE_CONFLICT);

export class InMemoryWhatsAppConnectionRepository implements WhatsAppConnectionRepository {
  constructor(private readonly store: InMemoryOutreachStore) {}

  get(tenantId: string): Promise<WhatsAppConnectionRecord | null> {
    return settle(() => this.store.connections.get(tenantId) ?? null);
  }

  save(r: WhatsAppConnectionRecord, expectedVersion: number, tx?: unknown): Promise<void> {
    return settle(() => {
      const current = this.store.connections.get(r.tenantId);
      if (expectedVersion === 0) {
        if (current !== undefined)
          throw new ConcurrencyError(`Connection ${r.tenantId} already exists`);
      } else if (current === undefined || current.version !== expectedVersion) {
        throw new ConcurrencyError(`Connection ${r.tenantId} was modified concurrently`);
      }
      this.store.connections.set(
        r.tenantId,
        { ...r, version: expectedVersion + 1 },
        transactionOf(tx),
      );
    });
  }

  acquireOnboardingLease(
    next: WhatsAppConnectionRecord,
    expected: OnboardingExpectation | null,
    now: Date,
    tx?: unknown,
  ): Promise<void> {
    return settle(() => {
      if (
        next.onboardingLeaseOwner === null ||
        next.onboardingLeaseUntil === null ||
        next.onboardingLeaseUntil.getTime() <= now.getTime()
      ) {
        throw new Error("acquireOnboardingLease must install a lease (owner + expiry after now)");
      }
      const current = this.store.connections.get(next.tenantId);
      if (expected === null) {
        if (current !== undefined)
          throw new ConcurrencyError(`Connection ${next.tenantId} already exists`);
        this.store.connections.set(next.tenantId, { ...next, version: 1 }, transactionOf(tx));
        return;
      }
      const available =
        current !== undefined &&
        (current.onboardingLeaseUntil === null ||
          current.onboardingLeaseUntil.getTime() < now.getTime());
      if (current === undefined || !matchesExpectation(current, expected) || !available) {
        throw new ConcurrencyError(`Connection ${next.tenantId}: onboarding lease acquire lost`);
      }
      this.store.connections.set(
        next.tenantId,
        { ...next, version: expected.version + 1 },
        transactionOf(tx),
      );
    });
  }

  renewOnboardingLease(
    tenantId: string,
    holder: LeaseHolder,
    leaseUntil: Date,
    now: Date,
    tx?: unknown,
  ): Promise<void> {
    return settle(() => {
      const current = this.store.connections.get(tenantId);
      if (current === undefined || !holdsLease(current, holder, now)) {
        throw new ConcurrencyError(`Connection ${tenantId}: onboarding lease renew lost`);
      }
      this.store.connections.set(
        tenantId,
        { ...current, onboardingLeaseUntil: leaseUntil, version: holder.version + 1 },
        transactionOf(tx),
      );
    });
  }

  writeAsLeaseOwner(
    next: WhatsAppConnectionRecord,
    holder: LeaseHolder,
    now: Date,
    tx?: unknown,
  ): Promise<void> {
    return settle(() => {
      const current = this.store.connections.get(next.tenantId);
      if (current === undefined || !holdsLease(current, holder, now)) {
        throw new ConcurrencyError(
          `Connection ${next.tenantId}: onboarding lease owner write lost`,
        );
      }
      this.store.connections.set(
        next.tenantId,
        { ...next, version: holder.version + 1 },
        transactionOf(tx),
      );
    });
  }
}

const matchesExpectation = (row: WhatsAppConnectionRecord, e: OnboardingExpectation): boolean =>
  row.version === e.version &&
  row.onboardingStage === e.onboardingStage &&
  row.onboardingAttemptId === e.onboardingAttemptId &&
  row.phoneNumberId === e.phoneNumberId &&
  row.wabaId === e.wabaId;

/** `lease_owner = me AND lease_until > now`, evaluated at write time on top of the row shape. */
const holdsLease = (row: WhatsAppConnectionRecord, h: LeaseHolder, now: Date): boolean =>
  matchesExpectation(row, h) &&
  row.onboardingLeaseOwner === h.owner &&
  row.onboardingLeaseUntil !== null &&
  row.onboardingLeaseUntil.getTime() > now.getTime();

export class InMemoryPhoneDirectory implements PhoneDirectory {
  /** `platformTenantId` mirrors the Prisma twin: every row of the directory carries the platform scope. */
  constructor(
    private readonly store: InMemoryOutreachStore,
    private readonly platformTenantId: string,
  ) {}

  private rows() {
    return this.store.directory.values().filter((r) => r.tenantId === this.platformTenantId);
  }

  find(phoneNumberId: string): Promise<{ shopTenantId: string; wabaId: string } | null> {
    return settle(() => {
      const row = this.rows().find((r) => r.phoneNumberId === phoneNumberId);
      return row === undefined ? null : { shopTenantId: row.shopTenantId, wabaId: row.wabaId };
    });
  }

  findByWaba(wabaId: string): Promise<{ shopTenantId: string; phoneNumberId: string } | null> {
    return settle(() => {
      const row = this.rows().find((r) => r.wabaId === wabaId);
      return row === undefined
        ? null
        : { shopTenantId: row.shopTenantId, phoneNumberId: row.phoneNumberId };
    });
  }

  findByShop(shopTenantId: string): Promise<{ phoneNumberId: string; wabaId: string } | null> {
    return settle(() => {
      const row = this.rows().find((r) => r.shopTenantId === shopTenantId);
      return row === undefined ? null : { phoneNumberId: row.phoneNumberId, wabaId: row.wabaId };
    });
  }

  claim(
    phoneNumberId: string,
    wabaId: string,
    shopTenantId: string,
    tx?: unknown,
  ): Promise<ClaimResult> {
    return settle(() => {
      const joined = transactionOf(tx);
      // Standalone: an owned (synchronous, hence atomic) transaction that is undone on a non-claim.
      const t = joined ?? new InMemoryOutreachTransaction(undefined);
      const result = this.claimIn(t, phoneNumberId, wabaId, shopTenantId);
      if (joined === undefined && result !== "claimed") for (const undo of t.undo.reverse()) undo();
      return result;
    });
  }

  private claimIn(
    t: InMemoryOutreachTransaction,
    phoneNumberId: string,
    wabaId: string,
    shopTenantId: string,
  ): ClaimResult {
    {
      const mine = this.rows().find((r) => r.shopTenantId === shopTenantId);
      if (mine !== undefined && !(mine.phoneNumberId === phoneNumberId && mine.wabaId === wabaId)) {
        this.store.directory.delete(mine.phoneNumberId, t);
      }
      const clash = this.rows().some(
        (r) =>
          r.phoneNumberId === phoneNumberId ||
          r.wabaId === wabaId ||
          r.shopTenantId === shopTenantId,
      );
      if (!clash) {
        this.store.directory.set(
          phoneNumberId,
          { tenantId: this.platformTenantId, phoneNumberId, shopTenantId, wabaId },
          t,
        );
      }
      const phoneRow = this.rows().find((r) => r.phoneNumberId === phoneNumberId);
      const wabaRow = this.rows().find((r) => r.wabaId === wabaId);
      if (
        phoneRow !== undefined &&
        phoneRow.shopTenantId === shopTenantId &&
        phoneRow.wabaId === wabaId &&
        wabaRow !== undefined &&
        wabaRow.shopTenantId === shopTenantId
      ) {
        return "claimed";
      }
      if (phoneRow === undefined && wabaRow !== undefined) return "waba_in_use";
      if (
        phoneRow !== undefined &&
        phoneRow.shopTenantId === shopTenantId &&
        phoneRow.wabaId === wabaId
      ) {
        return "waba_in_use";
      }
      return "phone_in_use";
    }
  }

  release(phoneNumberId: string, shopTenantId: string, tx?: unknown): Promise<void> {
    return settle(() => {
      const row = this.rows().find(
        (r) => r.phoneNumberId === phoneNumberId && r.shopTenantId === shopTenantId,
      );
      if (row !== undefined) this.store.directory.delete(row.phoneNumberId, transactionOf(tx));
    });
  }
}

export class InMemoryTemplateRepository implements TemplateRepository {
  constructor(private readonly store: InMemoryOutreachStore) {}

  private scope(tenantId: string, wabaId: string): TemplateRecord[] {
    return this.store.templates
      .values()
      .filter((t) => t.tenantId === tenantId && t.wabaId === wabaId)
      .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
  }

  private nameClash(t: TemplateRecord): boolean {
    return this.scope(t.tenantId, t.wabaId).some(
      (x) => x.name === t.name && x.language === t.language,
    );
  }

  private access(tenantId: string, wabaId: string, tx: unknown): TemplateRowAccess {
    const t = transactionOf(tx);
    return {
      list: () => settle(() => this.scope(tenantId, wabaId)),
      findByMetaId: (id) =>
        settle(() => this.scope(tenantId, wabaId).find((x) => x.metaTemplateId === id) ?? null),
      findByNameLanguage: (name, language) =>
        settle(
          () =>
            this.scope(tenantId, wabaId).find((x) => x.name === name && x.language === language) ??
            null,
        ),
      insert: (row) =>
        settle(() => {
          if (this.store.templates.get(row.id) !== undefined || this.nameClash(row)) return false;
          this.store.templates.set(row.id, { ...row, version: 1 }, t);
          return true;
        }),
      update: (current, patch) =>
        settle(() => {
          const stored = this.store.templates.get(current.id);
          if (stored === undefined || stored.revision !== current.revision) return false;
          this.store.templates.set(current.id, patchedRow(stored, patch), t);
          return true;
        }),
    };
  }

  list(tenantId: string, wabaId: string): Promise<TemplateRecord[]> {
    return settle(() => this.scope(tenantId, wabaId));
  }

  findByNameLanguage(
    tenantId: string,
    wabaId: string,
    name: string,
    language: string,
  ): Promise<TemplateRecord | null> {
    return settle(
      () =>
        this.scope(tenantId, wabaId).find((t) => t.name === name && t.language === language) ??
        null,
    );
  }

  findByProviderId(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
  ): Promise<TemplateRecord | null> {
    return settle(
      () => this.scope(tenantId, wabaId).find((t) => t.metaTemplateId === metaTemplateId) ?? null,
    );
  }

  insert(r: TemplateRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return insertTemplateRow(this.access(r.tenantId, r.wabaId, tx), r);
  }

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
  ): Promise<TemplateSnapshotResult> {
    // Multi-step write: joins the caller's transaction or runs in its own, rolled back if any row throws.
    return this.store.owned(tx, (t) =>
      reconcileSnapshotTo(this.access(tenantId, wabaId, t), { tenantId, wabaId }, rows, fetch),
    );
  }

  applyFetched(
    tenantId: string,
    wabaId: string,
    row: FetchedTemplate,
    fetch: { revisionAtFetchStart: number; fetchStartedAt: Date },
    tx?: unknown,
  ): Promise<TemplateFetchResult> {
    return applyFetchedTo(this.access(tenantId, wabaId, tx), row, fetch);
  }

  applyStatusEvent(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
    event: { status: TemplateStatus; reason: string | null; eventAt: Date },
    tx?: unknown,
  ): Promise<TemplateEventResult> {
    return applyStatusEventTo(this.access(tenantId, wabaId, tx), metaTemplateId, event);
  }

  applyCategoryEvent(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
    event: { category: TemplateCategoryValue; eventAt: Date },
    tx?: unknown,
  ): Promise<TemplateEventResult> {
    return applyCategoryEventTo(this.access(tenantId, wabaId, tx), metaTemplateId, event);
  }

  markDeletedByName(tenantId: string, wabaId: string, name: string, tx?: unknown): Promise<void> {
    return settle(() => {
      for (const row of this.scope(tenantId, wabaId)) {
        if (row.name !== name || row.status === "DELETED") continue;
        this.store.templates.set(row.id, patchedRow(row, { status: "DELETED" }), transactionOf(tx));
      }
    });
  }
}

const CONSENT_DEFAULTS = {
  whatsappMarketing: "unknown",
  whatsappTransactional: "unknown",
  emailMarketing: "unknown",
} as const;

export class InMemoryContactRepository implements ContactRepository {
  constructor(private readonly store: InMemoryOutreachStore) {}

  private scope(tenantId: string): ContactRecord[] {
    return this.store.contacts.values().filter((c) => c.tenantId === tenantId);
  }

  findByPhone(tenantId: string, e164: string): Promise<ContactRecord | null> {
    return settle(() => this.scope(tenantId).find((c) => c.phoneE164 === e164) ?? null);
  }

  findByEmail(tenantId: string, email: string): Promise<ContactRecord | null> {
    return settle(() => this.scope(tenantId).find((c) => c.email === email) ?? null);
  }

  findById(tenantId: string, id: string): Promise<ContactRecord | null> {
    return settle(() => this.scope(tenantId).find((c) => c.id === id) ?? null);
  }

  save(r: ContactRecord, expectedVersion: number, tx?: unknown): Promise<void> {
    return settle(() => {
      const t = transactionOf(tx);
      const others = this.scope(r.tenantId).filter((c) => c.id !== r.id);
      const identityClash = others.some(
        (c) =>
          (r.phoneE164 !== null && c.phoneE164 === r.phoneE164) ||
          (r.email !== null && c.email === r.email),
      );
      if (expectedVersion === 0) {
        const sameTenantWinner = identityClash || this.scope(r.tenantId).some((c) => c.id === r.id);
        if (sameTenantWinner) {
          throw new ConcurrencyError(`Contact ${r.id} collides with an existing contact`);
        }
        // A UUID already used by ANOTHER tenant is a global PK collision with no winner in this tenant.
        if (this.store.contacts.get(r.id) !== undefined) throw unexpectedConflict();
        this.store.contacts.set(r.id, { ...r, ...CONSENT_DEFAULTS, version: 1 }, t);
        return;
      }
      const current = this.scope(r.tenantId).find((c) => c.id === r.id);
      if (current === undefined || current.version !== expectedVersion) {
        throw new ConcurrencyError(`Contact ${r.id} was modified concurrently`);
      }
      if (identityClash) throw new Error("unique constraint violated: contact identity");
      this.store.contacts.set(
        r.id,
        {
          ...current,
          phoneE164: r.phoneE164,
          email: r.email,
          customerRef: r.customerRef,
          displayName: r.displayName,
          lastInboundAt: r.lastInboundAt,
          version: expectedVersion + 1,
        },
        t,
      );
    });
  }

  saveConsent(r: ContactRecord, expectedVersion: number, tx?: unknown): Promise<void> {
    return settle(() => {
      const current = this.scope(r.tenantId).find((c) => c.id === r.id);
      if (current === undefined || current.version !== expectedVersion) {
        throw new ConcurrencyError(`Contact ${r.id} was modified concurrently`);
      }
      this.store.contacts.set(
        r.id,
        {
          ...current,
          whatsappMarketing: r.whatsappMarketing,
          whatsappTransactional: r.whatsappTransactional,
          emailMarketing: r.emailMarketing,
          version: expectedVersion + 1,
        },
        transactionOf(tx),
      );
    });
  }

  appendConsent(e: ConsentEventRecord, tx?: unknown): Promise<void> {
    return settle(() => {
      if (this.store.consentEvents.get(e.id) !== undefined) throw unexpectedConflict();
      this.store.consentEvents.set(e.id, e, transactionOf(tx));
    });
  }

  listConsentEvents(tenantId: string, contactId: string): Promise<ConsentEventRecord[]> {
    return settle(() =>
      this.store.consentEvents
        .values()
        .filter((e) => e.tenantId === tenantId && e.contactId === contactId)
        .sort(
          (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
        ),
    );
  }
}

export class InMemoryOutboundMessageRepository implements OutboundMessageRepository {
  constructor(private readonly store: InMemoryOutreachStore) {}

  private scope(tenantId: string): OutboundRecord[] {
    return this.store.outbound.values().filter((o) => o.tenantId === tenantId);
  }

  findById(tenantId: string, id: string): Promise<OutboundRecord | null> {
    return settle(() => this.scope(tenantId).find((o) => o.id === id) ?? null);
  }

  findByIdempotencyKey(tenantId: string, key: string): Promise<OutboundRecord | null> {
    return settle(() => this.scope(tenantId).find((o) => o.idempotencyKey === key) ?? null);
  }

  findByProviderId(tenantId: string, providerMessageId: string): Promise<OutboundRecord | null> {
    return settle(
      () => this.scope(tenantId).find((o) => o.providerMessageId === providerMessageId) ?? null,
    );
  }

  findByCorrelationId(tenantId: string, correlationId: string): Promise<OutboundRecord | null> {
    return settle(
      () => this.scope(tenantId).find((o) => o.correlationId === correlationId) ?? null,
    );
  }

  insert(r: OutboundRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return settle(() => {
      const mine = this.scope(r.tenantId);
      const clash =
        this.store.outbound.get(r.id) !== undefined ||
        mine.some(
          (o) => o.idempotencyKey === r.idempotencyKey || o.correlationId === r.correlationId,
        );
      if (!clash) {
        this.store.outbound.set(r.id, { ...r, version: 1 }, transactionOf(tx));
        return "inserted";
      }
      if (mine.some((o) => o.idempotencyKey === r.idempotencyKey)) return "duplicate";
      throw unexpectedConflict();
    });
  }

  update(r: OutboundRecord, expectedVersion: number, tx?: unknown): Promise<void> {
    return settle(() => {
      const current = this.scope(r.tenantId).find((o) => o.id === r.id);
      if (current === undefined || current.version !== expectedVersion) {
        throw new ConcurrencyError(`Outbound ${r.id} was modified concurrently`);
      }
      this.store.outbound.set(
        r.id,
        {
          ...current,
          status: r.status,
          providerMessageId: r.providerMessageId,
          errorCode: r.errorCode,
          errorMessage: r.errorMessage,
          acceptedAt: r.acceptedAt,
          version: expectedVersion + 1,
        },
        transactionOf(tx),
      );
    });
  }

  recordStatusEvent(e: StatusEventRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return settle(() => {
      const mine = this.store.statusEvents.values().filter((x) => x.tenantId === e.tenantId);
      const clash =
        this.store.statusEvents.get(e.id) !== undefined ||
        mine.some((x) => x.providerEventId === e.providerEventId);
      if (!clash) {
        this.store.statusEvents.set(e.id, e, transactionOf(tx));
        return "inserted";
      }
      if (mine.some((x) => x.providerEventId === e.providerEventId)) return "duplicate";
      throw unexpectedConflict();
    });
  }

  listUnresolved(tenantId: string, olderThan: Date, limit: number): Promise<UnresolvedOutbound[]> {
    return settle(() =>
      this.scope(tenantId)
        .filter(
          (o) =>
            o.status === "pending" &&
            o.dispatchStartedAt !== null &&
            o.dispatchStartedAt.getTime() < olderThan.getTime(),
        )
        .sort(
          (a, b) =>
            (a.dispatchStartedAt?.getTime() ?? 0) - (b.dispatchStartedAt?.getTime() ?? 0) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, Math.max(0, limit))
        .map((o) => ({ tenantId: o.tenantId, id: o.id, version: o.version })),
    );
  }

  markUnknownIfPending(
    tenantId: string,
    id: string,
    expectedVersion: number,
    tx?: unknown,
  ): Promise<"marked" | "skipped"> {
    return settle(() => {
      const current = this.scope(tenantId).find((o) => o.id === id);
      if (
        current === undefined ||
        current.status !== "pending" ||
        current.version !== expectedVersion
      ) {
        return "skipped";
      }
      this.store.outbound.set(
        id,
        { ...current, status: "unknown", version: expectedVersion + 1 },
        transactionOf(tx),
      );
      return "marked";
    });
  }
}

export class InMemoryInboundMessageRepository implements InboundMessageRepository {
  constructor(private readonly store: InMemoryOutreachStore) {}

  insert(r: InboundRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return settle(() => {
      const mine = this.store.inbound.values().filter((x) => x.tenantId === r.tenantId);
      const sameKey = mine.some((x) => x.providerMessageId === r.providerMessageId);
      if (!sameKey && this.store.inbound.get(r.id) === undefined) {
        this.store.inbound.set(r.id, r, transactionOf(tx));
        return "inserted";
      }
      if (sameKey) return "duplicate";
      throw unexpectedConflict();
    });
  }

  findByProviderMessageId(
    tenantId: string,
    providerMessageId: string,
  ): Promise<InboundRecord | null> {
    return settle(
      () =>
        this.store.inbound
          .values()
          .find((x) => x.tenantId === tenantId && x.providerMessageId === providerMessageId) ??
        null,
    );
  }
}

export class InMemoryUnmatchedStatusRepository implements UnmatchedStatusRepository {
  constructor(
    private readonly store: InMemoryOutreachStore,
    private readonly clock: Clock,
  ) {}

  put(e: UnmatchedStatusRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return settle(() => {
      const mine = this.store.unmatched.values().filter((x) => x.tenantId === e.tenantId);
      const sameKey = mine.some((x) => x.providerEventId === e.providerEventId);
      if (!sameKey && this.store.unmatched.get(e.id) === undefined) {
        this.store.unmatched.set(e.id, e, transactionOf(tx));
        return "inserted";
      }
      if (sameKey) return "duplicate";
      throw unexpectedConflict();
    });
  }

  takeFor(
    tenantId: string,
    phoneNumberId: string,
    match: { providerMessageId?: string; correlationId?: string },
    tx?: unknown,
  ): Promise<UnmatchedStatusRecord[]> {
    return settle(() => {
      const { providerMessageId, correlationId } = match;
      if (providerMessageId === undefined && correlationId === undefined) return [];
      const now = this.clock.now();
      const taken = this.store.unmatched
        .values()
        .filter(
          (x) =>
            x.tenantId === tenantId &&
            x.phoneNumberId === phoneNumberId &&
            x.resolvedAt === null &&
            ((providerMessageId !== undefined && x.providerMessageId === providerMessageId) ||
              (correlationId !== undefined && x.correlationId === correlationId)),
        )
        .sort(
          (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
        );
      return taken.map((x) => {
        const resolved = { ...x, resolvedAt: now };
        this.store.unmatched.set(x.id, resolved, transactionOf(tx));
        return resolved;
      });
    });
  }
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export class InMemoryEmailSendCounterRepository implements EmailSendCounterRepository {
  constructor(private readonly store: InMemoryOutreachStore) {}

  reserve(
    tenantId: string,
    now: Date,
    limits: { perHour: number; perDay: number },
    tx: unknown,
  ): Promise<"reserved" | "hour_cap" | "day_cap"> {
    return settle(() => {
      const t = transactionOf(tx);
      if (t === undefined) {
        throw new Error(
          "EmailSendCounterRepository.reserve requires the unit of work's transaction client",
        );
      }
      const hourKey = `${tenantId}|hour|${Math.floor(now.getTime() / HOUR_MS) * HOUR_MS}`;
      const dayKey = `${tenantId}|day|${Math.floor(now.getTime() / DAY_MS) * DAY_MS}`;
      // 1. seed both window rows (a no-op when they exist), like the Prisma twin
      if (this.store.emailCounters.get(hourKey) === undefined)
        this.store.emailCounters.set(hourKey, 0, t);
      if (this.store.emailCounters.get(dayKey) === undefined)
        this.store.emailCounters.set(dayKey, 0, t);
      const hour = this.store.emailCounters.get(hourKey);
      const day = this.store.emailCounters.get(dayKey);
      if (hour === undefined || day === undefined) {
        throw new Error("email send counter rows are missing after the seed");
      }
      if (hour >= limits.perHour) return "hour_cap";
      if (day >= limits.perDay) return "day_cap";
      this.store.emailCounters.set(hourKey, hour + 1, t);
      this.store.emailCounters.set(dayKey, day + 1, t);
      return "reserved";
    });
  }
}
