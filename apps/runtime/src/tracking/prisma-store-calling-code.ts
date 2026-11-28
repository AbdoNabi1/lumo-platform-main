/**
 * The calling code a store's customers type national phone numbers in (Tracking P2-D7), read from its own currency.
 *
 * An order keeps the phone as typed (`01012345678`); no ad platform matches that until it is E.164, and a national
 * number cannot be upgraded without knowing the country. The store currency (tenancy owns `store_settings`; the
 * default for a store that never saved settings is EGP) names the market: EGP 20, SAR 966, AED 971, ...
 *
 * Read-only, tenant-scoped (`runReadScoped`, `tenantId` in the `where`). A read that fails is not an error for the
 * caller: the answer is Egypt's code, because dropping every phone of an Egyptian store for a transient read failure
 * costs far more than a wrong guess for a Gulf store that is corrected by the next process start.
 */

import { runReadScoped, type Database } from "@platform/db";
import { callingCodeForCurrency, DEFAULT_CALLING_CODE } from "@platform/tracking";

export function prismaStoreCallingCodeOf(
  prisma: Database,
  onError?: (error: unknown) => void,
): (tenantId: string) => Promise<string> {
  return async (tenantId) => {
    try {
      const row = await runReadScoped(prisma, tenantId, (client) =>
        client.storeSettings.findFirst({ where: { tenantId }, select: { currency: true } }),
      );
      return callingCodeForCurrency(row?.currency);
    } catch (error) {
      onError?.(error);
      return DEFAULT_CALLING_CODE;
    }
  };
}
