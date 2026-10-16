import { describe, expect, it } from "vitest";
import type { NotificationsController } from "@platform/notifications";
import { PaymentsNotificationAdapter } from "./payments-notification.adapter";

interface CreateCall {
  readonly tenantId: string;
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
  readonly queue: { notificationId: string; tenantId: string }[];
  readonly send: { notificationId: string; tenantId: string }[];
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

describe("PaymentsNotificationAdapter (Payments -> Notifications, C-3)", () => {
  it("follows the create -> queue -> send sequence in order", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls);
    const adapter = new PaymentsNotificationAdapter(notifications);

    await adapter.notify("ORD-1001", "captured", "tenant-a");

    expect(calls.sequence).toEqual(["create", "queue", "send"]);
    expect(calls.queue[0]?.notificationId).toBe("notif-1");
    expect(calls.send[0]?.notificationId).toBe("notif-1");
    expect(
      [calls.create[0], calls.queue[0], calls.send[0]].map(
        (c) => (c as { tenantId?: string } | undefined)?.tenantId,
      ),
    ).toEqual(["tenant-a", "tenant-a", "tenant-a"]);
  });

  it("one adapter instance serves two tenants, each call carrying its own tenant (ADR-0014)", async () => {
    const calls = emptyCalls();
    const adapter = new PaymentsNotificationAdapter(fakeNotificationsController(calls));

    await adapter.notify("ORD-1001", "captured", "tenant-a");
    await adapter.notify("ORD-1001", "captured", "tenant-b");

    expect(calls.create.map((c) => (c as { tenantId?: string }).tenantId)).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
    expect(calls.send.map((c) => c.tenantId)).toEqual(["tenant-a", "tenant-b"]);
  });

  it("maps orderRef/status into a minimal, sane CreateNotificationInput", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls);
    const adapter = new PaymentsNotificationAdapter(notifications);

    await adapter.notify("ORD-2002", "captured", "tenant-a");

    const created = calls.create[0];
    expect(created).toBeDefined();
    expect(created?.recipientRef).toBe("ORD-2002");
    expect(created?.sourceRef).toContain("ORD-2002");
    expect(created?.channels).toEqual(["email"]);
    expect(created?.templateId.length).toBeGreaterThan(0);
    expect(created?.bodyPattern).toContain("{{orderRef}}");
    expect(created?.bodyPattern).toContain("{{status}}");
    expect(created?.variables).toEqual({ orderRef: "ORD-2002", status: "captured" });
    expect(created?.maxAttempts).toBeGreaterThan(0);
  });

  it("idempotencyKey is stable across repeated calls with the same orderRef/status", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls);
    const adapter = new PaymentsNotificationAdapter(notifications);

    await adapter.notify("ORD-3003", "captured", "tenant-a");
    await adapter.notify("ORD-3003", "captured", "tenant-a");

    expect(calls.create).toHaveLength(2);
    expect(calls.create[0]?.idempotencyKey).toBe(calls.create[1]?.idempotencyKey);
  });

  it("idempotencyKey differs across different statuses for the same order", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls);
    const adapter = new PaymentsNotificationAdapter(notifications);

    await adapter.notify("ORD-4004", "created", "tenant-a");
    await adapter.notify("ORD-4004", "captured", "tenant-a");

    expect(calls.create[0]?.idempotencyKey).not.toBe(calls.create[1]?.idempotencyKey);
  });

  it("propagates a create failure (no swallowing here — the call site already swallows)", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls, { failAt: "create" });
    const adapter = new PaymentsNotificationAdapter(notifications);

    await expect(adapter.notify("ORD-5005", "captured", "tenant-a")).rejects.toThrow();
    expect(calls.sequence).toEqual(["create"]);
  });

  it("propagates a queue failure after a successful create", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls, { failAt: "queue" });
    const adapter = new PaymentsNotificationAdapter(notifications);

    await expect(adapter.notify("ORD-6006", "captured", "tenant-a")).rejects.toThrow();
    expect(calls.sequence).toEqual(["create", "queue"]);
  });

  it("propagates a send failure after a successful create+queue", async () => {
    const calls = emptyCalls();
    const notifications = fakeNotificationsController(calls, { failAt: "send" });
    const adapter = new PaymentsNotificationAdapter(notifications);

    await expect(adapter.notify("ORD-7007", "captured", "tenant-a")).rejects.toThrow();
    expect(calls.sequence).toEqual(["create", "queue", "send"]);
  });
});
