import { describe, expect, it } from "vitest";
import type { NotificationsController } from "@platform/notifications";
import { OrdersNotificationAdapter } from "./orders-notification.adapter";

interface CreateCall {
  readonly idempotencyKey: string;
  readonly sourceRef: string;
  readonly recipientRef: string;
  readonly channels: readonly string[];
  readonly templateId: string;
  readonly bodyPattern: string;
  readonly subjectPattern?: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly maxAttempts: number;
}

interface FakeCalls {
  readonly sequence: string[];
  readonly create: CreateCall[];
  readonly queue: { notificationId: string }[];
  readonly send: { notificationId: string }[];
}

/** A fake `NotificationsController` narrowed to `create`/`queue`/`send` — the 3 methods this adapter calls — recording both the sequence and the arguments of every call. */
function fakeNotificationsController(
  calls: FakeCalls,
  options: { failAt?: "create" | "queue" | "send" } = {},
): Pick<NotificationsController, "create" | "queue" | "send"> {
  let counter = 0;
  return {
    async create(input) {
      calls.sequence.push("create");
      calls.create.push(input);
      if (options.failAt === "create") {
        return { status: 422, body: { code: "VALIDATION", message: "bad input" } };
      }
      counter += 1;
      return { status: 201, body: { notificationId: `notif-${counter}`, status: "created" } };
    },
    async queue(input) {
      calls.sequence.push("queue");
      calls.queue.push(input);
      if (options.failAt === "queue") {
        return { status: 409, body: { code: "CONFLICT", message: "cannot queue" } };
      }
      return { status: 200, body: { notificationId: input.notificationId, status: "queued" } };
    },
    async send(input) {
      calls.sequence.push("send");
      calls.send.push(input);
      if (options.failAt === "send") {
        return { status: 409, body: { code: "CONFLICT", message: "cannot send" } };
      }
      return { status: 200, body: { notificationId: input.notificationId, status: "sent" } };
    },
  };
}

function emptyCalls(): FakeCalls {
  return { sequence: [], create: [], queue: [], send: [] };
}

describe("OrdersNotificationAdapter (Orders -> Notifications, C-3)", () => {
  it("follows the create -> queue -> send sequence in order", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls);
    const adapter = new OrdersNotificationAdapter(notifications);

    await adapter.notify("customer-1", "ORD-1001", "fulfillment_requested");

    expect(calls.sequence).toEqual(["create", "queue", "send"]);
    expect(calls.queue[0]?.notificationId).toBe("notif-1");
    expect(calls.send[0]?.notificationId).toBe("notif-1");
  });

  it("maps customerRef/orderNumber/status into a minimal, sane CreateNotificationInput", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls);
    const adapter = new OrdersNotificationAdapter(notifications);

    await adapter.notify("customer-42", "ORD-2002", "fulfillment_requested");

    const created = calls.create[0];
    expect(created).toBeDefined();
    expect(created?.recipientRef).toBe("customer-42");
    expect(created?.sourceRef).toContain("ORD-2002");
    expect(created?.channels).toEqual(["email"]);
    expect(created?.templateId.length).toBeGreaterThan(0);
    expect(created?.bodyPattern).toContain("{{orderNumber}}");
    expect(created?.bodyPattern).toContain("{{status}}");
    expect(created?.variables).toEqual({
      orderNumber: "ORD-2002",
      status: "fulfillment_requested",
    });
    expect(created?.maxAttempts).toBeGreaterThan(0);
  });

  it("idempotencyKey is stable across repeated calls with the same customerRef/orderNumber/status", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls);
    const adapter = new OrdersNotificationAdapter(notifications);

    await adapter.notify("customer-1", "ORD-3003", "shipped");
    await adapter.notify("customer-1", "ORD-3003", "shipped");

    expect(calls.create).toHaveLength(2);
    expect(calls.create[0]?.idempotencyKey).toBe(calls.create[1]?.idempotencyKey);
  });

  it("idempotencyKey differs across different statuses for the same order", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls);
    const adapter = new OrdersNotificationAdapter(notifications);

    await adapter.notify("customer-1", "ORD-4004", "fulfillment_requested");
    await adapter.notify("customer-1", "ORD-4004", "shipped");

    expect(calls.create[0]?.idempotencyKey).not.toBe(calls.create[1]?.idempotencyKey);
  });

  it("propagates a create failure (no swallowing here — the call site already swallows)", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls, { failAt: "create" });
    const adapter = new OrdersNotificationAdapter(notifications);

    await expect(adapter.notify("customer-1", "ORD-5005", "shipped")).rejects.toThrow();
    expect(calls.sequence).toEqual(["create"]);
  });

  it("propagates a queue failure after a successful create", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls, { failAt: "queue" });
    const adapter = new OrdersNotificationAdapter(notifications);

    await expect(adapter.notify("customer-1", "ORD-6006", "shipped")).rejects.toThrow();
    expect(calls.sequence).toEqual(["create", "queue"]);
  });

  it("propagates a send failure after a successful create+queue", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls, { failAt: "send" });
    const adapter = new OrdersNotificationAdapter(notifications);

    await expect(adapter.notify("customer-1", "ORD-7007", "shipped")).rejects.toThrow();
    expect(calls.sequence).toEqual(["create", "queue", "send"]);
  });
});
