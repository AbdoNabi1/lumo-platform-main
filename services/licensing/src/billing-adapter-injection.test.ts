import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { FinanceLedgerPort, PaymentsPort } from "./application/ports";
import { wireLicensing } from "./composition";

/**
 * M2-3: `buildController` in `composition.ts` hardcoded `InMemoryPaymentsAdapter`/
 * `InMemoryFinanceLedgerAdapter` with no injection seam at all — a subscription's invoice could be
 * marked "collected" with zero money ever moved, silently, because nothing could override the
 * stub. Proves the new `payments`/`financeLedger` seam on `LicensingWiringDeps` actually takes
 * effect: an injected adapter is authoritative, and its failure surfaces as a real invoice
 * failure instead of the stub's unconditional success.
 */

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-08-06T00:00:00.000Z") };

async function createIssuedInvoice(app: ReturnType<typeof wireLicensing>): Promise<string> {
  const invoice = await app.licensing.createInvoice({
    tenantRef: "tenant-1",
    subscriptionRef: "sub-1",
    currency: "USD",
    lineItems: [{ description: "Growth plan", amount: 2900 }],
  });
  const invoiceId = (invoice.body as { id: string }).id;
  await app.licensing.issueInvoice({ invoiceId });
  return invoiceId;
}

class RecordingPaymentsAdapter implements PaymentsPort {
  calls: Array<{ tenantRef: string; amount: number; currency: string }> = [];
  async collect(
    tenantRef: string,
    amount: number,
    currency: string,
  ): Promise<{ reference: string }> {
    this.calls.push({ tenantRef, amount, currency });
    return { reference: "real-psp-ref-1" };
  }
}

class RejectingPaymentsAdapter implements PaymentsPort {
  async collect(): Promise<{ reference: string }> {
    throw new Error("card declined");
  }
}

class RecordingFinanceLedgerAdapter implements FinanceLedgerPort {
  calls: Array<{ tenantRef: string; amount: number; currency: string; reference: string }> = [];
  async postSettlement(
    tenantRef: string,
    amount: number,
    currency: string,
    reference: string,
  ): Promise<void> {
    this.calls.push({ tenantRef, amount, currency, reference });
  }
}

describe("Licensing billing adapter injection (M2-3)", () => {
  it("uses the injected payments/financeLedger adapters — a real PSP reference reaches the ledger post", async () => {
    const payments = new RecordingPaymentsAdapter();
    const financeLedger = new RecordingFinanceLedgerAdapter();
    const app = wireLicensing({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      payments,
      financeLedger,
    });
    const invoiceId = await createIssuedInvoice(app);

    const collected = await app.licensing.collectInvoice({ invoiceId });

    expect(collected.status).toBe(200);
    expect(payments.calls).toEqual([{ tenantRef: "tenant-1", amount: 2900, currency: "USD" }]);
    expect(financeLedger.calls).toEqual([
      { tenantRef: "tenant-1", amount: 2900, currency: "USD", reference: "real-psp-ref-1" },
    ]);
  });

  it("propagates a real PSP failure instead of the stub's unconditional success", async () => {
    const app = wireLicensing({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      payments: new RejectingPaymentsAdapter(),
      financeLedger: new RecordingFinanceLedgerAdapter(),
    });
    const invoiceId = await createIssuedInvoice(app);

    await expect(app.licensing.collectInvoice({ invoiceId })).rejects.toThrow("card declined");
  });

  it("falls back to the always-succeeds in-memory stubs only when nothing is injected — unchanged prior behavior", async () => {
    const app = wireLicensing({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
    });
    const invoiceId = await createIssuedInvoice(app);

    const collected = await app.licensing.collectInvoice({ invoiceId });
    expect(collected.status).toBe(200);
  });
});
