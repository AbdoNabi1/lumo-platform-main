import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { ExampleAggregate } from "./example-aggregate";
import { ExampleRegistered } from "./example-registered.event";

describe("ExampleAggregate", () => {
  it("registers with a supplied identity and raises ExampleRegistered", () => {
    const id = UniqueEntityId.from("example-1");
    const example = ExampleAggregate.register(
      id,
      "demo",
      "evt-1",
      new Date("2026-06-30T00:00:00.000Z"),
    );

    expect(example.label).toBe("demo");

    const events = example.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(ExampleRegistered);
    expect(events[0]?.eventName).toBe("example.registered");
    expect(example.pullDomainEvents()).toHaveLength(0); // events were pulled and cleared
  });
});
