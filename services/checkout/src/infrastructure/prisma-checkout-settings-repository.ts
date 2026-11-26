import {
  runInTenantTransaction,
  runReadScoped,
  type Database,
  type TransactionClient,
} from "@platform/db";
import { ConcurrencyError } from "@platform/utils";
import {
  ACCOUNTS_MODES,
  LINE2_MODES,
  MARKETING_EMAIL_PROMPTS,
  NAME_MODES,
  PHONE_MODES,
  type CheckoutSettingsValues,
  type StoredCheckoutSettings,
} from "../domain/checkout-settings";
import type { CheckoutSettingsRepository } from "../domain/checkout-settings-repository";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function pick<T extends string>(column: string, value: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Corrupt checkout settings: unknown ${column}`);
}

/**
 * Production {@link CheckoutSettingsRepository} on `checkout.checkout_settings`. Every read and
 * write names `tenantId` and runs in a tenant-scoped transaction, so the table's RLS policy has
 * `app.tenant_id` to check. Writes reuse the unit of work's transaction when one is given.
 *
 * Versioning: no row = version null; the first save inserts version 1 (a unique violation - two first
 * saves racing - is a `ConcurrencyError`); a later save updates `where { tenantId, version }` and
 * increments, and zero rows updated is a `ConcurrencyError`.
 */
export class PrismaCheckoutSettingsRepository implements CheckoutSettingsRepository {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async find(tenantId: string, tx?: unknown): Promise<StoredCheckoutSettings | null> {
    const run = (client: TransactionClient) =>
      client.checkoutSettings.findUnique({ where: { tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.prisma, tenantId, run);
    if (row === null) return null;
    return {
      values: {
        nameMode: pick("name_mode", row.nameMode, NAME_MODES),
        phoneMode: pick("phone_mode", row.phoneMode, PHONE_MODES),
        line2Mode: pick("line2_mode", row.line2Mode, LINE2_MODES),
        marketingEmailPrompt: pick(
          "marketing_email_prompt",
          row.marketingEmailPrompt,
          MARKETING_EMAIL_PROMPTS,
        ),
        cartLineLimit: row.cartLineLimit,
        requireLogin: row.requireLogin,
        accountsMode: pick("accounts_mode", row.accountsMode, ACCOUNTS_MODES),
        showAccountLink: row.showAccountLink,
      },
      version: row.version,
    };
  }

  async save(
    tenantId: string,
    values: CheckoutSettingsValues,
    expectedVersion: number | null,
    tx?: unknown,
  ): Promise<number> {
    const run = async (client: TransactionClient): Promise<number> => {
      if (expectedVersion === null) {
        try {
          await client.checkoutSettings.create({ data: { tenantId, ...values, version: 1 } });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConcurrencyError("Checkout settings were created concurrently", {
              cause: error,
            });
          }
          throw error;
        }
        return 1;
      }
      const { count } = await client.checkoutSettings.updateMany({
        where: { tenantId, version: expectedVersion },
        data: { ...values, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new ConcurrencyError("Checkout settings changed since they were read");
      }
      return expectedVersion + 1;
    };
    if (tx !== undefined && tx !== null) return run(tx as TransactionClient);
    return runInTenantTransaction(this.prisma, tenantId, run);
  }
}
