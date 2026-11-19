import { ConcurrencyError } from "@platform/utils";
import {
  applyConsent,
  type Channel,
  type ConsentSource,
  type ConsentState,
  type Purpose,
} from "../domain/consent";
import type { ContactRecord } from "../domain/repositories";
import type { OutreachDeps } from "./outreach-deps";
import { emit } from "./support";

export function consentStateOf(c: ContactRecord): ConsentState {
  return {
    whatsappMarketing: c.whatsappMarketing,
    whatsappTransactional: c.whatsappTransactional,
    emailMarketing: c.emailMarketing,
  };
}

type Identity = { phoneE164: string } | { email: string };

/**
 * Finds the contact by its identity or creates it (consent defaults to `unknown`: `save` never writes consent). A
 * concurrent create loses with `ConcurrencyError` and the winner is reread, inside the same transaction.
 */
export async function findOrCreateContact(
  deps: OutreachDeps,
  tx: unknown,
  tenantId: string,
  identity: Identity,
  displayName: string | null = null,
): Promise<ContactRecord> {
  const find = (): Promise<ContactRecord | null> =>
    "phoneE164" in identity
      ? deps.contacts.findByPhone(tenantId, identity.phoneE164, tx)
      : deps.contacts.findByEmail(tenantId, identity.email, tx);
  const existing = await find();
  if (existing !== null) return existing;
  const record: ContactRecord = {
    id: deps.idGenerator.generate(),
    tenantId,
    phoneE164: "phoneE164" in identity ? identity.phoneE164 : null,
    email: "email" in identity ? identity.email : null,
    customerRef: null,
    displayName,
    whatsappMarketing: "unknown",
    whatsappTransactional: "unknown",
    emailMarketing: "unknown",
    lastInboundAt: null,
    version: 1,
  };
  try {
    await deps.contacts.save(record, 0, tx);
  } catch (error) {
    if (!(error instanceof ConcurrencyError)) throw error;
    const winner = await find();
    if (winner === null) throw error;
    return winner;
  }
  const created = await find();
  return created ?? record;
}

/**
 * Applies one consent event inside `tx`: the state (CAS on the contact version), the audit event and one
 * `consent_changed` event per purpose that really changed. Returns the contact as stored afterwards.
 */
export async function applyConsentInTx(
  deps: OutreachDeps,
  tx: unknown,
  contact: ContactRecord,
  e: {
    channel: Channel;
    purpose: Purpose;
    action: "grant" | "revoke";
    source: ConsentSource;
    evidence: string | null;
  },
): Promise<ContactRecord> {
  const applied = applyConsent(consentStateOf(contact), {
    channel: e.channel,
    purpose: e.purpose,
    action: e.action,
    source: e.source,
  });
  let next: ContactRecord = { ...contact, ...applied.state };
  if (applied.changed.length > 0) {
    await deps.contacts.saveConsent(next, contact.version, tx);
    next = { ...next, version: contact.version + 1 };
  }
  await deps.contacts.appendConsent(
    {
      id: deps.idGenerator.generate(),
      tenantId: contact.tenantId,
      contactId: contact.id,
      channel: e.channel,
      purpose: e.purpose,
      action: e.action,
      source: e.source,
      evidence: e.evidence,
      occurredAt: deps.clock.now(),
    },
    tx,
  );
  for (const change of applied.changed) {
    await emit(deps, tx, contact.tenantId, "outreach.contact.consent_changed", contact.id, {
      contactId: contact.id,
      channel: change.channel,
      purpose: change.purpose,
      action: change.action,
      source: e.source,
    });
  }
  return next;
}
