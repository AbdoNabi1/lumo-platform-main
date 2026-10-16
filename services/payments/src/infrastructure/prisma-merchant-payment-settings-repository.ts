import {
  runInTenantTransaction,
  runReadScoped,
  type Database,
  type TransactionClient,
} from "@platform/db";
import type { Prisma } from "@prisma/client";
import {
  MerchantPaymentSettings,
  type ProviderSettings,
} from "../domain/merchant-payment-settings";
import type { MerchantPaymentSettingsRepository } from "../domain/merchant-payment-settings-repository";
import {
  isWellFormedProviderKey,
  type PaymentProviderKey,
} from "../domain/value-objects/payment-provider-key";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the `provider_settings` JSON. Anything that is not exactly `{ key: { config, sealedCredentials } }`
 * is corruption and fails LOUDLY — never guessed at, and the message names neither a key's value nor
 * any part of a sealed envelope.
 */
function parseProviderSettings(json: unknown): Record<PaymentProviderKey, ProviderSettings> {
  if (!isPlainObject(json)) {
    throw new Error("Corrupt merchant payment settings: provider settings are not an object");
  }
  const providers: Record<PaymentProviderKey, ProviderSettings> = {};
  for (const [key, entry] of Object.entries(json)) {
    if (
      !isWellFormedProviderKey(key) ||
      !isPlainObject(entry) ||
      !isPlainObject(entry.config) ||
      typeof entry.sealedCredentials !== "string" ||
      entry.sealedCredentials.length === 0
    ) {
      throw new Error("Corrupt merchant payment settings: malformed provider entry");
    }
    providers[key] = { config: entry.config, sealedCredentials: entry.sealedCredentials };
  }
  return providers;
}

function serializeProviderSettings(settings: MerchantPaymentSettings): Prisma.InputJsonObject {
  const out: Record<string, Prisma.InputJsonObject> = {};
  for (const [key, provider] of Object.entries(settings.providers)) {
    out[key] = {
      config: provider.config as Prisma.InputJsonObject,
      sealedCredentials: provider.sealedCredentials,
    };
  }
  return out;
}

/**
 * Production {@link MerchantPaymentSettingsRepository} on `payments.merchant_payment_settings`.
 * ADR-0014: a tenant-agnostic singleton — `tenantId` is a per-call parameter and every read/write
 * runs inside a tenant-scoped transaction (so the table's RLS policy has `app.tenant_id` to check).
 * `provider_settings` only ever receives each provider's opaque config and the sealed envelope
 * string the aggregate carries — this repository knows no provider by name.
 *
 * `enabled_methods` is read as free-form keys: a stored key is only checked for SHAPE here. Whether
 * a provider is still registered is the registry's question at the boundary, so a historical row
 * (`stripe`) keeps reading whichever providers a deployment currently composes.
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

    const enabledMethods: PaymentProviderKey[] = row.enabledMethods.filter(isWellFormedProviderKey);
    if (enabledMethods.length !== row.enabledMethods.length) {
      throw new Error("Corrupt merchant payment settings: malformed payment method");
    }
    return MerchantPaymentSettings.reconstitute({
      enabledMethods,
      providers: parseProviderSettings(row.providerSettings),
    });
  }

  async save(settings: MerchantPaymentSettings, tenantId: string, tx?: unknown): Promise<void> {
    const data = {
      enabledMethods: [...settings.enabledMethods],
      providerSettings: serializeProviderSettings(settings),
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
