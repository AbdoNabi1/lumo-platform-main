import type {
  InventoryPort,
  InventoryReservationResult,
  NotificationPort,
  PaymentCaptureResult,
  PaymentPort,
  PaymentVerificationPort,
  ShipmentResult,
  ShippingPort,
} from "../application/ports";

/**
 * Offline in-memory stub adapters for the 4 outbound ports. Production swaps these for the
 * Payments/Inventory/Shipping/Notifications adapters (or the ADR-0012 saga's own activities) at
 * the composition root — unchanged interface, no domain/application impact.
 */
export class InMemoryPaymentAdapter implements PaymentPort {
  private counter = 0;

  async requestCapture(orderId: string): Promise<PaymentCaptureResult> {
    this.counter += 1;
    return { paymentRef: `payment-${orderId}-${this.counter}` };
  }
}

/**
 * Reference implementation of `InventoryPort`'s Phase A.16 idempotency contract (see `ports.ts`):
 * dedupes by `(tenantId, orderId)`, so a retried `requestReservation()` for the same order reuses the same
 * `reservationRef` instead of minting a second one.
 */
export class InMemoryInventoryAdapter implements InventoryPort {
  private counter = 0;
  private readonly byOrderId = new Map<string, InventoryReservationResult>();

  async requestReservation(orderId: string, tenantId: string): Promise<InventoryReservationResult> {
    const key = JSON.stringify([tenantId, orderId]);
    const existing = this.byOrderId.get(key);
    if (existing !== undefined) return existing;
    this.counter += 1;
    const result = { reservationRef: `reservation-${orderId}-${this.counter}` };
    this.byOrderId.set(key, result);
    return result;
  }
}

/** Reference implementation of `ShippingPort`'s Phase A.16 idempotency contract — same shape as `InMemoryInventoryAdapter`. */
export class InMemoryShippingAdapter implements ShippingPort {
  private counter = 0;
  private readonly byOrderId = new Map<string, ShipmentResult>();

  async requestShipment(orderId: string, tenantId: string): Promise<ShipmentResult> {
    const key = JSON.stringify([tenantId, orderId]);
    const existing = this.byOrderId.get(key);
    if (existing !== undefined) return existing;
    this.counter += 1;
    const result = { shipmentRef: `shipment-${orderId}-${this.counter}` };
    this.byOrderId.set(key, result);
    return result;
  }
}

export class InMemoryNotificationAdapter implements NotificationPort {
  async notify(): Promise<void> {
    // Offline stub: no-op. Production swaps this for the Notifications adapter.
  }
}

/** Offline stub: always verifies (same "no-op passthrough" convention as `InMemoryShippingAdapter.verifyReturnShipment`). Production swaps this for a real Payments-backed check. */
export class InMemoryPaymentVerificationAdapter implements PaymentVerificationPort {
  async hasCapturedPayment(): Promise<boolean> {
    return true;
  }
}
