import { vi } from "vitest";
import type { TemplatedNotificationRequest } from "@platform/notifications";
import { logger } from "@platform/utils";
import type { MailNotifier } from "../notification-trigger";

/** A fake notifier that records every request, with optional failure modes. */
export function fakeNotifier(options: { throws?: boolean; refuses?: boolean } = {}) {
  const requests: TemplatedNotificationRequest[] = [];
  const staffRequests: Omit<TemplatedNotificationRequest, "recipientRef">[] = [];
  const outcome = { notificationId: "n-1", status: "sent", deduplicated: false };
  const notifier: MailNotifier = {
    execute: (request) => {
      requests.push(request);
      if (options.throws === true) return Promise.reject(new Error("db down for a@b.test"));
      return Promise.resolve(
        options.refuses === true
          ? { ok: false as const, error: { code: "VALIDATION" } }
          : { ok: true as const, value: outcome },
      );
    },
    executeForStaff: (request) => {
      staffRequests.push(request);
      return Promise.resolve([{ ok: true as const, value: outcome }]);
    },
  };
  return { notifier, requests, staffRequests };
}

/** Spies on the platform logger so a test can prove nothing sensitive is logged. */
export function spyLogger() {
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  return {
    warn,
    dumped: () => JSON.stringify(warn.mock.calls),
    restore: () => warn.mockRestore(),
  };
}

/** The part of an `Order` the mail data reads. */
export function fakeOrder(overrides: Partial<{ customerRef: string; number: string }> = {}) {
  return {
    customerRef: overrides.customerRef ?? "cust-1",
    currency: "EGP",
    orderNumber: { value: overrides.number ?? "#1042" },
    items: [
      {
        quantity: 2,
        snapshot: {
          name: "<script>alert(1)</script> Shirt",
          variantTitle: "M",
          unitPrice: { amountMinor: 45000 },
        },
      },
    ],
    totals: {
      subtotalMinor: 90000,
      discountMinor: 0,
      shippingMinor: 5000,
      taxMinor: 0,
      totalMinor: 95000,
    },
    totalAmount: () => ({ amountMinor: 95000 }),
  };
}

export function ordersReturning(order: ReturnType<typeof fakeOrder> | null) {
  return {
    getOrder: vi.fn(() =>
      Promise.resolve(
        order === null
          ? { status: 404, body: { code: "NOT_FOUND" } }
          : { status: 200, body: order },
      ),
    ),
  } as never;
}
