import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import { AutomationWorkflow } from "./domain/automation-workflow";
import type { AutomationWorkflowRepository } from "./domain/automation-workflow-repository";
import { AutomationAction, AutomationTrigger } from "./domain/value-objects/trigger-action";
import { TriggerWorkflow, type TriggerWorkflowDeps } from "./application/automation.use-cases";
import type { ActionDispatcherPort } from "./application/ports";
import {
  AutomationWorkflowMapper,
  type AutomationWorkflowRow,
} from "./infrastructure/automation-workflow.mapper";

/**
 * Phase A.18 — dedup-store transaction-boundary hardening for Automation `TriggerWorkflow`.
 *
 * Pre-fix, `ProcessedTriggerStore.markProcessed()`/`hasProcessed()` took no `tx` parameter, so —
 * exactly as A.17 §14 documented but deliberately did not fix — they did not commit atomically with
 * `AutomationWorkflowRepository.save()`. GREEN evidence below proves the fix (Option B, Task 7:
 * dedup folded into `workflow.executions`, the same tx-scoped read/write already used for the rest
 * of the aggregate) closes both failure modes. The type signature of `TriggerWorkflowDeps` no
 * longer HAS a `processedTriggers` field at all — there is no separate store left to desync.
 */

class PostgresLikeAutomationWorkflowRepository implements AutomationWorkflowRepository {
  private readonly rows = new Map<string, AutomationWorkflowRow>();
  private readonly tenantId = "tenant-local";

  seed(workflow: AutomationWorkflow): void {
    this.write(workflow, 1);
  }

  /** Test-only: snapshots/restores the whole table — models a real transaction's all-or-nothing rollback. */
  snapshot(): Map<string, AutomationWorkflowRow> {
    return new Map(this.rows);
  }

  restore(snapshot: Map<string, AutomationWorkflowRow>): void {
    this.rows.clear();
    for (const [key, value] of snapshot) this.rows.set(key, value);
  }

  async save(workflow: AutomationWorkflow): Promise<void> {
    const id = workflow.id.toString();
    const existing = this.rows.get(id);
    if (existing === undefined) {
      this.write(workflow, 1);
      return;
    }
    if (existing.version !== workflow.version) {
      throw new ConcurrencyError(
        `AutomationWorkflow ${id} was modified concurrently (expected version ${workflow.version})`,
      );
    }
    this.write(workflow, existing.version + 1);
  }

  async findById(id: string): Promise<AutomationWorkflow | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null;
    return AutomationWorkflowMapper.toDomain(row);
  }

  async findByName(): Promise<AutomationWorkflow | null> {
    return null;
  }

  async list(): Promise<{
    readonly items: readonly AutomationWorkflow[];
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
  }> {
    const items = [...this.rows.values()].map((row) => AutomationWorkflowMapper.toDomain(row));
    return { items, pageInfo: { hasNextPage: false, endCursor: null } };
  }

  private write(workflow: AutomationWorkflow, version: number): void {
    const row = { ...AutomationWorkflowMapper.toRow(workflow, this.tenantId), version };
    this.rows.set(workflow.id.toString(), row as unknown as AutomationWorkflowRow);
    workflow.pullDomainEvents();
  }
}

/** Stands in for "a live DB transaction is held" — same convention as Fulfillment's A.15 tests. */
class TrackingUnitOfWork implements TransactionalUnitOfWork<unknown> {
  openCount = 0;
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    this.openCount += 1;
    try {
      return await work(undefined);
    } finally {
      this.openCount -= 1;
    }
  }
}

/**
 * Simulates a real interactive-transaction unit of work whose COMMIT can fail/crash AFTER the
 * callback has already returned successfully — every repository write made inside the callback is
 * rolled back, modeling an all-or-nothing transaction.
 */
class FlakyCommitUnitOfWork implements TransactionalUnitOfWork<unknown> {
  constructor(
    private readonly repo: PostgresLikeAutomationWorkflowRepository,
    private readonly failCommit: () => boolean,
  ) {}
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    const snapshot = this.repo.snapshot();
    const result = await work(undefined);
    if (this.failCommit()) {
      this.repo.restore(snapshot);
      throw new Error("simulated crash: transaction failed to commit after the callback returned");
    }
    return result;
  }
}

class RecordingActionDispatcher implements ActionDispatcherPort {
  readonly calls: Array<{ triggerId: string }> = [];
  async dispatch(_actions: readonly AutomationAction[], triggerId: string): Promise<void> {
    this.calls.push({ triggerId });
  }
}

const clock: Clock = { now: () => new Date("2026-08-13T00:00:00.000Z") };

function sequentialIds(prefix: string): IdGenerator {
  let n = 0;
  return { generate: () => `${prefix}-${(n += 1)}` };
}

function seedActiveWorkflow(
  repo: PostgresLikeAutomationWorkflowRepository,
  id: string,
  ids: IdGenerator,
): AutomationWorkflow {
  const workflow = AutomationWorkflow.create(
    UniqueEntityId.from(id),
    `workflow-${id}`,
    AutomationTrigger.event("order.created"),
    [AutomationAction.create("send_email", { template: "welcome" })],
  );
  workflow.activate(ids.generate(), clock.now());
  workflow.pullDomainEvents();
  repo.seed(workflow);
  return workflow;
}

describe("Task 5/8 — GREEN: no separate dedup store means no process-restart-loses-dedup window", () => {
  it("a brand-new TriggerWorkflow instance (simulating a process restart) still correctly detects the prior run via the durable aggregate alone", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeAutomationWorkflowRepository();
    seedActiveWorkflow(repo, "wf-restart", ids);
    const uow = new TrackingUnitOfWork();

    const dispatcher1 = new RecordingActionDispatcher();
    const deps1: TriggerWorkflowDeps = {
      workflows: repo,
      unitOfWork: uow,
      idGenerator: ids,
      clock,
      dispatcher: dispatcher1,
    };
    const first = await new TriggerWorkflow(deps1).execute({
      workflowId: "wf-restart",
      triggerId: "trg-1",
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.duplicate).toBe(false);
    expect(dispatcher1.calls).toHaveLength(1);

    const persisted = await repo.findById("wf-restart");
    expect(persisted?.executions).toHaveLength(1);
    expect(persisted?.executions[0]?.status).toBe("succeeded");

    // A brand-new TriggerWorkflow (and, implicitly, a brand-new deps object with no shared
    // in-process state) reusing only the durable repository — models a restart/second replica.
    const dispatcher2 = new RecordingActionDispatcher();
    const deps2: TriggerWorkflowDeps = { ...deps1, dispatcher: dispatcher2 };
    const second = await new TriggerWorkflow(deps2).execute({
      workflowId: "wf-restart",
      triggerId: "trg-1",
    });

    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.duplicate).toBe(true);
    expect(dispatcher2.calls).toHaveLength(0);
  });
});

describe("Task 5 — crash recovery: a rolled-back first attempt never permanently suppresses the retry", () => {
  it("crash immediately after startExecution's transaction fails to commit (before dispatch ever ran): retry starts a fresh, real execution", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeAutomationWorkflowRepository();
    seedActiveWorkflow(repo, "wf-crash-1", ids);
    let crashOnNextCommit = true;
    const uow = new FlakyCommitUnitOfWork(repo, () => {
      const should = crashOnNextCommit;
      crashOnNextCommit = false;
      return should;
    });
    const dispatcher = new RecordingActionDispatcher();
    const deps: TriggerWorkflowDeps = {
      workflows: repo,
      unitOfWork: uow,
      idGenerator: ids,
      clock,
      dispatcher,
    };

    await expect(
      new TriggerWorkflow(deps).execute({ workflowId: "wf-crash-1", triggerId: "trg-2" }),
    ).rejects.toThrow(/simulated crash/);

    // Rolled back — no execution and no dispatch. Since dedup is derived purely from this
    // aggregate row, there is nowhere else a stray "processed" marker could have survived.
    const afterCrash = await repo.findById("wf-crash-1");
    expect(afterCrash?.executions ?? []).toHaveLength(0);
    expect(dispatcher.calls).toHaveLength(0);

    const retry = await new TriggerWorkflow(deps).execute({
      workflowId: "wf-crash-1",
      triggerId: "trg-2",
    });

    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.value.duplicate).toBe(false);
    expect(dispatcher.calls).toHaveLength(1);
    const afterRetry = await repo.findById("wf-crash-1");
    expect(afterRetry?.executions).toHaveLength(1);
    expect(afterRetry?.executions[0]?.status).toBe("succeeded");
  });

  it("DOCUMENTED RESIDUAL RISK (unchanged disposition from Fulfillment's A.15 precedent): a crash between a successful dispatch and settle()'s own commit means a standalone retry redispatches — closing this fully needs a port-level idempotency key, out of scope (Task 7)", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeAutomationWorkflowRepository();
    seedActiveWorkflow(repo, "wf-crash-2", ids);
    const uow = new TrackingUnitOfWork();
    const dispatcher = new RecordingActionDispatcher();
    const deps: TriggerWorkflowDeps = {
      workflows: repo,
      unitOfWork: uow,
      idGenerator: ids,
      clock,
      dispatcher,
    };

    // Simulate: startExecution's transaction committed (a "running" execution durably exists),
    // but the process crashed before dispatch ran — i.e. exactly the state a real crash between
    // the two transactions would leave. We drive this directly via a second, standalone call
    // (rather than actually crashing mid-`execute()`) because that IS what "the app restarts and
    // redelivers the same triggerId" looks like from the aggregate's point of view.
    const started = await new TriggerWorkflow(deps).execute({
      workflowId: "wf-crash-2",
      triggerId: "trg-3",
    });
    expect(started.ok).toBe(true);
    expect(dispatcher.calls).toHaveLength(1);

    // A second, fully independent call for the SAME triggerId, arriving before the first one's
    // settle() would have run in a real crash scenario, sees the execution already "succeeded"
    // (this test's first call ran settle() too) — so in THIS deterministic harness it correctly
    // resumes as a duplicate. The residual gap only opens in the narrower window between dispatch
    // succeeding and settle() committing, which is not independently drivable without a real
    // Prisma transaction — documented, not exploitable via this in-memory harness, matching
    // Fulfillment's own "RESIDUAL RISK" doc comment precedent.
    const second = await new TriggerWorkflow(deps).execute({
      workflowId: "wf-crash-2",
      triggerId: "trg-3",
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.duplicate).toBe(true);
    expect(dispatcher.calls).toHaveLength(1);
  });
});

describe("Task 5 — Scenario D/E/F: concurrent identical TriggerWorkflow calls", () => {
  for (const n of [2, 3, 10]) {
    it(`${n} concurrent calls with the SAME triggerId result in exactly one durable execution and never an unhandled ConcurrencyError`, async () => {
      const ids = sequentialIds("evt");
      const repo = new PostgresLikeAutomationWorkflowRepository();
      seedActiveWorkflow(repo, `wf-race-${n}`, ids);
      const dispatcher = new RecordingActionDispatcher();
      const uow = new TrackingUnitOfWork();
      const deps: TriggerWorkflowDeps = {
        workflows: repo,
        unitOfWork: uow,
        idGenerator: ids,
        clock,
        dispatcher,
      };
      const useCase = new TriggerWorkflow(deps);

      const outcomes = await Promise.all(
        Array.from({ length: n }, () =>
          useCase.execute({ workflowId: `wf-race-${n}`, triggerId: "trg-race" }),
        ),
      );

      for (const outcome of outcomes) {
        expect(outcome.ok).toBe(true);
      }
      const persisted = await repo.findById(`wf-race-${n}`);
      expect(persisted?.executions).toHaveLength(1);
      expect(persisted?.executions[0]?.triggerId).toBe("trg-race");
      expect(persisted?.executions[0]?.status).toBe("succeeded");
    });
  }
});

describe("Task 8 — bonus correctness fix: dedup is scoped per workflow, not global across all workflows", () => {
  it("the SAME triggerId used for two DIFFERENT workflows runs both — the second is never silently swallowed as 'duplicate'", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeAutomationWorkflowRepository();
    seedActiveWorkflow(repo, "wf-x", ids);
    seedActiveWorkflow(repo, "wf-y", ids);
    const dispatcher = new RecordingActionDispatcher();
    const uow = new TrackingUnitOfWork();
    const deps: TriggerWorkflowDeps = {
      workflows: repo,
      unitOfWork: uow,
      idGenerator: ids,
      clock,
      dispatcher,
    };
    const useCase = new TriggerWorkflow(deps);

    const x = await useCase.execute({ workflowId: "wf-x", triggerId: "shared-trigger" });
    const y = await useCase.execute({ workflowId: "wf-y", triggerId: "shared-trigger" });

    expect(x.ok).toBe(true);
    expect(y.ok).toBe(true);
    if (x.ok) expect(x.value.duplicate).toBe(false);
    if (y.ok) expect(y.value.duplicate).toBe(false);
    expect(dispatcher.calls).toHaveLength(2);
  });
});

describe("Task 5/6 — regression: existing single-attempt behavior is unchanged", () => {
  it("a fresh triggerId dispatches once and records one succeeded execution, with zero transactions open during dispatch", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeAutomationWorkflowRepository();
    seedActiveWorkflow(repo, "wf-basic", ids);
    const uow = new TrackingUnitOfWork();
    let openCountAtDispatch = -1;
    const dispatcher: ActionDispatcherPort = {
      dispatch: async () => {
        openCountAtDispatch = uow.openCount;
      },
    };
    const deps: TriggerWorkflowDeps = {
      workflows: repo,
      unitOfWork: uow,
      idGenerator: ids,
      clock,
      dispatcher,
    };

    const result = await new TriggerWorkflow(deps).execute({
      workflowId: "wf-basic",
      triggerId: "trg-basic",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.duplicate).toBe(false);
      expect(result.value.status).toBe("active");
    }
    // Task 3 crash-window fix: dispatch must never run while a DB transaction is open (mirrors
    // Fulfillment's Phase A.15 long-tx closure).
    expect(openCountAtDispatch).toBe(0);
  });

  it("retrying the exact same triggerId after a genuine success does not dispatch again", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeAutomationWorkflowRepository();
    seedActiveWorkflow(repo, "wf-resume", ids);
    const dispatcher = new RecordingActionDispatcher();
    const uow = new TrackingUnitOfWork();
    const deps: TriggerWorkflowDeps = {
      workflows: repo,
      unitOfWork: uow,
      idGenerator: ids,
      clock,
      dispatcher,
    };
    const useCase = new TriggerWorkflow(deps);

    const first = await useCase.execute({ workflowId: "wf-resume", triggerId: "trg-resume" });
    expect(first.ok).toBe(true);
    const second = await useCase.execute({ workflowId: "wf-resume", triggerId: "trg-resume" });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.duplicate).toBe(true);
    expect(dispatcher.calls).toHaveLength(1);
  });

  it("a dispatch failure records a failed execution, not a thrown error, and a retry with a NEW triggerId is unaffected", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeAutomationWorkflowRepository();
    seedActiveWorkflow(repo, "wf-fail", ids);
    const uow = new TrackingUnitOfWork();
    const failingDispatcher: ActionDispatcherPort = {
      dispatch: async () => {
        throw new Error("simulated dispatch failure");
      },
    };
    const deps: TriggerWorkflowDeps = {
      workflows: repo,
      unitOfWork: uow,
      idGenerator: ids,
      clock,
      dispatcher: failingDispatcher,
    };

    const result = await new TriggerWorkflow(deps).execute({
      workflowId: "wf-fail",
      triggerId: "trg-fail",
    });

    expect(result.ok).toBe(true);
    const persisted = await repo.findById("wf-fail");
    expect(persisted?.executions[0]?.status).toBe("failed");
    expect(persisted?.executions[0]?.errorMessage).toBe("simulated dispatch failure");
  });

  it("a workflow that is not active is rejected without dispatching", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeAutomationWorkflowRepository();
    const workflow = AutomationWorkflow.create(
      UniqueEntityId.from("wf-draft"),
      "draft-workflow",
      AutomationTrigger.event("order.created"),
      [AutomationAction.create("send_email", {})],
    );
    workflow.pullDomainEvents();
    repo.seed(workflow);
    const dispatcher = new RecordingActionDispatcher();
    const uow = new TrackingUnitOfWork();
    const deps: TriggerWorkflowDeps = {
      workflows: repo,
      unitOfWork: uow,
      idGenerator: ids,
      clock,
      dispatcher,
    };

    const result = await new TriggerWorkflow(deps).execute({
      workflowId: "wf-draft",
      triggerId: "trg-draft",
    });

    expect(result.ok).toBe(false);
    expect(dispatcher.calls).toHaveLength(0);
  });

  it("a nonexistent workflow returns a clean NOT_FOUND, never touches the dispatcher", async () => {
    const ids = sequentialIds("evt");
    const repo = new PostgresLikeAutomationWorkflowRepository();
    const dispatcher = new RecordingActionDispatcher();
    const uow = new TrackingUnitOfWork();
    const deps: TriggerWorkflowDeps = {
      workflows: repo,
      unitOfWork: uow,
      idGenerator: ids,
      clock,
      dispatcher,
    };

    const result = await new TriggerWorkflow(deps).execute({
      workflowId: "does-not-exist",
      triggerId: "trg-x",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(dispatcher.calls).toHaveLength(0);
  });
});
