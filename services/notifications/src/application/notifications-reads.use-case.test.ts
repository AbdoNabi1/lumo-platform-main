import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CreateNotification } from "./create-notification.use-case";
import { GetNotification } from "./get-notification.use-case";
import { ListNotifications } from "./list-notifications.use-case";
import { InMemoryNotificationRepository } from "../infrastructure/in-memory-notification-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { NotificationsEventTranslator } from "../infrastructure/notifications-event-translator";

const TENANT = "tenant-a";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new NotificationsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "notifications",
  });
  const context = rootEventContext(sequentialIds());
  const notifications = new InMemoryNotificationRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { notifications, unitOfWork, idGenerator, clock };
}

function createInput(idempotencyKey: string) {
  return {
    tenantId: TENANT,
    idempotencyKey,
    sourceRef: "order-1",
    recipientRef: "customer-1",
    channels: ["email"],
    templateId: "order-shipped",
    bodyPattern: "Hi {{name}}, your order shipped!",
    variables: { name: "Ada" },
    maxAttempts: 2,
  };
}

describe("Notifications read use-cases (Phase 4 T4.12)", () => {
  it("ListNotifications paginates", async () => {
    const h = harness();
    const create = new CreateNotification(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute(createInput(`idem-${i}`));
    }

    const page = await new ListNotifications(h).execute({ tenantId: TENANT, first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListNotifications(h).execute({
      tenantId: TENANT,
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetNotification returns the notification, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreateNotification(h).execute(createInput("idem-x"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetNotification(h).execute({
      tenantId: TENANT,
      notificationId: created.value.notificationId,
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.sourceRef).toBe("order-1");

    const missing = await new GetNotification(h).execute({
      tenantId: TENANT,
      notificationId: "nope",
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
