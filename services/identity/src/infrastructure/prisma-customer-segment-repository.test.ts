import type { Database } from "@platform/db";
import { UniqueEntityId } from "@platform/domain";
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
});
