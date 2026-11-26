import type {
  EmailProviderPort,
  ProviderSendRequest,
  ProviderSendResult,
} from "../application/ports";
import type {
  EmailDeliveryPort,
  NotificationLog,
  RecipientContact,
  RecipientResolverPort,
} from "../application/messaging-ports";
import {
  copyFor,
  loadSenderContext,
  type SenderContextDeps,
} from "../application/messaging-support";
import { findStaffRecipient, STAFF_REF_PREFIX } from "../application/staff-recipient-ref";
import type { TemplateOverrideRepository } from "../domain/messaging/messaging-repositories";
import { effectiveNotificationSettings } from "../domain/messaging/notification-settings";
import { escapeHtml, formatMoney, renderTemplate } from "../domain/messaging/template-renderer";
import type { OrderBlockData, OrderLineData } from "../domain/messaging/template-renderer";
import {
  chooseLocale,
  isTemplateKey,
  TEMPLATE_CATALOGUE,
  type TemplateKey,
  type TemplateLocale,
} from "../domain/messaging/template-catalogue";

export interface TemplatedEmailProviderDeps extends SenderContextDeps {
  readonly overrides: TemplateOverrideRepository;
  readonly recipients: RecipientResolverPort;
  readonly delivery: EmailDeliveryPort;
  readonly log: NotificationLog;
}

/** Why a send failed, as a short code. This is all that is ever recorded or logged: no address, no body. */
export type EmailFailureCode =
  "EMAIL_NOT_CONFIGURED" | "RECIPIENT_NOT_FOUND" | "MISSING_VARIABLE" | "EMAIL_SEND_FAILED";

class EmailFailure extends Error {
  constructor(readonly failure: EmailFailureCode) {
    super(failure);
  }
}

function parseOrderBlock(
  raw: string | undefined,
  currency: string | undefined,
): OrderBlockData | undefined {
  if (raw === undefined || currency === undefined) return undefined;
  try {
    const data = JSON.parse(raw) as {
      lines?: unknown;
      subtotalMinor?: unknown;
      discountMinor?: unknown;
      shippingMinor?: unknown;
      taxMinor?: unknown;
      totalMinor?: unknown;
    };
    if (!Array.isArray(data.lines)) return undefined;
    const lines: OrderLineData[] = [];
    for (const line of data.lines as Record<string, unknown>[]) {
      if (
        typeof line["name"] !== "string" ||
        typeof line["quantity"] !== "number" ||
        typeof line["unitAmountMinor"] !== "number"
      ) {
        return undefined;
      }
      lines.push({
        name: line["name"],
        variantTitle: typeof line["variantTitle"] === "string" ? line["variantTitle"] : null,
        quantity: line["quantity"],
        unitAmountMinor: line["unitAmountMinor"],
      });
    }
    const num = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    const block: { -readonly [K in keyof OrderBlockData]: OrderBlockData[K] } = { currency, lines };
    const subtotal = num(data.subtotalMinor);
    const discount = num(data.discountMinor);
    const shipping = num(data.shippingMinor);
    const tax = num(data.taxMinor);
    const total = num(data.totalMinor);
    if (subtotal !== undefined) block.subtotalMinor = subtotal;
    if (discount !== undefined) block.discountMinor = discount;
    if (shipping !== undefined) block.shippingMinor = shipping;
    if (tax !== undefined) block.taxMinor = tax;
    if (total !== undefined) block.totalMinor = total;
    return block;
  } catch {
    return undefined;
  }
}

function minor(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

/**
 * Wave 2b: the real email channel. Replaces the in-memory email provider: it resolves the
 * recipient's address at send time (never stored on the notification), picks the language, renders
 * the merchant's template (or the default), resolves From / Reply-To (D38) and sends over the
 * platform's `EmailSender`.
 *
 * Failures are short codes only (`EMAIL_NOT_CONFIGURED`...): the notification row records the code,
 * the log carries the template key and the code, never an address or a body (ADR-0006, D42).
 */
export class TemplatedEmailProvider implements EmailProviderPort {
  private readonly deps: TemplatedEmailProviderDeps;

  constructor(deps: TemplatedEmailProviderDeps) {
    this.deps = deps;
  }

  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    const key = isTemplateKey(request.templateId) ? request.templateId : null;
    try {
      await this.deliver(request, key);
    } catch (error) {
      const code: EmailFailureCode =
        error instanceof EmailFailure ? error.failure : "EMAIL_SEND_FAILED";
      this.deps.log.warn("notification email not sent", {
        template: key ?? "custom",
        reason: code,
      });
      throw new Error(code);
    }
    return { providerRef: "email" };
  }

  private async deliver(request: ProviderSendRequest, key: TemplateKey | null): Promise<void> {
    if (!this.deps.delivery.deliveryConfigured) throw new EmailFailure("EMAIL_NOT_CONFIGURED");
    const tenantId = request.tenantId;
    if (tenantId === undefined) throw new EmailFailure("RECIPIENT_NOT_FOUND");

    const context = await loadSenderContext(this.deps, tenantId);
    const variables = request.variables ?? {};
    const transient = request.transient ?? {};

    const contact = await this.resolveContact(request, tenantId, key, transient);
    if (contact === null) throw new EmailFailure("RECIPIENT_NOT_FOUND");

    let subject: string;
    let text: string;
    let html: string;
    if (key === null) {
      // A manual composer notification: send what the row renders, as plain text.
      subject = request.subject ?? "";
      text = request.body;
      html = `<div style="white-space:pre-wrap">${escapeHtml(request.body)}</div>`;
    } else {
      const definition = TEMPLATE_CATALOGUE[key];
      const staff = definition.audience === "staff";
      const locale: TemplateLocale = chooseLocale(
        staff ? null : contact.language,
        context.profile.defaultLocale,
      );
      const override = await this.deps.overrides.find(tenantId, key, locale);
      const copy = copyFor(key, locale, override);

      const currency = variables["currency"];
      const total = minor(variables["total_minor"]);
      const refund = minor(variables["refund_minor"]);
      const named: Record<string, string> = {
        store_name: context.profile.storeName,
        customer_name:
          contact.name.trim() !== "" ? contact.name : locale === "ar" ? "عزيزي العميل" : "there",
        order_number: variables["order_number"] ?? "",
        tracking_number: variables["tracking_number"] ?? "",
        tracking_url: variables["tracking_url"] ?? "",
        carrier: variables["carrier"] ?? "",
        invoice_url: transient["invoice_url"] ?? "",
        ...(currency !== undefined && total !== undefined
          ? { order_total: formatMoney(total, currency, locale) }
          : {}),
        ...(currency !== undefined && refund !== undefined
          ? { refund_amount: formatMoney(refund, currency, locale) }
          : {}),
      };
      if (key === "draft_order_invoice" && named["invoice_url"] === "") {
        throw new EmailFailure("MISSING_VARIABLE");
      }
      const order = parseOrderBlock(variables["order_json"], currency);
      const rendered = renderTemplate({
        subject: copy.subject,
        body: copy.body,
        locale,
        storeName: context.profile.storeName,
        variables: named,
        catalogueVariables: definition.variables,
        ...(order === undefined ? {} : { order }),
      });
      subject = rendered.subject;
      text = rendered.text;
      html = rendered.html;
    }

    await this.deps.delivery.send({
      to: contact.email,
      subject,
      text,
      html,
      from: context.sender.from,
      ...(context.sender.replyTo === undefined ? {} : { replyTo: context.sender.replyTo }),
      idempotencyKey: request.idempotencyKey,
    });
  }

  private async resolveContact(
    request: ProviderSendRequest,
    tenantId: string,
    key: TemplateKey | null,
    transient: Readonly<Record<string, string>>,
  ): Promise<RecipientContact | null> {
    const ref = request.recipientRef;
    if (ref.startsWith(STAFF_REF_PREFIX)) {
      const stored = await this.deps.settings.find(tenantId);
      const email = findStaffRecipient(ref, effectiveNotificationSettings(stored).staffRecipients);
      if (email === null) return null;
      // The staff mail names the CUSTOMER who ordered (resolved now, never stored on the row).
      const customerRef = request.variables?.["customer_ref"];
      const customer =
        key === "staff_new_order" && customerRef !== undefined
          ? await this.deps.recipients.resolve(tenantId, customerRef)
          : null;
      return { name: customer?.name ?? "", email, language: null };
    }
    const resolved = await this.deps.recipients.resolve(tenantId, ref);
    // A draft's invoice goes to the address on the draft: it exists only for this one send and wins over
    // the customer's own. A draft with no customer record is mailed there too.
    const email = transient["recipient_email"];
    if (email !== undefined && email !== "") {
      return {
        name: resolved?.name ?? transient["recipient_name"] ?? "",
        email,
        language: resolved?.language ?? null,
      };
    }
    if (resolved !== null) return resolved;
    return null;
  }
}
