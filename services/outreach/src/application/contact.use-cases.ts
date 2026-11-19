import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import {
  ConcurrencyError,
  ConflictError,
  type DomainError,
  NotFoundError,
  ValidationError,
} from "@platform/utils";
import { applyConsent, type Channel, type ConsentSource, type Purpose } from "../domain/consent";
import { toE164 } from "../domain/phone";
import type { ContactRecord } from "../domain/repositories";
import { consentStateOf, findOrCreateContact } from "./contact-support";
import { type ContactDto, contactDto } from "./dto";
import type { OutreachDeps } from "./outreach-deps";
import { emit, normalizeEmail } from "./support";

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
    if (present(input.phone)) {
      phone = toE164(input.phone);
      if (phone === null) issues.push({ field: "phone", message: "phone_invalid" });
    }
    if (present(input.email)) {
      email = normalizeEmail(input.email);
      if (email === null) issues.push({ field: "email", message: "email_invalid" });
    }
    if (issues.length === 0 && phone === null && email === null) {
      issues.push({ field: "phone", message: "identity_required" });
    }
    if (issues.length > 0) return err(new ValidationError("Invalid contact", issues));

    const { tenantId } = input;
    const displayName = present(input.displayName) ? input.displayName.trim().slice(0, 200) : null;
    const customerRef = present(input.customerRef) ? input.customerRef.trim().slice(0, 200) : null;

    return this.deps.unitOfWork.run(async (tx) => {
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
}

/** Appends the consent event, applies the state and emits `consent_changed` once per purpose that really changed. */
export class RecordConsent implements UseCase<RecordConsentInput, ContactDto, DomainError> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: RecordConsentInput): Promise<Result<ContactDto, DomainError>> {
    const { tenantId } = input;
    const evidence =
      typeof input.evidence === "string" && input.evidence.trim() !== ""
        ? input.evidence.trim().slice(0, 500)
        : null;
    return this.deps.unitOfWork.run(async (tx) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const contact = await this.deps.contacts.findById(tenantId, input.contactId, tx);
        if (contact === null) return err(new NotFoundError("Contact not found"));
        const applied = applyConsent(consentStateOf(contact), {
          channel: input.channel,
          purpose: input.purpose,
          action: input.action,
          source: input.source,
        });
        const next: ContactRecord = { ...contact, ...applied.state };
        try {
          if (applied.changed.length > 0) {
            await this.deps.contacts.saveConsent(next, contact.version, tx);
          }
        } catch (error) {
          if (error instanceof ConcurrencyError && attempt < 2) continue;
          throw error;
        }
        await this.deps.contacts.appendConsent(
          {
            id: this.deps.idGenerator.generate(),
            tenantId,
            contactId: contact.id,
            channel: input.channel,
            purpose: input.purpose,
            action: input.action,
            source: input.source,
            evidence,
            occurredAt: this.deps.clock.now(),
          },
          tx,
        );
        for (const change of applied.changed) {
          await emit(this.deps, tx, tenantId, "outreach.contact.consent_changed", contact.id, {
            contactId: contact.id,
            channel: change.channel,
            purpose: change.purpose,
            action: change.action,
            source: input.source,
          });
        }
        return ok(contactDto(next));
      }
      return err(new ConcurrencyError("Consent kept changing"));
    });
  }
}
