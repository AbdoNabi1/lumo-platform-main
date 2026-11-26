import { afterEach, describe, expect, it } from "vitest";
import {
  DraftInvoiceNotificationAdapter,
  type InvoiceDraft,
} from "./draft-invoice-notification.adapter";
import { fakeNotifier, spyLogger } from "./testing/notification-test-support";

const draft: InvoiceDraft = {
  id: "d-1",
  draftNumber: "#D12",
  currency: "EGP",
  email: "buyer@example.com",
  customer: { id: "cust-1", name: "Sara", email: "sara@example.com" },
  lines: [{ title: "Linen shirt", variantTitle: "M", quantity: 2, unitPriceMinor: 45000 }],
  totals: {
    subtotalMinor: 90000,
    discountMinor: 0,
    shippingMinor: 5000,
    taxMinor: null,
    totalMinor: 95000,
  },
};
const LINK = "https://shop.example/c/SECRET-TOKEN";

/** Wave 2b: the draft order invoice mail; the link is a one-time secret. */
describe("DraftInvoiceNotificationAdapter", () => {
  let log: ReturnType<typeof spyLogger> | undefined;
  afterEach(() => log?.restore());

  it("one invoice per link issued, the link only in the in-memory part", async () => {
    expect.hasAssertions();
    const { notifier, requests } = fakeNotifier();
    await new DraftInvoiceNotificationAdapter(notifier).sendInvoice({
      tenantId: "t1",
      draft,
      linkId: "link-1",
      url: LINK,
      path: "/c/SECRET-TOKEN",
    });
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request).toMatchObject({
      template: "draft_order_invoice",
      eventKey: "d-1:link-1",
      recipientRef: "cust-1",
      transient: {
        invoice_url: LINK,
        recipient_email: "buyer@example.com",
        recipient_name: "Sara",
      },
    });
    const stored = JSON.stringify({ ...request, transient: undefined });
    expect(stored).not.toContain("SECRET-TOKEN");
    expect(stored).not.toContain("@");
    expect(request.variables["total_minor"]).toBe("95000");
  });

  it("a draft with no customer record is addressed by the draft itself", async () => {
    expect.hasAssertions();
    const { notifier, requests } = fakeNotifier();
    await new DraftInvoiceNotificationAdapter(notifier).sendInvoice({
      tenantId: "t1",
      draft: { ...draft, customer: null },
      linkId: "link-2",
      url: LINK,
      path: "/c/SECRET-TOKEN",
    });
    expect(requests[0]).toMatchObject({ recipientRef: "draft:d-1" });
  });

  it("with no email at all nothing is sent", async () => {
    expect.hasAssertions();
    log = spyLogger();
    const { notifier, requests } = fakeNotifier();
    await new DraftInvoiceNotificationAdapter(notifier).sendInvoice({
      tenantId: "t1",
      draft: { ...draft, email: null, customer: null },
      linkId: "link-3",
      url: LINK,
      path: "/c/SECRET-TOKEN",
    });
    expect(requests).toEqual([]);
    expect(log.dumped()).toContain("NO_RECIPIENT");
  });

  it("without a shop domain the link is STOREFRONT_URL plus the path; with neither nothing is sent", async () => {
    expect.hasAssertions();
    log = spyLogger();
    const withBase = fakeNotifier();
    await new DraftInvoiceNotificationAdapter(
      withBase.notifier,
      "https://store.example/",
    ).sendInvoice({
      tenantId: "t1",
      draft,
      linkId: "link-5",
      url: null,
      path: "/c/SECRET-TOKEN",
    });
    expect(withBase.requests[0]?.transient?.["invoice_url"]).toBe(
      "https://store.example/c/SECRET-TOKEN",
    );
    const without = fakeNotifier();
    await new DraftInvoiceNotificationAdapter(without.notifier).sendInvoice({
      tenantId: "t1",
      draft,
      linkId: "link-6",
      url: null,
      path: "/c/SECRET-TOKEN",
    });
    expect(without.requests).toEqual([]);
    expect(log.dumped()).toContain("NO_LINK_BASE");
    expect(log.dumped()).not.toContain("SECRET-TOKEN");
  });

  it("never throws, and the log carries neither the link nor an address", async () => {
    expect.hasAssertions();
    log = spyLogger();
    const { notifier } = fakeNotifier({ throws: true });
    await expect(
      new DraftInvoiceNotificationAdapter(notifier).sendInvoice({
        tenantId: "t1",
        draft,
        linkId: "link-4",
        url: LINK,
        path: "/c/SECRET-TOKEN",
      }),
    ).resolves.toBeUndefined();
    expect(log.dumped()).not.toContain("SECRET-TOKEN");
    expect(log.dumped()).not.toContain("a@b.test");
    expect(log.dumped()).not.toContain("buyer@example.com");
  });
});
