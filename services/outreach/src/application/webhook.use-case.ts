import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { isStopKeyword } from "../domain/consent";
import { toE164 } from "../domain/phone";
import type { OutboundStatus } from "../domain/outbound-message";
import type {
  InboundRecord,
  InboundType,
  OutboundRecord,
  TemplateEventOutcome,
} from "../domain/repositories";
import { templateReason, webhookErrorCode } from "./error-codes";
import { applyConsentInTx, findOrCreateContact } from "./contact-support";
import type { OutreachDeps } from "./outreach-deps";
import { applyStatusFact } from "./status-support";
import { emit } from "./support";
import {
  emitTemplateTransition,
  normalizeTemplateCategory,
  normalizeTemplateStatus,
} from "./template-support";

export interface WebhookResult {
  processed: number;
  skipped: number;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const idString = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : str(v);

/** Unix seconds (a safe positive integer, as a number or a digit string) → a VALID Date, or null. */
function fromSeconds(v: unknown): Date | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\d{1,12}$/.test(v)) n = Number(v);
  else return null;
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const date = new Date(n * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
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
            await this.messages(entry, change.value, counts);
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

  private async messages(entry: Rec, value: Rec, counts: WebhookResult): Promise<void> {
    const statuses = Array.isArray(value.statuses) ? (value.statuses as unknown[]) : [];
    const messages = Array.isArray(value.messages) ? (value.messages as unknown[]) : [];
    const items = statuses.length + messages.length;
    const phoneNumberId = isRec(value.metadata) ? str(value.metadata.phone_number_id) : null;
    // The WABA of the entry is part of the verified routing tuple: an item of another (e.g. the old) WABA is never
    // consumed by whoever owns the phone now.
    const wabaId = idString(entry.id);
    if (phoneNumberId === null || wabaId === null || items === 0) {
      counts.skipped += Math.max(1, items);
      return;
    }
    const owner = await this.deps.directory.find(phoneNumberId);
    if (owner === null || owner.wabaId !== wabaId) {
      // Unknown phone_number_id or a stale WABA: ignored (the route logs a warning without the payload).
      counts.skipped += items;
      return;
    }
    const scope = { tenantId: owner.shopTenantId, wabaId, phoneNumberId };
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
    const errorCode = isRec(firstError) ? webhookErrorCode(firstError.code) : null;
    const providerEventId = `${id}:${statusText}:${String(raw.timestamp)}`;
    const { deps } = this;
    const { tenantId, wabaId, phoneNumberId } = scope;

    return deps.unitOfWork.run(tenantId, async (tx) => {
      // The directory owner is revalidated (and fenced) inside this transaction: a hand-over since the batch was
      // routed means this item is not ours to consume.
      if (!(await this.stillOwned(tx, scope))) return false;
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
        return true;
      }
      await applyStatusFact(deps, tx, row, {
        providerMessageId: id,
        status,
        occurredAt,
        providerEventId,
        errorCode,
      });
      return true;
    });
  }

  /** The verified (phone, WABA) tuple still belongs to the shop this unit of work is scoped to (row share-locked). */
  private async stillOwned(
    tx: unknown,
    scope: { tenantId: string; wabaId: string; phoneNumberId: string },
  ): Promise<boolean> {
    const owner = await this.deps.directory.fencePhone(scope.phoneNumberId, tx);
    return owner !== null && owner.shopTenantId === scope.tenantId && owner.wabaId === scope.wabaId;
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
    // A real type and the required fields of a known shape, all checked BEFORE any write.
    const mapped = mapInbound(raw);
    if (mapped === null) return false;
    const profileName = profileNameFor(value, from);
    const { tenantId } = scope;

    return deps.unitOfWork.run(tenantId, async (tx) => {
      if (!(await this.stillOwned(tx, scope))) return false;
      // A duplicate delivery mutates nothing: no contact write, no window change, no event, no consent.
      if ((await deps.inbound.findByProviderMessageId(tenantId, id, tx)) !== null) return true;
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
      if ((await deps.inbound.insert(record, tx)) === "duplicate") return true;

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
      return true;
    });
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
    const applied = await this.applyTemplateEvent(owner.shopTenantId, scope.wabaId, (tx) =>
      this.deps.templates.applyStatusEvent(
        owner.shopTenantId,
        scope.wabaId,
        scope.metaTemplateId,
        {
          status: normalizeTemplateStatus(event),
          reason: templateReason(reason),
          eventAt: scope.eventAt,
        },
        tx,
      ),
    );
    if (applied) counts.processed += 1;
    else counts.skipped += 1;
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
    const applied = await this.applyTemplateEvent(owner.shopTenantId, scope.wabaId, (tx) =>
      this.deps.templates.applyCategoryEvent(
        owner.shopTenantId,
        scope.wabaId,
        scope.metaTemplateId,
        { category, eventAt: scope.eventAt },
        tx,
      ),
    );
    if (applied) counts.processed += 1;
    else counts.skipped += 1;
  }

  /** `template.status_changed` is emitted only on `applied` and `conflict`; stale / noop / unknown rows emit nothing. */
  private async applyTemplateEvent(
    tenantId: string,
    wabaId: string,
    apply: (tx: unknown) => Promise<TemplateEventOutcome>,
  ): Promise<boolean> {
    const { deps } = this;
    return deps.unitOfWork.run(tenantId, async (tx) => {
      // The WABA's owner is revalidated (and fenced) inside this transaction (entry.id is the routing key).
      const owner = await deps.directory.fenceWaba(wabaId, tx);
      if (owner === null || owner.shopTenantId !== tenantId) return false;
      const { change } = await apply(tx);
      // The transition is the one the winning CAS made (never a separate pre-read); emitted only when material.
      if (change !== null) {
        await emitTemplateTransition(deps, tx, tenantId, change.before, change.after);
      }
      return true;
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

/**
 * Maps an inbound item, or `null` when it is malformed: a missing / non-string / ill-shaped `type`, or a known shape
 * (text, button, interactive button reply) without its required fields. A legitimate type this service does not
 * interpret (image, sticker, reaction, unsupported, …) is kept as `other`.
 */
function mapInbound(raw: Rec): {
  type: InboundType;
  text: string | null;
  buttonPayload: string | null;
} | null {
  const type = str(raw.type);
  if (type === null || !/^[a-z][a-z_]{0,31}$/.test(type)) return null;
  const clip = (s: string): string => s.slice(0, 4096);
  if (type === "text") {
    const body = isRec(raw.text) ? str(raw.text.body) : null;
    return body === null ? null : { type: "text", text: clip(body), buttonPayload: null };
  }
  if (type === "button") {
    const text = isRec(raw.button) ? str(raw.button.text) : null;
    const payload = isRec(raw.button) ? str(raw.button.payload) : null;
    return text === null || payload === null
      ? null
      : { type: "button", text: clip(text), buttonPayload: payload };
  }
  if (type === "interactive") {
    if (!isRec(raw.interactive)) return null;
    if (isRec(raw.interactive.button_reply)) {
      const reply = raw.interactive.button_reply;
      const title = str(reply.title);
      const id = str(reply.id);
      return title === null || id === null
        ? null
        : { type: "interactive", text: clip(title), buttonPayload: id };
    }
  }
  return { type: "other", text: null, buttonPayload: null };
}
