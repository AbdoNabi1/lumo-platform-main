import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { DraftOrder, type DraftOrderContent } from "../domain/draft-order";
import { PrismaDraftNumberAllocator } from "./prisma-draft-number-allocator";
import { PrismaDraftOrderRepository } from "./prisma-draft-order-repository";
import { PrismaOrderNumberAllocator } from "./prisma-order-number-allocator";

/** Order operations Part 4 drafts against a real PostgreSQL. HONESTLY GATED on `DATABASE_URL_TEST`. */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))(
  "Prisma draft orders and draft numbers (integration, order operations Part 4)",
  () => {
    const runPrefix = crypto.randomUUID().slice(0, 8);
    const tenantA = `tenant-draft-a-${runPrefix}`;
    const tenantB = `tenant-draft-b-${runPrefix}`;
    const tenantNew = `tenant-draft-new-${runPrefix}`;
    const tenants = [tenantA, tenantB, tenantNew];
    const idOf = (n: number) => `${runPrefix}-0000-7000-8000-${n.toString().padStart(12, "0")}`;
    const NOW = new Date("2026-10-25T10:00:00.000Z");
    const address = (name: string, phone: string | null) => ({
      name,
      phone,
      line1: "1 Nile St",
      line2: null,
      city: "Cairo",
      province: "EG-C",
      postalCode: "",
      country: "EG",
    });
    const contentOf = (email: string, name: string, phone: string | null): DraftOrderContent => ({
      customerRef: null,
      contactEmail: email,
      contactPhone: null,
      shippingAddress: address(name, phone),
      billingAddress: null,
      lines: [
        {
          productRef: "p-1",
          variantRef: "v-1",
          sku: "S",
          title: "Tee",
          variantTitle: null,
          quantity: 1,
          unitPriceMinor: 1000,
        },
      ],
      discount: null,
      shipping: { kind: "free", title: "Free shipping", amountMinor: 0 },
      note: null,
      tags: [],
    });
    let prisma: ReturnType<typeof createTestPrismaClient>;
    let repo: PrismaDraftOrderRepository;
    let unitOfWork: PrismaUnitOfWork;

    async function seed(
      tenantId: string,
      n: number,
      email: string,
      name: string,
      phone: string | null,
    ): Promise<void> {
      const created = DraftOrder.create({
        id: idOf(n),
        draftNumber: `D${n}`,
        currency: "EGP",
        createdBy: "staff-1",
        now: NOW,
        content: contentOf(email, name, phone),
      });
      if (!created.ok) throw created.error;
      await unitOfWork.run((tx) => repo.save(created.value, tenantId, tx));
    }
    const numbers = async (query: Parameters<PrismaDraftOrderRepository["list"]>[0]) =>
      (await repo.list(query, tenantA)).items.map((d) => d.draftNumber);

    async function cleanup(): Promise<void> {
      await prisma.draftOrder.deleteMany({ where: { tenantId: { in: tenants } } });
      await prisma.$executeRaw`DELETE FROM "orders"."order_number_counters" WHERE "tenant_id" IN (${tenantA}, ${tenantB}, ${tenantNew})`;
    }

    beforeAll(async () => {
      prisma = createTestPrismaClient(databaseUrl);
      repo = new PrismaDraftOrderRepository({ prisma });
      unitOfWork = new PrismaUnitOfWork(prisma);
      await cleanup();
    });

    afterEach(cleanup);

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("lists a shop's drafts newest first and never another shop's", async () => {
      await seed(tenantA, 1, "sara@example.com", "Sara", null);
      await seed(tenantA, 2, "omar@example.com", "Omar", null);
      await seed(tenantA, 3, "mona@example.com", "Mona Ali", null);
      await seed(tenantB, 4, "other@example.com", "Other", null);
      expect(await numbers({})).toEqual(["D3", "D2", "D1"]);
      expect((await repo.list({}, tenantB)).items.map((d) => d.draftNumber)).toEqual(["D4"]);
    });

    it("pages by the last id", async () => {
      await seed(tenantA, 1, "sara@example.com", "Sara", null);
      await seed(tenantA, 2, "omar@example.com", "Omar", null);
      await seed(tenantA, 3, "mona@example.com", "Mona Ali", null);
      const first = await repo.list({ first: 2 }, tenantA);
      expect(first.items.map((d) => d.draftNumber)).toEqual(["D3", "D2"]);
      expect(first.pageInfo.hasNextPage).toBe(true);
      const second = await repo.list({ first: 2, after: first.pageInfo.endCursor ?? "" }, tenantA);
      expect(second.items.map((d) => d.draftNumber)).toEqual(["D1"]);
      expect(second.pageInfo.hasNextPage).toBe(false);
    });

    it("searches the number, email, recipient name and phone, and treats % literally", async () => {
      await seed(tenantA, 1, "sara@example.com", "Sara", "01001112222");
      await seed(tenantA, 2, "omar@example.com", "Omar", "01203334444");
      await seed(tenantA, 3, "mona@example.com", "Mona Ali", "01505556666");
      expect(await numbers({ search: "d2" })).toEqual(["D2"]);
      expect(await numbers({ search: "SARA@EXAMPLE" })).toEqual(["D1"]);
      expect(await numbers({ search: "mona a" })).toEqual(["D3"]);
      expect(await numbers({ search: "0120333" })).toEqual(["D2"]);
      expect(await numbers({ search: "%" })).toEqual([]);
    });

    it("filters by status and hides soft-deleted drafts", async () => {
      await seed(tenantA, 1, "sara@example.com", "Sara", null);
      await seed(tenantA, 2, "omar@example.com", "Omar", null);
      expect(await unitOfWork.run((tx) => repo.markInvoiceSent(idOf(2), NOW, tenantA, tx))).toBe(
        true,
      );
      expect(await numbers({ status: "invoice_sent" })).toEqual(["D2"]);
      expect(await unitOfWork.run((tx) => repo.softDelete(idOf(1), NOW, tenantA, tx))).toBe(true);
      expect(await numbers({})).toEqual(["D2"]);
    });

    it("draft numbers count D1, D2 for a new shop, and its first order is still 1001", async () => {
      const drafts = new PrismaDraftNumberAllocator();
      const orders = new PrismaOrderNumberAllocator();
      expect(await unitOfWork.run((tx) => drafts.next(tenantNew, tx))).toBe("D1");
      expect(await unitOfWork.run((tx) => drafts.next(tenantNew, tx))).toBe("D2");
      expect(await unitOfWork.run((tx) => orders.next(tenantNew, tx))).toBe("1001");
    });
  },
);
