import type {
  TemplatedNotificationOutcome,
  TemplatedNotificationRequest,
} from "@platform/notifications";
import { logger } from "@platform/utils";

/** The slice of the notifier every trigger uses. */
export interface MailNotifier {
  execute(
    request: TemplatedNotificationRequest,
  ): Promise<
    | { readonly ok: true; readonly value: TemplatedNotificationOutcome }
    | { readonly ok: false; readonly error: { readonly code: string } }
  >;
  executeForStaff(
    request: Omit<TemplatedNotificationRequest, "recipientRef">,
  ): Promise<
    readonly (
      | { readonly ok: true; readonly value: TemplatedNotificationOutcome }
      | { readonly ok: false; readonly error: { readonly code: string } }
    )[]
  >;
}

/**
 * Wave 2b (D42): runs one mail trigger so that NOTHING it does can fail or roll back the order,
 * payment, fulfilment or draft transition it hangs off. A thrown error or a refused request is logged
 * as the trigger's name, the order reference and a short reason: never an address, a name or a body
 * (ADR-0006).
 */
export async function guardedTrigger(
  trigger: string,
  fields: { readonly tenantId: string; readonly orderRef?: string },
  work: () => Promise<{ readonly ok: boolean; readonly error?: { readonly code: string } } | void>,
): Promise<void> {
  try {
    const outcome = await work();
    if (outcome !== undefined && outcome.ok === false) {
      logger.warn("notification trigger refused", {
        trigger,
        ...fields,
        reason: outcome.error?.code ?? "REFUSED",
      });
    }
  } catch (error) {
    logger.warn("notification trigger failed", {
      trigger,
      ...fields,
      reason: error instanceof Error ? error.name : "UNKNOWN",
    });
  }
}

/**
 * Orders Checkout placed and then undid (no stock) were never announced, so cancelling them must not
 * mail "your order was canceled". Checkout's cancellation adapter marks the id for the duration of its
 * own cancel call; the order notification adapter skips a marked id. In-process on purpose: both run in
 * the same call.
 */
export class UnannouncedOrders {
  private readonly ids = new Set<string>();

  mark(orderId: string): void {
    this.ids.add(orderId);
  }

  clear(orderId: string): void {
    this.ids.delete(orderId);
  }

  has(orderId: string): boolean {
    return this.ids.has(orderId);
  }
}
