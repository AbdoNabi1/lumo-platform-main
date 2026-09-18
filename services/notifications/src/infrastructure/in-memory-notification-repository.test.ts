import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { Notification } from "../domain/notification";
import { DeliveryPolicy } from "../domain/value-objects/delivery-policy";
import { NotificationChannel } from "../domain/value-objects/notification-channel";
import { NotificationTemplate } from "../domain/value-objects/notification-template";
import { Recipient } from "../domain/value-objects/recipient";
import { InMemoryNotificationRepository } from "./in-memory-notification-repository";
import { InMemoryProcessedProviderCallbackStore } from "./in-memory-port-adapters";
import { NotificationsEventTranslator } from "./notifications-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function newNotification(id: string, idempotencyKey: string): Notification {
  const recipient = Recipient.create("customer-1");
  const channel = NotificationChannel.create("email");
  const template = NotificationTemplate.create("order-shipped", "Hi {{name}}");
  if (!recipient.ok || !channel.ok || !template.ok) {
    throw new Error("test setup: invalid value object");
  }
  return Notification.create(
    UniqueEntityId.from(id),
    idempotencyKey,
    "order-1",
    recipient.value,
    [channel.value],
    template.value,
    { name: "Ada" },
    DeliveryPolicy.create(2),
  );
}

function repository() {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new NotificationsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date(0) },
    producer: "notifications",
  });
  return new InMemoryNotificationRepository({
    outbox,
    context: rootEventContext(sequentialIds()),
  });
}

describe("InMemoryNotificationRepository tenant isolation (ADR-0014, WP-10 T10.3)", () => {
  it("keeps the same notification id and idempotency key separate per tenant", async () => {
    const notifications = repository();
    await notifications.save(newNotification("notif-shared-id", "idem-shared"), "tenant-a");
    await notifications.save(newNotification("notif-shared-id", "idem-shared"), "tenant-b");

    expect(await notifications.findById("notif-shared-id", "tenant-a")).not.toBeNull();
    expect(await notifications.findById("notif-shared-id", "tenant-b")).not.toBeNull();
    expect(await notifications.findById("notif-shared-id", "tenant-c")).toBeNull();
    expect(await notifications.findByIdempotencyKey("idem-shared", "tenant-c")).toBeNull();
    expect((await notifications.list({ first: 10 }, "tenant-a")).items).toHaveLength(1);
    expect((await notifications.list({ first: 10 }, "tenant-c")).items).toHaveLength(0);
  });
});

describe("InMemoryProcessedProviderCallbackStore tenant isolation (ADR-0014)", () => {
  it("does not treat another tenant's callback id as already processed", async () => {
    const store = new InMemoryProcessedProviderCallbackStore();
    await store.markProcessed("sendgrid", "cb-1", "tenant-a");

    expect(await store.hasProcessed("sendgrid", "cb-1", "tenant-a")).toBe(true);
    expect(await store.hasProcessed("sendgrid", "cb-1", "tenant-b")).toBe(false);
  });
});

describe("InMemoryNotificationRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("notifications", async (outbox, tenantId) => {
      const notifications = new InMemoryNotificationRepository({
        outbox,
        context: rootEventContext(sequentialIds()),
      });
      const notification = newNotification("notif-1", "idem-1");
      notification.queue("evt-1", new Date(0));
      await notifications.save(notification, tenantId);
    });
  });
});
