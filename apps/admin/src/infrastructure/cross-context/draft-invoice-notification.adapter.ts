import { orderJson } from "./notification-mail-data";
import { guardedTrigger, type MailNotifier } from "./notification-trigger";

/** The part of a draft order's API shape an invoice mail needs. */
export interface InvoiceDraft {
  readonly id: string;
  readonly draftNumber: string;
  readonly currency: string;
  readonly email: string | null;
  readonly customer: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  } | null;
  readonly lines: readonly {
    readonly title: string;
    readonly variantTitle: string | null;
    readonly quantity: number;
    readonly unitPriceMinor: number;
  }[];
  readonly totals: {
    readonly subtotalMinor: number;
    readonly discountMinor: number;
    readonly shippingMinor: number;
    readonly taxMinor: number | null;
    readonly totalMinor: number;
  };
}

/**
 * Wave 2b: the customer "Send invoice" mail (`draft_order_invoice`). It fires from the draft order's
 * Send invoice route, right after the payment link was issued and the draft marked "Invoice sent".
 *
 * The link is a bearer secret shown once: it travels to the mail as an in-memory `transient` value and
 * is NEVER written to the notification row or the log. The recipient is the draft's own email (what the
 * merchant typed or the customer's); a draft whose customer record cannot be resolved is still mailed at
 * that address, which also exists only for this send. Idempotency: `<draft>:<link id>`, one mail per
 * link issued. Best effort: a failure is logged and the Send invoice answer is unchanged (D42), the link
 * is still shown to the merchant.
 */
export class DraftInvoiceNotificationAdapter {
  private readonly notifier: MailNotifier;
  private readonly storefrontUrl: string | undefined;

  /** `storefrontUrl` is the runtime's `STOREFRONT_URL`, the link's base when the shop has no domain of its own. */
  constructor(notifier: MailNotifier, storefrontUrl?: string) {
    this.notifier = notifier;
    this.storefrontUrl = storefrontUrl;
  }

  async sendInvoice(input: {
    readonly tenantId: string;
    readonly draft: InvoiceDraft;
    readonly linkId: string;
    /** The shop's own-domain link, or null when it has no verified domain. */
    readonly url: string | null;
    /** `/c/<token>`: appended to `STOREFRONT_URL` when there is no own-domain link (the same rule admin-web uses). */
    readonly path: string;
  }): Promise<void> {
    const { tenantId, draft } = input;
    await guardedTrigger("draft_order_invoice", { tenantId, orderRef: draft.id }, async () => {
      const email = draft.email ?? draft.customer?.email ?? null;
      if (email === null) return { ok: false, error: { code: "NO_RECIPIENT" } };
      const link =
        input.url ??
        (this.storefrontUrl === undefined || this.storefrontUrl === ""
          ? null
          : `${this.storefrontUrl.replace(/\/+$/, "")}${input.path}`);
      if (link === null) return { ok: false, error: { code: "NO_LINK_BASE" } };
      const lines = draft.lines.map((line) => ({
        name: line.title,
        variantTitle: line.variantTitle,
        quantity: line.quantity,
        unitAmountMinor: line.unitPriceMinor,
      }));
      return this.notifier.execute({
        tenantId,
        template: "draft_order_invoice",
        eventKey: `${draft.id}:${input.linkId}`,
        sourceRef: `draft:${draft.draftNumber}`,
        recipientRef: draft.customer?.id ?? `draft:${draft.id}`,
        variables: {
          order_number: draft.draftNumber,
          currency: draft.currency,
          total_minor: String(draft.totals.totalMinor),
          order_json: orderJson(lines, {
            subtotalMinor: draft.totals.subtotalMinor,
            discountMinor: draft.totals.discountMinor,
            shippingMinor: draft.totals.shippingMinor,
            ...(draft.totals.taxMinor === null ? {} : { taxMinor: draft.totals.taxMinor }),
            totalMinor: draft.totals.totalMinor,
          }),
        },
        transient: {
          invoice_url: link,
          recipient_email: email,
          recipient_name: draft.customer?.name ?? "",
        },
      });
    });
  }
}
