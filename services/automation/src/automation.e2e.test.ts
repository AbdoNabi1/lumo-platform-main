import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireAutomation } from "./composition";
import { InMemoryActionDispatcher } from "./infrastructure/in-memory-port-adapters";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire(dispatcher = new InMemoryActionDispatcher()) {
  return wireAutomation({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    dispatcher,
  });
}

function createInput() {
  return {
    name: "Send welcome email",
    triggerType: "event" as const,
    eventType: "customer.created",
    actions: [{ actionType: "send_email", params: { template: "welcome" } }],
  };
}

describe("automation (end to end)", () => {
  it("runs the full lifecycle: create -> activate -> trigger -> dispatch, publishing canonical events", async () => {
    const dispatcher = new InMemoryActionDispatcher();
    const app = wire(dispatcher);
    const created = await app.automation.create(createInput());
    expect(created.status).toBe(201);
    const workflowId = (created.body as { workflowId: string }).workflowId;

    await app.automation.advance({ workflowId, toStatus: "active" });

    const triggered = await app.automation.trigger({ workflowId, triggerId: "trigger-1" });
    expect(triggered.status).toBe(200);
    expect((triggered.body as { duplicate: boolean }).duplicate).toBe(false);
    expect(dispatcher.dispatchedCalls).toHaveLength(1);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("automation.workflow.active");
    expect(app.deliveredEventTypes).toContain("automation.execution.running");
    expect(app.deliveredEventTypes).toContain("automation.execution.succeeded");
  });

  it("triggering is replay-safe by triggerId", async () => {
    const app = wire();
    const created = await app.automation.create(createInput());
    const workflowId = (created.body as { workflowId: string }).workflowId;
    await app.automation.advance({ workflowId, toStatus: "active" });

    await app.automation.trigger({ workflowId, triggerId: "trigger-shared" });
    const replay = await app.automation.trigger({ workflowId, triggerId: "trigger-shared" });
    expect((replay.body as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("rejects creating a duplicate workflow name (409)", async () => {
    const app = wire();
    await app.automation.create(createInput());
    const response = await app.automation.create(createInput());
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown workflow", async () => {
    const app = wire();
    const response = await app.automation.advance({ workflowId: "missing", toStatus: "active" });
    expect(response.status).toBe(404);
  });
});
