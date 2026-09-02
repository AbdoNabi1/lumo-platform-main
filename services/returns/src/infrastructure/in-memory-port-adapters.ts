import type {
  InventoryPort,
  NotificationPort,
  OrdersPort,
  PaymentsPort,
  RefundVerificationPort,
  RestockItem,
  ShippingPort,
} from "../application/ports";

/**
 * Offline in-memory stub adapters for the 4 reference-only outbound ports. Production swaps these
 * for the real Orders/Payments/Inventory/Shipping adapters at the composition root — unchanged
 * interface.
 */
export class InMemoryOrdersAdapter implements OrdersPort {
  async reportReturnOutcome(): Promise<void> {
    // Offline stub: no-op. Production swaps this for the Orders adapter.
  }
}

export class InMemoryNotificationAdapter implements NotificationPort {
  async notify(): Promise<void> {
    // Offline stub: no-op. Production swaps this for the Notifications adapter.
  }
}

export class InMemoryPaymentsAdapter implements PaymentsPort {
  async requestRefund(): Promise<void> {
    // Offline stub: no-op. Production swaps this for the Payments adapter.
  }
}

/** Offline stub for `RefundVerificationPort` — always verifies (no backing store to check against, same convention as `InMemoryPaymentVerificationAdapter` in Orders). Production swaps this for a real Orders/Payments-backed check. */
export class InMemoryRefundVerificationAdapter implements RefundVerificationPort {
  async isRefundable(): Promise<boolean> {
    return true;
  }
}

export class InMemoryInventoryAdapter implements InventoryPort {
  async restock(_orderRef: string, _items: readonly RestockItem[]): Promise<void> {
    // Offline stub: no-op. Production swaps this for the Inventory adapter.
  }
}

export class InMemoryShippingAdapter implements ShippingPort {
  async verifyReturnShipment(): Promise<boolean> {
    return true;
  }
}
