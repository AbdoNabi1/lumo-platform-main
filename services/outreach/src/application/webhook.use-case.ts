import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { isStopKeyword } from "../domain/consent";
import { toE164 } from "../domain/phone";
import type { OutboundStatus } from "../domain/outbound-message";
import type { InboundRecord, InboundType, OutboundRecord } from "../domain/repositories";
import { applyConsentInTx, findOrCreateContact } from "./contact-support";
import type { OutreachDeps } from "./outreach-deps";
import { applyStatusFact } from "./status-support";
import { emit } from "./support";
import { normalizeTemplateCategory, normalizeTemplateStatus } from "./template-support";

export interface WebhookResult {
  processed: number;
  skipped: number;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const idString = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : str(v);

/** Unix seconds (number or digit string) → Date, or null. */
function fromSeconds(v: unknown): Date | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\d{1,12}$/.test(v)) n = Number(v);
  else return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

const PROVIDER_STATUSES: ReadonlySet<string> = new Set(["sent", "delivered", "read", "failed"]);

/** Digits only: Meta reports `recipient_id` without the `+`. */
const digits = (e164: string): string => e164.replace(/^\+/, "");

/**
 * Processes an (already signature-verified) Meta webhook payload. The tenant is unknown: it is resolved from the phone
 * directory (messages) or the WABA (template events), never from the caller.
 *
 * Every status / inbound / template item is its own unit of work (dedup marker + state + consent + outbox event share
 * one `tx`). Malformed items are `skipped` and never discard a valid sibling. Infrastructure errors PROPAGATE so the
 * route answers 5xx and Meta retries; the rolled-back dedup marker makes the retry safe.
 */
export class ProcessWhatsAppWebhook implements UseCase<
  { payload: unknown },
  WebhookResult,
  DomainError
> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: { payload: unknown }): Promise<Result<WebhookResult, DomainError>> {
    const counts: WebhookResult = { processed: 0, skipped: 0 };
    const { payload } = input;
    if (!isRec(payload) || !Array.isArray(payload.entry)) {
      counts.skipped += 1;
      return ok(counts);
    }
    for (const entry of payload.entry as unknown[]) {
      if (!isRec(entry) || !Array.isArray(entry.changes)) {
        counts.skipped += 1;
        continue;
      }
      for (const change of entry.changes as unknown[]) {
        if (!isRec(change) || typeof change.field !== "string" || !isRec(change.value)) {
          counts.skipped += 1;
          continue;
        }
        switch (change.field) {
          case "messages":
            await this.messages(change.value, counts);
            break;
          case "message_template_status_update":
            await this.templateStatus(entry, change.value, counts);
            break;
          case "template_category_update":
            await this.templateCategory(entry, change.value, counts);
            break;
          default:
            counts.skipped += 1;
        }
      }
    }
    return ok(counts);
  }

  // ---- messages: statuses + inbound ---------------------------------------------------------------------------

  private async messages(value: Rec, counts: WebhookResult): Promise<void> {
    const statuses = Array.isArray(value.statuses) ? (value.statuses as unknown[]) : [];
    const messages = Array.isArray(value.messages) ? (value.messages as unknown[]) : [];
    const items = statuses.length + messages.length;
    const phoneNumberId = isRec(value.metadata) ? str(value.metadata.phone_number_id) : null;
    if (phoneNumberId === null || items === 0) {
      counts.skipped += Math.max(1, items);
      return;
    }
    const owner = await this.deps.directory.find(phoneNumberId);
    if (owner === null) {
      // Unknown phone_number_id: ignored (the route logs a warning without the payload).
      counts.skipped += items;
      return;
    }
    const scope = { tenantId: owner.shopTenantId, wabaId: owner.wabaId, phoneNumberId };
    for (const s of statuses) {
      if (await this.status(scope, s)) counts.processed += 1;
      else counts.skipped += 1;
    }
    for (const m of messages) {
      if (await this.inboundMessage(scope, m, value)) counts.processed += 1;
      else counts.skipped += 1;
    }
  }

  private async status(
    scope: { tenantId: string; wabaId: string; phoneNumberId: string },
    raw: unknown,
  ): Promise<boolean> {
    if (!isRec(raw)) return false;
    const id = str(raw.id);
    const statusText = str(raw.status);
    const occurredAt = fromSeconds(raw.timestamp);
    const recipientId = str(raw.recipient_id);
    if (
      id === null ||
      statusText === null ||
      !PROVIDER_STATUSES.has(statusText) ||
      occurredAt === null ||
      recipientId === null
    ) {
      return false;
    }
    const status = statusText as OutboundStatus;
    const correlation = str(raw.biz_opaque_callback_data);
    const firstError = Array.isArray(raw.errors) ? (raw.errors as unknown[])[0] : undefined;
    const errorCode = isRec(firstError) ? idString(firstError.code) : null;
    const providerEventId = `${id}:${statusText}:${String(raw.timestamp)}`;
    const { deps } = this;
    const { tenantId, wabaId, phoneNumberId } = scope;

    await deps.unitOfWork.run(async (tx) => {
      let row: OutboundRecord | null = await deps.outbound.findByProviderId(tenantId, id, tx);
      let viaCorrelation = false;
      if (row === null && correlation !== null) {
        row = await deps.outbound.findByCorrelationId(tenantId, correlation, tx);
        viaCorrelation = row !== null;
      }
      // A match is trusted only for the dispatching phone + WABA, the same tenant and the same recipient. A
      // correlation match may also only ADOPT a provider id on a row that has none yet.
      const trusted =
        row !== null &&
        row.channel === "whatsapp" &&
        row.dispatchPhoneNumberId === phoneNumberId &&
        row.dispatchWabaId === wabaId &&
        digits(row.recipient) === recipientId &&
        (!viaCorrelation || row.providerMessageId === null);
      if (row === null || !trusted) {
        await deps.unmatched.put(
          {
            id: deps.idGenerator.generate(),
            tenantId,
            phoneNumberId,
            providerEventId,
            providerMessageId: id,
            // A rejected-as-forged match must not be drainable through its correlation id.
            correlationId: row === null ? correlation : null,
            status,
            occurredAt,
            resolvedAt: null,
          },
          tx,
        );
        return;
      }
      await applyStatusFact(deps, tx, row, {
        providerMessageId: id,
        status,
        occurredAt,
        providerEventId,
        errorCode,
      });
    });
    return true;
  }

  private async inboundMessage(
    scope: { tenantId: string; wabaId: string; phoneNumberId: string },
    raw: unknown,
    value: Rec,
  ): Promise<boolean> {
    if (!isRec(raw)) return false;
    const { deps } = this;
    const id = str(raw.id);
    const from = str(raw.from);
    const occurredAt = fromSeconds(raw.timestamp);
    if (id === null || from === null || occurredAt === null) return false;
    const phone = toE164(`+${from}`);
    // A timestamp in the future is never accepted (no clock-skew allowance).
    if (phone === null || occurredAt.getTime() > deps.clock.now().getTime()) return false;

    const mapped = mapInbound(raw);
    const profileName = profileNameFor(value, from);
    const { tenantId } = scope;

    await deps.unitOfWork.run(async (tx) => {
      // A duplicate delivery mutates nothing: no contact write, no window change, no event, no consent.
      if ((await deps.inbound.findByProviderMessageId(tenantId, id, tx)) !== null) return;
      let contact = await findOrCreateContact(
        deps,
        tx,
        tenantId,
        { phoneE164: phone },
        profileName,
      );
      const record: InboundRecord = {
        id: deps.idGenerator.generate(),
        tenantId,
        contactId: contact.id,
        providerMessageId: id,
        type: mapped.type,
        text: mapped.text,
        buttonPayload: mapped.buttonPayload,
        contextProviderMessageId: isRec(raw.context) ? str(raw.context.id) : null,
        occurredAt,
        receivedAt: deps.clock.now(),
      };
      if ((await deps.inbound.insert(record, tx)) === "duplicate") return;

      const lastInboundAt =
        contact.lastInboundAt !== null && contact.lastInboundAt.getTime() > occurredAt.getTime()
          ? contact.lastInboundAt
          : occurredAt;
      const next = {
        ...contact,
        lastInboundAt,
        displayName: contact.displayName ?? profileName,
      };
      await deps.contacts.save(next, contact.version, tx);
      contact = { ...next, version: contact.version + 1 };

      await emit(deps, tx, tenantId, "outreach.whatsapp.inbound_received", record.id, {
        contactId: contact.id,
        inboundId: record.id,
        providerMessageId: id,
        type: record.type,
        buttonPayload: record.buttonPayload,
        contextProviderMessageId: record.contextProviderMessageId,
        occurredAt: occurredAt.toISOString(),
      });

      if (record.type === "text" && mapped.text !== null && isStopKeyword(mapped.text)) {
        await applyConsentInTx(deps, tx, contact, {
          channel: "whatsapp",
          purpose: "marketing",
          action: "revoke",
          source: "inbound_keyword",
          evidence: null,
        });
      }
    });
    return true;
  }

  // ---- template events ----------------------------------------------------------------------------------------

  private templateScope(
    entry: Rec,
    value: Rec,
  ): { wabaId: string; metaTemplateId: string; eventAt: Date } | null {
    const wabaId = idString(entry.id);
    const metaTemplateId = idString(value.message_template_id);
    const eventAt = fromSeconds(entry.time);
    return wabaId === null || metaTemplateId === null || eventAt === null
      ? null
      : { wabaId, metaTemplateId, eventAt };
  }

  private async templateStatus(entry: Rec, value: Rec, counts: WebhookResult): Promise<void> {
    const scope = this.templateScope(entry, value);
    const event = str(value.event);
    if (scope === null || event === null) {
      counts.skipped += 1;
      return;
    }
    const owner = await this.deps.directory.findByWaba(scope.wabaId);
    if (owner === null) {
      counts.skipped += 1;
      return;
    }
    const reason = str(value.reason);
    await this.applyTemplateEvent(owner.shopTenantId, scope.wabaId, scope.metaTemplateId, (tx) =>
      this.deps.templates.applyStatusEvent(
        owner.shopTenantId,
        scope.wabaId,
        scope.metaTemplateId,
        {
          status: normalizeTemplateStatus(event),
          reason:
            reason !== null && /^[A-Z_]{1,40}$/.test(reason) && reason !== "NONE" ? reason : null,
          eventAt: scope.eventAt,
        },
        tx,
      ),
    );
    counts.processed += 1;
  }

  private async templateCategory(entry: Rec, value: Rec, counts: WebhookResult): Promise<void> {
    const scope = this.templateScope(entry, value);
    if (scope === null) {
      counts.skipped += 1;
      return;
    }
    const newCategory = str(value.new_category);
    if (newCategory === null) {
      // An impending notice (`correct_category` only) changes nothing.
      counts.processed += 1;
      return;
    }
    const category = normalizeTemplateCategory(newCategory);
    const owner = await this.deps.directory.findByWaba(scope.wabaId);
    if (category === null || owner === null) {
      counts.skipped += 1;
      return;
    }
    await this.applyTemplateEvent(owner.shopTenantId, scope.wabaId, scope.metaTemplateId, (tx) =>
      this.deps.templates.applyCategoryEvent(
        owner.shopTenantId,
        scope.wabaId,
        scope.metaTemplateId,
        { category, eventAt: scope.eventAt },
        tx,
      ),
    );
    counts.processed += 1;
  }

  /** `template.status_changed` is emitted only on `applied` and `conflict`; stale / noop / unknown rows emit nothing. */
  private async applyTemplateEvent(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
    apply: (tx: unknown) => Promise<"applied" | "noop" | "stale" | "conflict" | "not_found">,
  ): Promise<void> {
    const { deps } = this;
    await deps.unitOfWork.run(async (tx) => {
      const before = await deps.templates.findByProviderId(tenantId, wabaId, metaTemplateId, tx);
      const result = await apply(tx);
      if (result !== "applied" && result !== "conflict") return;
      const after = await deps.templates.findByProviderId(tenantId, wabaId, metaTemplateId, tx);
      if (after === null) return;
      await emit(deps, tx, tenantId, "outreach.template.status_changed", after.id, {
        wabaId,
        metaTemplateId,
        name: after.name,
        language: after.language,
        from: before?.status ?? null,
        to: after.status,
        category: after.category,
      });
    });
  }
}

function profileNameFor(value: Rec, waId: string): string | null {
  if (!Array.isArray(value.contacts)) return null;
  for (const c of value.contacts as unknown[]) {
    if (isRec(c) && str(c.wa_id) === waId && isRec(c.profile)) {
      const name = str(c.profile.name);
      if (name !== null) return name.slice(0, 200);
    }
  }
  return null;
}

function mapInbound(raw: Rec): {
  type: InboundType;
  text: string | null;
  buttonPayload: string | null;
} {
  const type = str(raw.type);
  const clip = (s: string | null): string | null => (s === null ? null : s.slice(0, 4096));
  if (type === "text" && isRec(raw.text)) {
    return { type: "text", text: clip(str(raw.text.body)), buttonPayload: null };
  }
  if (type === "button" && isRec(raw.button)) {
    return {
      type: "button",
      text: clip(str(raw.button.text)),
      buttonPayload: str(raw.button.payload),
    };
  }
  if (type === "interactive" && isRec(raw.interactive) && isRec(raw.interactive.button_reply)) {
    const reply = raw.interactive.button_reply;
    return { type: "interactive", text: clip(str(reply.title)), buttonPayload: str(reply.id) };
  }
  return { type: "other", text: null, buttonPayload: null };
}
