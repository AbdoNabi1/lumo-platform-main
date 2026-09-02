import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { AutomationWorkflow } from "./automation-workflow";
import { AutomationAction, AutomationTrigger } from "./value-objects/trigger-action";

function workflow(): AutomationWorkflow {
  return AutomationWorkflow.create(
    UniqueEntityId.from("workflow-1"),
    "Send welcome email",
    AutomationTrigger.event("customer.created"),
    [AutomationAction.create("send_email", { template: "welcome" })],
  );
}

describe("AutomationWorkflow", () => {
  it("starts at draft", () => {
    const w = workflow();
    expect(w.status.value).toBe("draft");
  });

  it("starts and completes an execution successfully", () => {
    const w = workflow();
    w.activate("evt-1", new Date(0));
    const execution = w.startExecution("trigger-1", "evt-2", new Date(0));
    expect(execution.status).toBe("running");
    w.completeExecutionSuccess(execution.id.toString(), "evt-3", new Date(0));
    expect(execution.status).toBe("succeeded");
  });

  it("retries a failed execution, then dead-letters once attempts are exhausted", () => {
    const w = workflow();
    w.activate("evt-1", new Date(0));
    const execution = w.startExecution("trigger-1", "evt-2", new Date(0));
    w.completeExecutionFailure(execution.id.toString(), "boom", "evt-3", new Date(0));
    w.retryExecution(execution.id.toString(), "evt-4", new Date(0));
    expect(execution.status).toBe("running");
    w.completeExecutionFailure(execution.id.toString(), "boom again", "evt-5", new Date(0));
    w.retryExecution(execution.id.toString(), "evt-6", new Date(0));
    expect(execution.status).toBe("running");
    w.completeExecutionFailure(execution.id.toString(), "boom thrice", "evt-7", new Date(0));
    w.retryExecution(execution.id.toString(), "evt-8", new Date(0));
    expect(execution.status).toBe("dead_letter");
  });

  it("rejects starting an execution on a non-active workflow", () => {
    const w = workflow();
    expect(() => w.startExecution("trigger-1", "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("rejects an illegal transition (draft -> paused, 409)", () => {
    const w = workflow();
    expect(() => w.transition("paused", "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });
});
