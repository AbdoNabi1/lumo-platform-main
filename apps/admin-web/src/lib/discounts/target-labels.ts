import { fetchCategoriesPage } from "@/lib/api/categories";
import { fetchCustomer } from "@/lib/api/customers";
import type { DiscountDto } from "@/lib/api/discounts";
import { fetchProduct } from "@/lib/api/products";
import type { Locale } from "@/lib/i18n";
import { countryName } from "@/lib/shipping/display";
import type { TargetLabels } from "./form";

/** How many products/customers a discount page names; the rest show by id until re-picked. */
const MAX_NAMED = 50;

/**
 * Names for the ids a saved discount points at, so the form shows "Sneaker" rather than an id. Read
 * on the server with the existing detail routes; a failed read leaves that id unnamed rather than
 * failing the page.
 */
export async function resolveTargetLabels(dto: DiscountDto, locale: Locale): Promise<TargetLabels> {
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  const addAll = (scope: "products" | "categories", refs: readonly string[]) => {
    for (const ref of refs) (scope === "categories" ? categoryIds : productIds).add(ref);
  };
  if (dto.appliesTo !== null) addAll(dto.appliesTo.kind, dto.appliesTo.refs);
  if (dto.buys !== null) addAll(dto.buys.scope, dto.buys.refs);
  if (dto.gets !== null) addAll(dto.gets.scope, dto.gets.refs);
  const customerIds =
    dto.customerEligibility.kind === "customers" ? dto.customerEligibility.customerRefs : [];

  const [products, categories, customers] = await Promise.all([
    Promise.all(
      [...productIds].slice(0, MAX_NAMED).map(async (id) => {
        const result = await fetchProduct(id);
        return result.outcome === "ok" ? ([id, result.product.name] as const) : null;
      }),
    ),
    categoryIds.size === 0 ? null : fetchCategoriesPage({ first: 100 }),
    Promise.all(
      customerIds.slice(0, MAX_NAMED).map(async (id) => {
        const result = await fetchCustomer(id);
        if (result.outcome !== "ok") return null;
        const { name, email } = result.customer;
        return [id, name === "" ? email : name] as const;
      }),
    ),
  ]);

  const entries = (pairs: readonly (readonly [string, string] | null)[]) =>
    Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => pair !== null));

  return {
    products: entries(products),
    categories:
      categories?.outcome === "ok"
        ? Object.fromEntries(categories.items.map((item) => [item.id, item.name]))
        : {},
    customers: entries(customers),
    countries: Object.fromEntries(
      (dto.countries ?? []).map((code) => [code, countryName(code, locale)]),
    ),
  };
}
