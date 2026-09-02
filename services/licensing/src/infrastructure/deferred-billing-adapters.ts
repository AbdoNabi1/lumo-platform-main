import type { FinanceLedgerPort, PaymentsPort } from "../application/ports";

/** Offline in-memory stub — always succeeds. Production swaps this for the deferred adapters below. */
export class InMemoryPaymentsAdapter implements PaymentsPort {
  private counter = 0;

  async collect(): Promise<{ reference: string }> {
    this.counter += 1;
    return { reference: `psp-ref-${this.counter}` };
  }
}

/** Offline in-memory stub — always succeeds. Production swaps this for the deferred adapters below. */
export class InMemoryFinanceLedgerAdapter implements FinanceLedgerPort {
  async postSettlement(): Promise<void> {
    // no-op — offline stub
  }
}

/**
 * Production adapter onto the Payments PSP port (ADR-0012). Wiring the real collection call is a
 * later runtime milestone — deferred stub, mirroring every other cross-context provider adapter
 * this recovery (e.g. Media's `StorageServiceObjectStorage`).
 */
export class DeferredPaymentsAdapter implements PaymentsPort {
  async collect(): Promise<{ reference: string }> {
    throw new Error("DeferredPaymentsAdapter is not wired in this environment yet");
  }
}

/**
 * Production adapter onto the Finance ledger (ADR-0024). Wiring the real ledger-post call is a
 * later runtime milestone — deferred stub, same disposition as `DeferredPaymentsAdapter`.
 */
export class DeferredFinanceLedgerAdapter implements FinanceLedgerPort {
  async postSettlement(): Promise<void> {
    throw new Error("DeferredFinanceLedgerAdapter is not wired in this environment yet");
  }
}
