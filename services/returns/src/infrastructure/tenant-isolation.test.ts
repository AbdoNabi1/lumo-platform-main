import { describe, expect, it } from "vitest";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { ReturnRequest } from "../domain/return-request";
import { ReturnItem } from "../domain/value-objects/return-item";
import { ReturnReason } from "../domain/value-objects/return-reason";
import { InMemoryReturnRequestRepository } from "./in-memory-return-request-repository";
import { ReturnsEventTranslator } from "./returns-event-translator";

/** ADR-0014 (WP-10, T10.3): one Returns repository serves every tenant. */
function unwrap<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("test setup: invalid VO");
  return result.value;
}

function newReturn(id: string): ReturnRequest {
  const item = ReturnItem.create(
    UniqueEntityId.from("ri-1"),
    "order-item-1",
    unwrap(ProductRef.create("product-1")),
    1,
    unwrap(ReturnReason.create("defective")),
  );
  return ReturnRequest.create(UniqueEntityId.from(id), "order-1", [item]);
}

function repository(outbox?: OutboxWriter) {
  const writer =
    outbox ??
    new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new ReturnsEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "returns",
    });
  return new InMemoryReturnRequestRepository({
    outbox: writer,
    context: rootEventContext({ generate: () => "evt-x" }),
  });
}

describe("returns tenant isolation (ADR-0014)", () => {
  it("two tenants sharing one repository and an identical order ref never see each other's returns", async () => {
    const repo = repository();
    await repo.save(newReturn("rr-1"), "tenant-a");

    expect(await repo.findById("rr-1", "tenant-b")).toBeNull();
    expect(await repo.findByOrderRef("order-1", "tenant-b")).toBeNull();
    expect(await repo.findByOrderRef("order-1", "tenant-a")).not.toBeNull();
  });

  it("merges the per-call tenantId into the outbox event context at write time", async () => {
    await assertWriteTimeTenant("returns", async (outbox, tenantId) => {
      const rr = newReturn("rr-1");
      rr.approve("evt-1", new Date(0));
      await repository(outbox).save(rr, tenantId);
    });
  });
});
