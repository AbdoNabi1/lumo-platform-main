import {
  runInTenantTransaction,
  runReadScoped,
  type Database,
  type TransactionClient,
} from "@platform/db";
import { ConcurrencyError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
import {
  MerchantCarrierSettings,
  type CarrierWebhookSecrets,
  type StoredCarrierSettings,
} from "../domain/merchant-carrier-settings";
import type { MerchantCarrierSettingsRepository } from "../domain/merchant-carrier-settings-repository";
import { isWellFormedCarrierKey } from "../domain/value-objects/carrier-key";

const ENTRY_KEYS: ReadonlySet<string> = new Set(["config", "sealedCredentials", "webhook"]);
const WEBHOOK_KEYS: ReadonlySet<string> = new Set([
  "sealedSecret",
  "previousSealedSecret",
  "previousValidUntil",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSealed(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Every message names WHAT is wrong, never a key's value or any part of an envelope. */
function corrupt(what: string): Error {
  return new Error(`Corrupt merchant carrier settings: ${what}`);
}

function parseWebhook(json: unknown): CarrierWebhookSecrets {
  if (!isPlainObject(json) || Object.keys(json).some((k) => !WEBHOOK_KEYS.has(k))) {
    throw corrupt("malformed webhook secrets");
  }
  if (!isSealed(json.sealedSecret)) throw corrupt("missing webhook secret");

  const hasPrevious = json.previousSealedSecret !== undefined;
  const hasUntil = json.previousValidUntil !== undefined;
  if (!hasPrevious && !hasUntil) return { sealedSecret: json.sealedSecret };
  if (!hasPrevious || !hasUntil || !isSealed(json.previousSealedSecret)) {
    throw corrupt("previous webhook secret without its expiry");
  }
  const until =
    typeof json.previousValidUntil === "string" ? new Date(json.previousValidUntil) : null;
  if (until === null || Number.isNaN(until.getTime())) {
    throw corrupt("unreadable previous webhook secret expiry");
  }
  return {
    sealedSecret: json.sealedSecret,
    previousSealedSecret: json.previousSealedSecret,
    previousValidUntil: until,
  };
}

/**
 * Reads `carrier_settings`. Anything that is not exactly
 * `{ key: { config, sealedCredentials, webhook: { sealedSecret, previous...? } } }` is corruption
 * and fails LOUDLY, never guessed at.
 */
function parseCarrierSettings(json: unknown): Record<string, StoredCarrierSettings> {
  if (!isPlainObject(json)) throw corrupt("carrier settings are not an object");
  const carriers: Record<string, StoredCarrierSettings> = {};
  for (const [key, entry] of Object.entries(json)) {
    if (
      !isWellFormedCarrierKey(key) ||
      !isPlainObject(entry) ||
      Object.keys(entry).some((k) => !ENTRY_KEYS.has(k)) ||
      !isPlainObject(entry.config) ||
      !isSealed(entry.sealedCredentials)
    ) {
      throw corrupt("malformed carrier entry");
    }
    carriers[key] = {
      config: entry.config,
      sealedCredentials: entry.sealedCredentials,
      webhook: parseWebhook(entry.webhook),
    };
  }
  return carriers;
}

function serializeCarrierSettings(settings: MerchantCarrierSettings): Prisma.InputJsonObject {
  const out: Record<string, Prisma.InputJsonObject> = {};
  for (const [key, carrier] of Object.entries(settings.carriers)) {
    const { webhook } = carrier;
    out[key] = {
      config: carrier.config as Prisma.InputJsonObject,
      sealedCredentials: carrier.sealedCredentials,
      webhook: {
        sealedSecret: webhook.sealedSecret,
        ...(webhook.previousSealedSecret !== undefined && webhook.previousValidUntil !== undefined
          ? {
              previousSealedSecret: webhook.previousSealedSecret,
              previousValidUntil: webhook.previousValidUntil.toISOString(),
            }
          : {}),
      },
    };
  }
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Production {@link MerchantCarrierSettingsRepository} on `shipping.merchant_carrier_settings`.
 * ADR-0014: a tenant-agnostic singleton. Every read and write names `tenantId` and runs in a
 * tenant-scoped transaction, so the table's RLS policy has `app.tenant_id` to check.
 *
 * Versioning (Ruling 29, preflight F11): settings at version 0 are inserted as version 1; at
 * version n they update `where { tenantId, version: n }` and increment. Zero rows updated, or a
 * unique violation on the insert (two first saves racing), is a {@link ConcurrencyError}.
 */
export class PrismaMerchantCarrierSettingsRepository implements MerchantCarrierSettingsRepository {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async get(tenantId: string, tx?: unknown): Promise<MerchantCarrierSettings | null> {
    const run = (client: TransactionClient) =>
      client.merchantCarrierSettings.findUnique({ where: { tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.prisma, tenantId, run);
    if (row === null) return null;

    if (!row.enabledCarriers.every(isWellFormedCarrierKey)) {
      throw corrupt("malformed enabled carrier");
    }
    return MerchantCarrierSettings.reconstitute({
      enabledCarriers: row.enabledCarriers,
      carriers: parseCarrierSettings(row.carrierSettings),
      version: row.version,
    });
  }

  async save(settings: MerchantCarrierSettings, tenantId: string, tx?: unknown): Promise<void> {
    const data = {
      enabledCarriers: [...settings.enabledCarriers],
      carrierSettings: serializeCarrierSettings(settings),
    };
    const version = settings.version;
    const run = async (client: TransactionClient): Promise<void> => {
      if (version === 0) {
        try {
          await client.merchantCarrierSettings.create({ data: { tenantId, ...data, version: 1 } });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConcurrencyError("Merchant carrier settings were created concurrently", {
              cause: error,
            });
          }
          throw error;
        }
        return;
      }
      const { count } = await client.merchantCarrierSettings.updateMany({
        where: { tenantId, version },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new ConcurrencyError("Merchant carrier settings changed since they were read");
      }
    };
    if (tx !== undefined && tx !== null) {
      await run(tx as TransactionClient);
      return;
    }
    await runInTenantTransaction(this.prisma, tenantId, run);
  }
}
