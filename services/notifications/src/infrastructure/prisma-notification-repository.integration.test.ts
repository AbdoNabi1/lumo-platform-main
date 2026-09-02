import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { DeliveryPolicy } from "../domain/value-objects/delivery-policy";
import { NotificationChannel } from "../domain/value-objects/notification-channel";
import { NotificationTemplate } from "../domain/value-objects/notification-template";
import { Recipient } from "../domain/value-objects/recipient";
import { Notification } from "../domain/notification";
import { NotificationsEventTranslator } from "./notifications-event-translator";
import { PrismaNotificationRepository } from "./prisma-notification-repository";

/**
 * Phase 4 T4.12 — real PostgreSQL coverage for the new `list` read, following the same reference
 * pattern as `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/notifications test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaNotificationRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new NotificationsEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "notifications",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaNotificationRepository({ prisma, tenantId, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      repository,
      save: (n: Notification) => unitOfWork.run((tx) => repository.save(n, tx)),
    };
  }

  function newNotification(idempotencyKey: string): Notification {
    const recipient = Recipient.create("customer-1");
    const channel = NotificationChannel.create("email");
    const template = NotificationTemplate.create("order-shipped", "Hi {{name}}");
    if (!recipient.ok || !channel.ok || !template.ok) {
      throw new Error("test setup: invalid value object");
    }
    return Notification.create(
      UniqueEntityId.from(ids.generate()),
      idempotencyKey,
      "order-1",
      recipient.value,
      [channel.value],
      template.value,
      { name: "Ada" },
      DeliveryPolicy.create(2),
    );
  }

  it("list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-notifications-${crypto.randomUUID()}`;
    const other = `tenant-itest-notifications-other-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);
    const { repository: otherRepository, save: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await save(newNotification(`idem-${i}`));
    }
    await saveOther(newNotification("idem-x"));

    const page = await repository.list({ first: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);

    const rest = await repository.list({ first: 10, after: page.pageInfo.endCursor ?? undefined });
    expect(rest.items).toHaveLength(1);
    expect(rest.pageInfo.hasNextPage).toBe(false);

    const otherPage = await otherRepository.list({ first: 10 });
    expect(otherPage.items).toHaveLength(1);
    await prisma.$disconnect();
  });
});
