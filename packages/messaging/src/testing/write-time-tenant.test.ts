import { describe, expect, it } from "vitest";
import { DomainEvent, type DomainEventProps, UniqueEntityId } from "@platform/domain";
import { rootEventContext } from "../outbox/event-context";
import { assertWriteTimeTenant, type CapturingOutboxWriter } from "./write-time-tenant";

class Touched extends DomainEvent {
  readonly eventName = "x.touched";
  constructor(props: DomainEventProps) {
    super(props);
  }
}

const ids = { generate: () => "00000000-0000-7000-8000-000000000001" };
const event = () =>
  new Touched({
    eventId: "e1",
    aggregateId: UniqueEntityId.from("00000000-0000-7000-8000-000000000002"),
    occurredAt: new Date(0),
  });

describe("assertWriteTimeTenant", () => {
  it("passes when the per-call tenant is merged at write time", async () => {
    const singleton = rootEventContext(ids);
    await expect(
      assertWriteTimeTenant("ok", async (outbox: CapturingOutboxWriter, tenantId) => {
        await outbox.write([event()], { ...singleton, tenantId });
      }),
    ).resolves.toBeUndefined();
  });

  it("fails when the singleton context is handed through untouched", async () => {
    const singleton = rootEventContext(ids);
    await expect(
      assertWriteTimeTenant("bad", async (outbox: CapturingOutboxWriter) => {
        await outbox.write([event()], singleton);
      }),
    ).rejects.toThrow(/reached the outbox with tenantId undefined/);
  });

  it("fails when nothing was written (vacuous)", async () => {
    await expect(assertWriteTimeTenant("empty", async () => {})).rejects.toThrow(/vacuous/);
  });
});
