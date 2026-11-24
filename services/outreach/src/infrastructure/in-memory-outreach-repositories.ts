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
  type TemplateEventOutcome,
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
  replaceTombstoneTo,
  type TemplateRowAccess,
} from "../domain/template-reconcile";
import {
  settle,
  type InMemoryOutreachStore,
  type InMemoryOutreachTransaction,
} from "./in-memory-outreach-store";

const unexpectedConflict = (): Error => new Error(UNEXPECTED_UNIQUE_CONFLICT);

export class InMemoryWhatsAppConnectionRepository implements WhatsAppConnectionRepository {
  /**
   * `clock` stands in for the database wall clock: every lease operation samples it INSIDE the store's gate, when the
   * mutation executes, never from a value the caller read earlier.
   */
  constructor(
    private readonly store: InMemoryOutreachStore,
    private readonly clock: Clock,
  ) {}

  get(tenantId: string, tx?: unknown): Promise<WhatsAppConnectionRecord | null> {
    return this.store.access(tx, () => this.store.connections.get(tenantId) ?? null);
  }

  save(r: WhatsAppConnectionRecord, expectedVersion: number, tx?: unknown): Promise<void> {
    return this.store.access(tx, (t) => {
      const current = this.store.connections.get(r.tenantId);
      if (expectedVersion === 0) {
        if (current !== undefined)
          throw new ConcurrencyError(`Connection ${r.tenantId} already exists`);
      } else if (current === undefined || current.version !== expectedVersion) {
        throw new ConcurrencyError(`Connection ${r.tenantId} was modified concurrently`);
      }
      this.store.connections.set(r.tenantId, { ...r, version: expectedVersion + 1 }, t);
    });
  }

  acquireOnboardingLease(
    next: WhatsAppConnectionRecord,
    expected: OnboardingExpectation | null,
    leaseMs: number,
    tx?: unknown,
  ): Promise<void> {
    return this.store.access(tx, (t) => {
      if (next.onboardingLeaseOwner === null || !validLeaseMs(leaseMs)) {
        throw new Error(LEASE_REQUIRED);
      }
      const now = this.clock.now();
      const until = new Date(now.getTime() + leaseMs);
      const current = this.store.connections.get(next.tenantId);
      if (expected === null) {
        if (current !== undefined)
          throw new ConcurrencyError(`Connection ${next.tenantId} already exists`);
        this.store.connections.set(
          next.tenantId,
          { ...next, onboardingLeaseUntil: until, version: 1 },
          t,
        );
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
        { ...next, onboardingLeaseUntil: until, version: expected.version + 1 },
        t,
      );
    });
  }

  renewOnboardingLease(
    tenantId: string,
    holder: LeaseHolder,
    leaseMs: number,
    tx?: unknown,
  ): Promise<void> {
    return this.store.access(tx, (t) => {
      const now = this.clock.now();
      const current = this.store.connections.get(tenantId);
      if (!validLeaseMs(leaseMs) || current === undefined || !holdsLease(current, holder, now)) {
        throw new ConcurrencyError(`Connection ${tenantId}: onboarding lease renew lost`);
      }
      this.store.connections.set(
        tenantId,
        {
          ...current,
          onboardingLeaseUntil: new Date(now.getTime() + leaseMs),
          version: holder.version + 1,
        },
        t,
      );
    });
  }

  writeAsLeaseOwner(
    next: WhatsAppConnectionRecord,
    holder: LeaseHolder,
    leaseMs: number,
    tx?: unknown,
  ): Promise<void> {
    return this.store.access(tx, (t) => {
      const now = this.clock.now();
      const current = this.store.connections.get(next.tenantId);
      if (current === undefined || !holdsLease(current, holder, now)) {
        throw new ConcurrencyError(
          `Connection ${next.tenantId}: onboarding lease owner write lost`,
        );
      }
      // keeping the lease re-derives the deadline from the clock at THIS write; a release clears it
      const keeps = next.onboardingLeaseOwner !== null;
      if (keeps && !validLeaseMs(leaseMs)) {
        throw new ConcurrencyError(
          `Connection ${next.tenantId}: onboarding lease owner write lost`,
        );
      }
      this.store.connections.set(
        next.tenantId,
        {
          ...next,
          onboardingLeaseUntil: keeps ? new Date(now.getTime() + leaseMs) : null,
          version: holder.version + 1,
        },
        t,
      );
    });
  }
}

const LEASE_REQUIRED =
  "acquireOnboardingLease must install a lease (an owner and a positive, finite lease length)";

const validLeaseMs = (leaseMs: number): boolean => Number.isFinite(leaseMs) && leaseMs > 0;

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

const noFenceTx = (): Error =>
  new Error("a directory fence needs the caller's unit-of-work transaction");

export class InMemoryPhoneDirectory implements PhoneDirectory {
  /** `platformTenantId` mirrors the Prisma twin: every row of the directory carries the platform scope. */
  constructor(
    private readonly store: InMemoryOutreachStore,
    private readonly platformTenantId: string,
  ) {}

  private rows() {
    return this.store.directory.values().filter((r) => r.tenantId === this.platformTenantId);
  }

  find(
    phoneNumberId: string,
    tx?: unknown,
  ): Promise<{ shopTenantId: string; wabaId: string } | null> {
    return this.store.access(tx, () => {
      const row = this.rows().find((r) => r.phoneNumberId === phoneNumberId);
      return row === undefined ? null : { shopTenantId: row.shopTenantId, wabaId: row.wabaId };
    });
  }

  findByWaba(
    wabaId: string,
    tx?: unknown,
  ): Promise<{ shopTenantId: string; phoneNumberId: string } | null> {
    return this.store.access(tx, () => {
      const row = this.rows().find((r) => r.wabaId === wabaId);
      return row === undefined
        ? null
        : { shopTenantId: row.shopTenantId, phoneNumberId: row.phoneNumberId };
    });
  }

  findByShop(
    shopTenantId: string,
    tx?: unknown,
  ): Promise<{ phoneNumberId: string; wabaId: string } | null> {
    return this.store.access(tx, () => {
      const row = this.rows().find((r) => r.shopTenantId === shopTenantId);
      return row === undefined ? null : { phoneNumberId: row.phoneNumberId, wabaId: row.wabaId };
    });
  }

  // The in-memory unit of work serialises every transaction, so reading inside it IS the fence.
  fencePhone(
    phoneNumberId: string,
    tx: unknown,
  ): Promise<{ shopTenantId: string; wabaId: string } | null> {
    return tx === undefined || tx === null
      ? Promise.reject(noFenceTx())
      : this.find(phoneNumberId, tx);
  }

  fenceWaba(
    wabaId: string,
    tx: unknown,
  ): Promise<{ shopTenantId: string; phoneNumberId: string } | null> {
    return tx === undefined || tx === null
      ? Promise.reject(noFenceTx())
      : this.findByWaba(wabaId, tx);
  }

  claim(
    phoneNumberId: string,
    wabaId: string,
    shopTenantId: string,
    tx?: unknown,
  ): Promise<ClaimResult> {
    return this.store.access(tx, (t, standalone) => {
      const result = this.claimIn(t, phoneNumberId, wabaId, shopTenantId);
      // Standalone: the owned transaction is undone on a non-claim (a joined one is rolled back by its caller).
      if (standalone && result !== "claimed") t.rollback();
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
    return this.store.access(tx, (t) => {
      const row = this.rows().find(
        (r) => r.phoneNumberId === phoneNumberId && r.shopTenantId === shopTenantId,
      );
      if (row !== undefined) this.store.directory.delete(row.phoneNumberId, t);
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

  /** Row access INSIDE a gated section: `t` is the live transaction, so nothing here takes the gate again. */
  private access(
    tenantId: string,
    wabaId: string,
    t: InMemoryOutreachTransaction,
  ): TemplateRowAccess {
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

  list(tenantId: string, wabaId: string, tx?: unknown): Promise<TemplateRecord[]> {
    return this.store.access(tx, () => this.scope(tenantId, wabaId));
  }

  findByNameLanguage(
    tenantId: string,
    wabaId: string,
    name: string,
    language: string,
    tx?: unknown,
  ): Promise<TemplateRecord | null> {
    return this.store.access(
      tx,
      () =>
        this.scope(tenantId, wabaId).find((t) => t.name === name && t.language === language) ??
        null,
    );
  }

  findByProviderId(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
    tx?: unknown,
  ): Promise<TemplateRecord | null> {
    return this.store.access(
      tx,
      () => this.scope(tenantId, wabaId).find((t) => t.metaTemplateId === metaTemplateId) ?? null,
    );
  }

  insert(r: TemplateRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return this.store.owned(tx, (t) => insertTemplateRow(this.access(r.tenantId, r.wabaId, t), r));
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
    return this.store.owned(tx, (t) =>
      applyFetchedTo(this.access(tenantId, wabaId, t), row, fetch),
    );
  }

  applyStatusEvent(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
    event: { status: TemplateStatus; reason: string | null; eventAt: Date },
    tx?: unknown,
  ): Promise<TemplateEventOutcome> {
    return this.store.owned(tx, (t) =>
      applyStatusEventTo(this.access(tenantId, wabaId, t), metaTemplateId, event),
    );
  }

  applyCategoryEvent(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
    event: { category: TemplateCategoryValue; eventAt: Date },
    tx?: unknown,
  ): Promise<TemplateEventOutcome> {
    return this.store.owned(tx, (t) =>
      applyCategoryEventTo(this.access(tenantId, wabaId, t), metaTemplateId, event),
    );
  }

  replaceTombstone(
    tenantId: string,
    wabaId: string,
    tombstone: { id: string; name: string; language: string; expectedRevision: number },
    row: FetchedTemplate,
    at: Date,
    tx?: unknown,
  ): Promise<"applied" | "raced"> {
    return this.store.owned(tx, (t) =>
      replaceTombstoneTo(this.access(tenantId, wabaId, t), tombstone, row, at),
    );
  }

  markDeletedByName(tenantId: string, wabaId: string, name: string, tx?: unknown): Promise<void> {
    return this.store.access(tx, (t) => {
      for (const row of this.scope(tenantId, wabaId)) {
        if (row.name !== name || row.status === "DELETED") continue;
        this.store.templates.set(row.id, patchedRow(row, { status: "DELETED" }), t);
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

  findByPhone(tenantId: string, e164: string, tx?: unknown): Promise<ContactRecord | null> {
    return this.store.access(
      tx,
      () => this.scope(tenantId).find((c) => c.phoneE164 === e164) ?? null,
    );
  }

  findByEmail(tenantId: string, email: string, tx?: unknown): Promise<ContactRecord | null> {
    return this.store.access(tx, () => this.scope(tenantId).find((c) => c.email === email) ?? null);
  }

  findById(tenantId: string, id: string, tx?: unknown): Promise<ContactRecord | null> {
    return this.store.access(tx, () => this.scope(tenantId).find((c) => c.id === id) ?? null);
  }

  save(r: ContactRecord, expectedVersion: number, tx?: unknown): Promise<void> {
    return this.store.access(tx, (t) => {
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
    return this.store.access(tx, (t) => {
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
        t,
      );
    });
  }

  appendConsent(e: ConsentEventRecord, tx?: unknown): Promise<void> {
    return this.store.access(tx, (t) => {
      if (this.store.consentEvents.get(e.id) !== undefined) throw unexpectedConflict();
      this.store.consentEvents.set(e.id, e, t);
    });
  }

  async appendConsentOnce(
    e: ConsentEventRecord,
    operationKey: string,
    tx?: unknown,
  ): Promise<"appended" | "duplicate"> {
    // The twin of the unique index: a concurrent first use of the key waits until the other transaction ends.
    if (this.store.isLive(tx)) {
      await this.store.lockKey(tx, JSON.stringify(["consent-operation", e.tenantId, operationKey]));
    }
    return this.store.access(tx, (t) => {
      const taken = this.store.consentEvents
        .values()
        .some((x) => x.tenantId === e.tenantId && x.operationKey === operationKey);
      if (taken) return "duplicate";
      if (this.store.consentEvents.get(e.id) !== undefined) throw unexpectedConflict();
      this.store.consentEvents.set(e.id, { ...e, operationKey }, t);
      return "appended";
    });
  }

  findConsentByOperation(
    tenantId: string,
    operationKey: string,
    tx?: unknown,
  ): Promise<ConsentEventRecord | null> {
    return this.store.access(
      tx,
      () =>
        this.store.consentEvents
          .values()
          .find((x) => x.tenantId === tenantId && x.operationKey === operationKey) ?? null,
    );
  }

  clearSessionWindows(tenantId: string, tx?: unknown): Promise<number> {
    return this.store.access(tx, (t) => {
      let cleared = 0;
      for (const c of this.store.contacts.values()) {
        if (c.tenantId !== tenantId || c.lastInboundAt === null) continue;
        this.store.contacts.set(c.id, { ...c, lastInboundAt: null, version: c.version + 1 }, t);
        cleared += 1;
      }
      return cleared;
    });
  }

  listConsentEvents(
    tenantId: string,
    contactId: string,
    tx?: unknown,
  ): Promise<ConsentEventRecord[]> {
    return this.store.access(tx, () =>
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

  findById(tenantId: string, id: string, tx?: unknown): Promise<OutboundRecord | null> {
    return this.store.access(tx, () => this.scope(tenantId).find((o) => o.id === id) ?? null);
  }

  findByIdempotencyKey(
    tenantId: string,
    key: string,
    tx?: unknown,
  ): Promise<OutboundRecord | null> {
    return this.store.access(
      tx,
      () => this.scope(tenantId).find((o) => o.idempotencyKey === key) ?? null,
    );
  }

  findByProviderId(
    tenantId: string,
    providerMessageId: string,
    tx?: unknown,
  ): Promise<OutboundRecord | null> {
    return this.store.access(
      tx,
      () => this.scope(tenantId).find((o) => o.providerMessageId === providerMessageId) ?? null,
    );
  }

  findByCorrelationId(
    tenantId: string,
    correlationId: string,
    tx?: unknown,
  ): Promise<OutboundRecord | null> {
    return this.store.access(
      tx,
      () => this.scope(tenantId).find((o) => o.correlationId === correlationId) ?? null,
    );
  }

  insert(r: OutboundRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return this.store.access(tx, (t) => {
      const mine = this.scope(r.tenantId);
      const clash =
        this.store.outbound.get(r.id) !== undefined ||
        mine.some(
          (o) => o.idempotencyKey === r.idempotencyKey || o.correlationId === r.correlationId,
        );
      if (!clash) {
        this.store.outbound.set(r.id, { ...r, version: 1 }, t);
        return "inserted";
      }
      if (mine.some((o) => o.idempotencyKey === r.idempotencyKey)) return "duplicate";
      throw unexpectedConflict();
    });
  }

  update(r: OutboundRecord, expectedVersion: number, tx?: unknown): Promise<void> {
    return this.store.access(tx, (t) => {
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
        t,
      );
    });
  }

  recordStatusEvent(e: StatusEventRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return this.store.access(tx, (t) => {
      const mine = this.store.statusEvents.values().filter((x) => x.tenantId === e.tenantId);
      const clash =
        this.store.statusEvents.get(e.id) !== undefined ||
        mine.some((x) => x.providerEventId === e.providerEventId);
      if (!clash) {
        this.store.statusEvents.set(e.id, e, t);
        return "inserted";
      }
      if (mine.some((x) => x.providerEventId === e.providerEventId)) return "duplicate";
      throw unexpectedConflict();
    });
  }

  listUnresolved(
    tenantId: string,
    olderThan: Date,
    limit: number,
    tx?: unknown,
  ): Promise<UnresolvedOutbound[]> {
    return this.store.access(tx, () =>
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
    return this.store.access(tx, (t) => {
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
        t,
      );
      return "marked";
    });
  }
}

export class InMemoryInboundMessageRepository implements InboundMessageRepository {
  constructor(private readonly store: InMemoryOutreachStore) {}

  insert(r: InboundRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return this.store.access(tx, (t) => {
      const mine = this.store.inbound.values().filter((x) => x.tenantId === r.tenantId);
      const sameKey = mine.some((x) => x.providerMessageId === r.providerMessageId);
      if (!sameKey && this.store.inbound.get(r.id) === undefined) {
        this.store.inbound.set(r.id, r, t);
        return "inserted";
      }
      if (sameKey) return "duplicate";
      throw unexpectedConflict();
    });
  }

  findByProviderMessageId(
    tenantId: string,
    providerMessageId: string,
    tx?: unknown,
  ): Promise<InboundRecord | null> {
    return this.store.access(
      tx,
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

  lockMessage(
    tenantId: string,
    phoneNumberId: string,
    providerMessageId: string,
    tx: unknown,
  ): Promise<void> {
    return this.store.lockKey(tx, JSON.stringify([tenantId, phoneNumberId, providerMessageId]));
  }

  put(e: UnmatchedStatusRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return this.store.access(tx, (t) => {
      const mine = this.store.unmatched.values().filter((x) => x.tenantId === e.tenantId);
      const sameKey = mine.some((x) => x.providerEventId === e.providerEventId);
      if (!sameKey && this.store.unmatched.get(e.id) === undefined) {
        this.store.unmatched.set(e.id, e, t);
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
    return this.store.access(tx, (t) => {
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
        this.store.unmatched.set(x.id, resolved, t);
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
      // Exactly the live handle of an open unit of work OF THIS STORE: not absent, not closed, not another store's.
      const t = this.store.liveTransaction(tx);
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
