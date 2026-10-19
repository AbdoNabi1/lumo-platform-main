import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { buildListFixture } from "./order-list-fixture";
import { OrderEventTranslator } from "./order-event-translator";
import { PrismaOrderAnnotationRepository } from "./prisma-order-annotation-repository";
import { PrismaOrderRepository } from "./prisma-order-repository";
import { PrismaOrderTimelineRepository } from "./prisma-order-timeline-repository";

/** Order operations Part 2 against a real PostgreSQL. HONESTLY GATED on `DATABASE_URL_TEST`. */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))(
  "Prisma order annotations and timeline (integration, order operations Part 2)",
  () => {
    const runPrefix = crypto.randomUUID().slice(0, 8);
    let n = 0;
    const nextId = () => `${runPrefix}-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
    const tenantId = `tenant-notes-${runPrefix}`;
    const fixture = buildListFixture(nextId);
    const first = fixture[0]?.order.id.toString() ?? "";
    const second = fixture[1]?.order.id.toString() ?? "";
    let prisma: ReturnType<typeof createTestPrismaClient>;
    let annotations: PrismaOrderAnnotationRepository;
    let timeline: PrismaOrderTimelineRepository;
    let unitOfWork: PrismaUnitOfWork;

    beforeAll(async () => {
      prisma = createTestPrismaClient(databaseUrl);
      const orders = new PrismaOrderRepository({
        prisma,
        outbox: new OutboxWriter({
          store: new PrismaOutboxStore(prisma),
          translator: new OrderEventTranslator(),
          serializer: new InMemoryEventSerializer(),
          clock: { now: () => new Date() },
          producer: "orders",
        }),
        context: rootEventContext({ generate: nextId }),
      });
      unitOfWork = new PrismaUnitOfWork(prisma);
      for (const { order } of fixture.slice(0, 2)) {
        await unitOfWork.run((tx) => orders.save(order, tenantId, tx));
      }
      annotations = new PrismaOrderAnnotationRepository({ prisma });
      timeline = new PrismaOrderTimelineRepository({ prisma });
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("adds tags once per key, lists them alphabetically and removes them by key", async () => {
      await unitOfWork.run((tx) =>
        annotations.addTags(
          [first, second],
          [
            { tag: "VIP", tagKey: "vip" },
            { tag: "Urgent", tagKey: "urgent" },
          ],
          tenantId,
          tx,
        ),
      );
      const again = await unitOfWork.run((tx) =>
        annotations.addTags([first], [{ tag: "vip", tagKey: "vip" }], tenantId, tx),
      );
      expect(again.size).toBe(0);
      expect((await annotations.annotationsOf([first], tenantId)).get(first)?.tags).toEqual([
        "Urgent",
        "VIP",
      ]);
      const removed = await unitOfWork.run((tx) =>
        annotations.removeTags([second], ["urgent"], tenantId, tx),
      );
      expect([...removed]).toEqual([[second, ["Urgent"]]]);
    });

    it("suggests by literal prefix, most used first, with the earliest spelling", async () => {
      expect(await annotations.tagsInUse(tenantId, "V")).toEqual([{ tag: "VIP", count: 2 }]);
      expect(await annotations.tagsInUse(tenantId, "%")).toEqual([]);
      expect(await annotations.tagsInUse(tenantId)).toEqual([
        { tag: "VIP", count: 2 },
        { tag: "Urgent", count: 1 },
      ]);
    });

    it("sets the note without touching the order's version", async () => {
      const before = await prisma.order.findFirst({ where: { tenantId, id: first } });
      await unitOfWork.run((tx) => annotations.setNote(first, "Ring twice", tenantId, tx));
      const after = await prisma.order.findFirst({ where: { tenantId, id: first } });
      expect(after?.note).toBe("Ring twice");
      expect(after?.version).toBe(before?.version);
    });

    it("appends, lists newest first and soft-deletes timeline entries", async () => {
      const entry = {
        id: nextId(),
        orderId: first,
        kind: "comment" as const,
        authorRef: "staff-1",
        authorName: "Ahmed",
        body: "Called — no answer",
        data: {},
        createdAt: new Date("2026-10-19T09:00:00.000Z"),
        editedAt: null,
        deletedAt: null,
      };
      const activity = {
        ...entry,
        id: nextId(),
        kind: "tags_added" as const,
        body: null,
        data: { tags: ["VIP"] },
        createdAt: new Date("2026-10-19T09:05:00.000Z"),
      };
      await unitOfWork.run(async (tx) => {
        await timeline.append(entry, tenantId, tx);
        await timeline.append(activity, tenantId, tx);
      });
      await unitOfWork.run((tx) =>
        timeline.update(
          { ...entry, deletedAt: new Date("2026-10-19T10:00:00.000Z") },
          tenantId,
          tx,
        ),
      );
      const listed = await timeline.listForOrder(first, tenantId, { first: 200 });
      expect(listed.map((line) => line.kind)).toEqual(["tags_added", "comment"]);
      expect(listed[0]?.data).toEqual({ tags: ["VIP"] });
      expect(listed[1]?.deletedAt).not.toBeNull();
      expect(listed[1]?.body).toBe("Called — no answer");
    });
  },
);
