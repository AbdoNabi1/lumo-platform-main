import {
  runInTenantTransaction,
  runReadScoped,
  type Database,
  type TransactionClient,
} from "@platform/db";
import { MerchantPaymentSettings, type PaymobRegionKey } from "../domain/merchant-payment-settings";
import type { MerchantPaymentSettingsRepository } from "../domain/merchant-payment-settings-repository";
import {
  isPaymentProviderKey,
  type PaymentProviderKey,
} from "../domain/value-objects/payment-provider-key";

/**
 * Production {@link MerchantPaymentSettingsRepository} on `payments.merchant_payment_settings`.
 * ADR-0014: a tenant-agnostic singleton — `tenantId` is a per-call parameter and every read/write
 * runs inside a tenant-scoped transaction (so the table's RLS policy has `app.tenant_id` to check).
 * `paymob_credentials` only ever receives the sealed envelope string the aggregate carries.
 */
export class PrismaMerchantPaymentSettingsRepository implements MerchantPaymentSettingsRepository {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async get(tenantId: string, tx?: unknown): Promise<MerchantPaymentSettings | null> {
    const run = (client: TransactionClient) =>
      client.merchantPaymentSettings.findUnique({ where: { tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.prisma, tenantId, run);
    if (row === null) return null;

    const enabledMethods: PaymentProviderKey[] = row.enabledMethods.filter(isPaymentProviderKey);
    if (enabledMethods.length !== row.enabledMethods.length) {
      throw new Error("Corrupt merchant payment settings: unknown payment method");
    }
    const hasPaymob =
      row.paymobRegion !== null &&
      row.paymobIntegrationId !== null &&
      row.paymobCredentials !== null;
    return MerchantPaymentSettings.reconstitute({
      enabledMethods,
      paymob: hasPaymob
        ? {
            region: row.paymobRegion as PaymobRegionKey,
            integrationId: row.paymobIntegrationId as number,
            sealedCredentials: row.paymobCredentials as string,
          }
        : undefined,
    });
  }

  async save(settings: MerchantPaymentSettings, tenantId: string, tx?: unknown): Promise<void> {
    const data = {
      enabledMethods: [...settings.enabledMethods],
      paymobRegion: settings.paymob?.region ?? null,
      paymobIntegrationId: settings.paymob?.integrationId ?? null,
      paymobCredentials: settings.paymob?.sealedCredentials ?? null,
    };
    const run = (client: TransactionClient) =>
      client.merchantPaymentSettings.upsert({
        where: { tenantId },
        create: { tenantId, ...data },
        update: data,
      });
    if (tx !== undefined && tx !== null) {
      await run(tx as TransactionClient);
      return;
    }
    await runInTenantTransaction(this.prisma, tenantId, run);
  }
}
