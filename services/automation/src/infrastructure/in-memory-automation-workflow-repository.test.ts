import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { AutomationWorkflow } from "../domain/automation-workflow";
import { AutomationTrigger } from "../domain/value-objects/trigger-action";
import { AutomationEventTranslator } from "./automation-event-translator";
import { InMemoryAutomationWorkflowRepository } from "./in-memory-automation-workflow-repository";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new AutomationEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-08-30T00:00:00.000Z") },
    producer: "automation",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryAutomationWorkflowRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryAutomationWorkflowRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's workflow by id, name, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const workflow = AutomationWorkflow.create(
      UniqueEntityId.from(nextId()),
      "order-confirmation",
      AutomationTrigger.event("order.placed"),
      [],
    );
    await repository.save(workflow, "tenant-a");

    expect(await repository.findById(workflow.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(workflow.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findByName("order-confirmation", "tenant-a")).not.toBeNull();
    expect(await repository.findByName("order-confirmation", "tenant-b")).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((w) => w.id.toString())).toContain(workflow.id.toString());
    expect(pageB.items.map((w) => w.id.toString())).not.toContain(workflow.id.toString());
  });
});
