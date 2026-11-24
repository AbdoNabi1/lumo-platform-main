import type { Database } from "@platform/db";
import { UniqueEntityId } from "@platform/domain";
import { UnexpectedError, ValidationError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { CustomerSegment } from "../domain/customer-segment";
import { PrismaCustomerSegmentRepository } from "./prisma-customer-segment-repository";

describe("Prisma customer segments", () => {
  it("requires transactions and locks before count and insert", async () => {
    const calls: unknown[] = [];
    const tx = {
      $executeRawUnsafe: async (...args: unknown[]) => {
        calls.push(args);
      },
      customerSegment: {
        count: async () => {
          calls.push("count");
          return 0;
        },
        create: async () => {
          calls.push("create");
        },
      },
    };
    const repo = new PrismaCustomerSegmentRepository({ prisma: {} as Database });
    const segment = CustomerSegment.create(
      UniqueEntityId.from("00000000-0000-0000-0000-000000000001"),
      "x",
      [{ field: "email_subscribed", value: true }],
      null,
      new Date(),
    );
    await expect(repo.save(segment, "a")).rejects.toThrow(
      "PrismaCustomerSegmentRepository.save requires the unit of work's transaction client (ADR-0003).",
    );
    await expect(repo.delete("bad", 1, "a")).rejects.toThrow(
      "PrismaCustomerSegmentRepository.delete requires the unit of work's transaction client (ADR-0003).",
    );
    await expect(repo.withTenantSegmentsLock("a", async () => {})).rejects.toThrow(
      "PrismaCustomerSegmentRepository.withTenantSegmentsLock requires the unit of work's transaction client (ADR-0003).",
    );
    await repo.withTenantSegmentsLock(
      "a",
      async () => {
        await repo.count("a", tx);
        await repo.save(segment, "a", tx);
      },
      tx,
    );
    expect(calls).toEqual([
      ["SELECT pg_advisory_xact_lock(hashtext($1))", "identity.customer_segments:a"],
      "count",
      "create",
    ]);
    expect(await repo.findById("bad", "a")).toBeNull();
  });
  describe("stored row hydration", () => {
    const rowId = "00000000-0000-0000-0000-000000000009";
    const row = (conditions: unknown) => ({
      id: rowId,
      name: "Stored",
      conditions,
      version: 3,
      createdBy: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
    });
    const repoWith = (stored: ReturnType<typeof row>) => {
      const tx = {
        customerSegment: {
          findFirst: async () => stored,
          findMany: async () => [stored],
        },
      };
      return { repo: new PrismaCustomerSegmentRepository({ prisma: {} as Database }), tx };
    };
    it("hydrates a valid stored row", async () => {
      const { repo, tx } = repoWith(row([{ field: "email_subscribed", value: true }]));
      const found = (await repo.findById(rowId, "a", tx))!;
      expect(found.version).toBe(3);
      expect(found.conditions).toEqual([{ field: "email_subscribed", value: true }]);
      expect((await repo.list("a", tx)).map((s) => s.name)).toEqual(["Stored"]);
    });
    it.each([
      ["unknown field", [{ field: "bad" }]],
      ["non-array", { field: "email_subscribed", value: true }],
      ["negative count", [{ field: "orders_count", op: "gte", value: -1 }]],
      ["empty array", []],
    ])("throws corruption for findById and list on %s", async (_label, conditions) => {
      const { repo, tx } = repoWith(row(conditions));
      const byId = await repo.findById(rowId, "a", tx).then(
        () => null,
        (error: unknown) => error,
      );
      expect(byId).toBeInstanceOf(UnexpectedError);
      expect(byId).not.toBeInstanceOf(ValidationError);
      expect((byId as UnexpectedError).message).toBe(
        "Corrupt identity row: invalid segment conditions",
      );
      const listed = await repo.list("a", tx).then(
        () => null,
        (error: unknown) => error,
      );
      expect(listed).toBeInstanceOf(UnexpectedError);
      expect(listed).not.toBeInstanceOf(ValidationError);
    });
  });
});
