import type { ShopFactsPort, SiteType } from "@platform/leads";
import { AppError } from "@platform/utils";

type Response = { readonly status: number; readonly body: unknown };
interface ShopFacts {
  readonly siteType: SiteType;
  readonly currency: string;
}

function unavailable(cause?: unknown): AppError {
  return new AppError("shop facts unavailable", {
    code: "UNAVAILABLE",
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * Leads' read of the shop's own facts, from tenancy's public store view (ADR-0014 8f: a closure of
 * the tenancy controller, so no tenancy object hangs off the leads graph). A shop whose facts cannot
 * be read must not take (or refuse) a lead on a guess: a rejected read, a non-200 or a body without a
 * known `siteType` and a string `currency` all throw `UNAVAILABLE`, which the transport answers 503
 * with no details.
 */
export function tenancyShopFacts(
  getPublicStore: (tenantId: string) => Promise<Response>,
): ShopFactsPort {
  const read = async (tenantId: string): Promise<ShopFacts> => {
    let res: Response;
    try {
      res = await getPublicStore(tenantId);
    } catch (error) {
      throw unavailable(error);
    }
    if (res.status !== 200) throw unavailable();
    const body = res.body as { siteType?: unknown; currency?: unknown } | null;
    const siteType = body?.siteType;
    const currency = body?.currency;
    if ((siteType !== "store" && siteType !== "lead_site") || typeof currency !== "string") {
      throw unavailable();
    }
    return { siteType, currency };
  };
  return {
    siteTypeOf: async (tenantId) => (await read(tenantId)).siteType,
    currencyOf: async (tenantId) => (await read(tenantId)).currency,
  };
}
