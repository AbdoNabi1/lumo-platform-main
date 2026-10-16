import { hasProvinces, isProvinceOf } from "@platform/regions";
import { ValidationError, type FieldIssue } from "@platform/utils";

/**
 * Plan 3C: a country with province data (Egypt's governorates, Saudi Arabia's regions, the emirates)
 * needs a province of that country on its address, because shipping zones and tax rates are decided
 * by it; a country without such data takes none. Returns the problem, or `null` when the province is
 * right. The region data lives in `@platform/regions`, which the domain layer may not import, so
 * the check sits here with the use cases.
 */
export function provinceProblem(
  country: string,
  province: string | undefined,
): ValidationError | null {
  const given = province?.trim() ?? "";
  const issue = ((): FieldIssue | null => {
    if (hasProvinces(country)) {
      if (given.length === 0) return { field: "province", message: "required for this country" };
      if (!isProvinceOf(country, given)) {
        return { field: "province", message: `${given} is not a province of ${country}` };
      }
      return null;
    }
    if (given.length > 0) {
      return { field: "province", message: `${country} has no provinces to choose from` };
    }
    return null;
  })();
  return issue === null ? null : new ValidationError("Invalid address", [issue]);
}
