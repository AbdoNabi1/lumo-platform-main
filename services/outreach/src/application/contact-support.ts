import { ConcurrencyError } from "@platform/utils";
import type { ConsentState } from "../domain/consent";
import type { ContactRecord } from "../domain/repositories";
import type { OutreachDeps } from "./outreach-deps";

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
