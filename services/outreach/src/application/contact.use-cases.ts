import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import {
  ConcurrencyError,
  ConflictError,
  type DomainError,
  NotFoundError,
  ValidationError,
} from "@platform/utils";
import type { Channel, ConsentSource, Purpose } from "../domain/consent";
import { toE164 } from "../domain/phone";
import type { ContactRecord } from "../domain/repositories";
import { ConsentOperationReplayed, applyConsentInTx, findOrCreateContact } from "./contact-support";
import { type ContactDto, contactDto } from "./dto";
import type { OutreachDeps } from "./outreach-deps";
import { normalizeEmail } from "./support";

export interface UpsertContactInput {
  tenantId: string;
  phone?: string;
  email?: string;
  customerRef?: string;
  displayName?: string;
}

const present = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** Finds a contact by phone then email, or creates it. Updates only fill identity; they never touch consent. */
export class UpsertContact implements UseCase<UpsertContactInput, ContactDto, DomainError> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: UpsertContactInput): Promise<Result<ContactDto, DomainError>> {
    const issues: { field: string; message: string }[] = [];
    let phone: string | null = null;
    let email: string | null = null;
    // `undefined` means "not supplied"; anything else supplied (including blank) must be a valid identity.
    if (input.phone !== undefined) {
      phone = typeof input.phone === "string" ? toE164(input.phone) : null;
      if (phone === null) issues.push({ field: "phone", message: "phone_invalid" });
    }
    if (input.email !== undefined) {
      email = typeof input.email === "string" ? normalizeEmail(input.email) : null;
      if (email === null) issues.push({ field: "email", message: "email_invalid" });
    }
    if (issues.length === 0 && phone === null && email === null) {
      issues.push({ field: "phone", message: "identity_required" });
    }
    if (issues.length > 0) return err(new ValidationError("Invalid contact", issues));

    const { tenantId } = input;
    const displayName = present(input.displayName) ? input.displayName.trim().slice(0, 200) : null;
    const customerRef = present(input.customerRef) ? input.customerRef.trim().slice(0, 200) : null;

    return this.deps.unitOfWork.run(tenantId, async (tx) => {
      const byPhone =
        phone === null ? null : await this.deps.contacts.findByPhone(tenantId, phone, tx);
      const byEmail =
        email === null ? null : await this.deps.contacts.findByEmail(tenantId, email, tx);
      if (byPhone !== null && byEmail !== null && byPhone.id !== byEmail.id) {
        return err(new ConflictError("CONTACT_IDENTITY_CONFLICT"));
      }
      const existing = byPhone ?? byEmail;
      if (existing === null) {
        const created = await this.create(tx, tenantId, phone, email, customerRef, displayName);
        if (created === "conflict") return err(new ConflictError("CONTACT_IDENTITY_CONFLICT"));
        return ok(contactDto(created));
      }
      const next: ContactRecord = {
        ...existing,
        phoneE164: existing.phoneE164 ?? phone,
        email: existing.email ?? email,
        customerRef: customerRef ?? existing.customerRef,
        displayName: displayName ?? existing.displayName,
      };
      const changed =
        next.phoneE164 !== existing.phoneE164 ||
        next.email !== existing.email ||
        next.customerRef !== existing.customerRef ||
        next.displayName !== existing.displayName;
      if (changed) await this.deps.contacts.save(next, existing.version, tx);
      return ok(contactDto(changed ? next : existing));
    });
  }

  private async create(
    tx: unknown,
    tenantId: string,
    phone: string | null,
    email: string | null,
    customerRef: string | null,
    displayName: string | null,
  ): Promise<ContactRecord | "conflict"> {
    const base = await findOrCreateContact(
      this.deps,
      tx,
      tenantId,
      phone !== null ? { phoneE164: phone } : { email: email as string },
      displayName,
    );
    // A concurrent creator may have won with only one of the two identities: fill in what is missing, or report a clash.
    if (phone !== null && email !== null) {
      if (base.email !== null && base.email !== email) return "conflict";
      const byEmail = await this.deps.contacts.findByEmail(tenantId, email, tx);
      if (byEmail !== null && byEmail.id !== base.id) return "conflict";
    }
    const next: ContactRecord = {
      ...base,
      email: base.email ?? email,
      customerRef: customerRef ?? base.customerRef,
      displayName: displayName ?? base.displayName,
    };
    if (
      next.email !== base.email ||
      next.customerRef !== base.customerRef ||
      next.displayName !== base.displayName
    ) {
      await this.deps.contacts.save(next, base.version, tx);
      return next;
    }
    return base;
  }
}

export interface RecordConsentInput {
  tenantId: string;
  contactId: string;
  channel: Channel;
  purpose: Purpose;
  action: "grant" | "revoke";
  source: ConsentSource;
  evidence?: string;
  /**
   * A durable once-only receipt of this submission (tenant + key, 1..255 characters): the first use records the event
   * together with the state change, a repeat changes nothing and answers with the current contact — so a retry can
   * never undo an intervening opt-out.
   */
  operationKey?: string;
}

const MAX_OPERATION_KEY = 255;

/** Appends the consent event, applies the state and emits `consent_changed` once per purpose that really changed. */
export class RecordConsent implements UseCase<RecordConsentInput, ContactDto, DomainError> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: RecordConsentInput): Promise<Result<ContactDto, DomainError>> {
    const { tenantId } = input;
    const evidence =
      typeof input.evidence === "string" && input.evidence.trim() !== ""
        ? input.evidence.trim().slice(0, 500)
        : null;
    let operationKey: string | undefined;
    if (input.operationKey !== undefined) {
      const trimmed = typeof input.operationKey === "string" ? input.operationKey.trim() : "";
      if (trimmed === "" || trimmed.length > MAX_OPERATION_KEY) {
        return err(
          new ValidationError("Invalid consent operation key", [
            { field: "operationKey", message: "invalid" },
          ]),
        );
      }
      operationKey = trimmed;
    }
    try {
      return await this.record(input, evidence, operationKey);
    } catch (error) {
      if (error instanceof ConsentOperationReplayed && operationKey !== undefined) {
        // A concurrent submission of the same key committed first: answer from its (now committed) state.
        return this.deps.unitOfWork.run(tenantId, (tx) => this.replay(tenantId, operationKey, tx));
      }
      throw error;
    }
  }

  /** The current contact of the submission that used `operationKey` (no write). */
  private async replay(
    tenantId: string,
    operationKey: string,
    tx: unknown,
  ): Promise<Result<ContactDto, DomainError>> {
    const prior = await this.deps.contacts.findConsentByOperation(tenantId, operationKey, tx);
    const contact =
      prior === null ? null : await this.deps.contacts.findById(tenantId, prior.contactId, tx);
    return contact === null ? err(new NotFoundError("Contact not found")) : ok(contactDto(contact));
  }

  private async record(
    input: RecordConsentInput,
    evidence: string | null,
    operationKey: string | undefined,
  ): Promise<Result<ContactDto, DomainError>> {
    const { tenantId } = input;
    return this.deps.unitOfWork.run(tenantId, async (tx) => {
      if (operationKey !== undefined) {
        const prior = await this.deps.contacts.findConsentByOperation(tenantId, operationKey, tx);
        if (prior !== null) return this.replay(tenantId, operationKey, tx);
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const contact = await this.deps.contacts.findById(tenantId, input.contactId, tx);
        if (contact === null) return err(new NotFoundError("Contact not found"));
        let next: ContactRecord;
        try {
          next = await applyConsentInTx(this.deps, tx, contact, {
            channel: input.channel,
            purpose: input.purpose,
            action: input.action,
            source: input.source,
            evidence,
            ...(operationKey === undefined ? {} : { operationKey }),
          });
        } catch (error) {
          if (error instanceof ConcurrencyError && attempt < 2) continue;
          throw error;
        }
        return ok(contactDto(next));
      }
      return err(new ConcurrencyError("Consent kept changing"));
    });
  }
}
