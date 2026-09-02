import { Client, Connection } from "@temporalio/client";
import { Worker, type NativeConnection } from "@temporalio/worker";
import type { PurchaseSagaActivities, PurchaseSagaInput } from "./saga/purchase-saga";

export const PURCHASE_TASK_QUEUE = "purchase-saga";

export function purchaseWorkflowId(input: PurchaseSagaInput): string {
  // Natural idempotency (ADR-0012 §1): a duplicate start for the same checkout is rejected.
  return `purchase:${input.tenantId}:${input.checkoutSessionId}`;
}

/**
 * Saga worker factory (ADR-0012 §5): one process hosts workflow + activities on the
 * `purchase-saga` task queue, composed alongside the Kafka `ConsumerSupervisor` (the
 * payments-captured consumer signals workflows). Activities receive the contexts' application
 * layers via the implementation object — never repositories. Correlation/trace propagation
 * rides Temporal headers via the OTel interceptors when G-19 wiring lands (seam: `interceptors`
 * in this factory). Requires a Temporal server — construction is gated at composition, honestly.
 */
export async function createPurchaseWorker(
  connection: NativeConnection,
  activities: PurchaseSagaActivities,
): Promise<Worker> {
  return Worker.create({
    connection,
    taskQueue: PURCHASE_TASK_QUEUE,
    workflowsPath: new URL("./workflows/purchase.workflow.js", import.meta.url).pathname,
    activities: { ...activities },
  });
}

/** Client-side starter used by the checkout controller/consumer composition. */
export async function startPurchase(
  address: string,
  input: PurchaseSagaInput,
): Promise<{ workflowId: string }> {
  const connection = await Connection.connect({ address });
  try {
    const client = new Client({ connection });
    const handle = await client.workflow.start("purchaseWorkflow", {
      taskQueue: PURCHASE_TASK_QUEUE,
      workflowId: purchaseWorkflowId(input),
      args: [input],
    });
    return { workflowId: handle.workflowId };
  } finally {
    await connection.close();
  }
}
