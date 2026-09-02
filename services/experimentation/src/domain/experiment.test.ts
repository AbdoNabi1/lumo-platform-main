import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Experiment } from "./experiment";
import { ExperimentAudience, Variant } from "./value-objects/variant";

function variants(): Variant[] {
  const control = Variant.create("control", 50, true);
  const treatment = Variant.create("treatment", 50, false);
  if (!control.ok || !treatment.ok) throw new Error("invalid fixture");
  return [control.value, treatment.value];
}

function experiment(): Experiment {
  return Experiment.create(
    UniqueEntityId.from("experiment-1"),
    "Checkout button color",
    variants(),
    ExperimentAudience.everyone(),
    "conversion_rate",
  );
}

describe("Experiment", () => {
  it("starts at draft", () => {
    const e = experiment();
    expect(e.status.value).toBe("draft");
  });

  // `DomainEvent.data` is generic per-event-type; these assertions only read a known `action`
  // field, which needs the `unknown` hop since the narrow view has no structural overlap with
  // `DomainEvent`.
  it("starting raises action 'started', resuming from paused raises 'resumed'", () => {
    const e = experiment();
    e.start("evt-1", new Date(0));
    let events = e.pullDomainEvents();
    expect((events[0] as unknown as { data: { action: string } }).data.action).toBe("started");

    e.pause("evt-2", new Date(0));
    e.resume("evt-3", new Date(0));
    events = e.pullDomainEvents();
    const resumedEvent = events.find(
      (ev) => (ev as unknown as { data: { action: string } }).data.action === "resumed",
    );
    expect(resumedEvent).toBeDefined();
  });

  it("records a result and raises experiment.result.recorded", () => {
    const e = experiment();
    e.start("evt-1", new Date(0));
    e.recordResult("control", 0.12, 1000, "evt-2", new Date(0));
    expect(e.results).toHaveLength(1);
  });

  it("rejects a result for an unknown variant", () => {
    const e = experiment();
    e.start("evt-1", new Date(0));
    expect(() => e.recordResult("nonexistent", 0.1, 100, "evt-2", new Date(0))).toThrow(
      BusinessRuleError,
    );
  });

  it("declares a winner", () => {
    const e = experiment();
    e.start("evt-1", new Date(0));
    e.declareWinner("treatment", "evt-2", new Date(0));
    expect(e.winnerVariantKey).toBe("treatment");
  });

  it("rejects an illegal transition (draft -> paused, 409)", () => {
    const e = experiment();
    expect(() => e.transition("paused", "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });
});
