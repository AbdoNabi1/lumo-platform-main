import { variantSkuFor } from "./handles";

export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 100;

export interface MatrixOption {
  readonly name: string;
  readonly values: readonly string[];
}

export interface MatrixVariant {
  readonly id: string;
  readonly sku: string;
  readonly selection: Readonly<Record<string, string>> | null;
  readonly priceAmountMinor: number;
  readonly currency: string;
}

export type MatrixOperation =
  | { readonly kind: "remove"; readonly variantId: string }
  | { readonly kind: "setOptions"; readonly options: readonly MatrixOption[] }
  | {
      readonly kind: "assign";
      readonly variantId: string;
      readonly selection: Readonly<Record<string, string>> | null;
    }
  | {
      readonly kind: "add";
      readonly sku: string;
      readonly selection: Readonly<Record<string, string>>;
      readonly priceAmountMinor: number;
      readonly currency: string;
    };

/** One resulting variant: the existing id it keeps, or `null` for a new one. */
export interface MatrixRow {
  readonly selection: Readonly<Record<string, string>> | null;
  readonly variantId: string | null;
}

export type OptionPlan =
  | {
      readonly ok: true;
      readonly operations: readonly MatrixOperation[];
      readonly summary: { readonly adds: number; readonly removes: number };
      readonly rows: readonly MatrixRow[];
    }
  | { readonly ok: false; readonly reason: "too_many_variants" | "invalid_options" };

export function combinations(options: readonly MatrixOption[]): Record<string, string>[] {
  let result: Record<string, string>[] = [{}];
  for (const option of options) {
    result = result.flatMap((partial) =>
      option.values.map((value) => ({ ...partial, [option.name]: value })),
    );
  }
  return options.length === 0 ? [] : result;
}

/** A stable key for a row: option names sorted, so key order never matters. */
export function rowKey(selection: Readonly<Record<string, string>> | null): string {
  if (selection === null) return "default";
  return Object.keys(selection)
    .sort()
    .map((name) => `${name}=${selection[name]}`)
    .join("|");
}

export function sameSelection(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function validOptions(options: readonly MatrixOption[]): boolean {
  if (options.length > MAX_OPTIONS) return false;
  const names = new Set<string>();
  for (const option of options) {
    const name = option.name.trim().toLowerCase();
    if (name.length === 0 || names.has(name)) return false;
    names.add(name);
    if (option.values.length === 0) return false;
    if (option.values.some((value) => value.trim().length === 0)) return false;
    if (new Set(option.values).size !== option.values.length) return false;
  }
  return true;
}

/**
 * Plan 2C-2: turns "these variants + these new options" into API operations whose EVERY
 * intermediate state is legal for the Plan 2C-1 domain (≥1 variant; unique non-null selections;
 * selections use declared values; setOptions refused while a variant holds a removed value).
 * Order: remove → clear re-assigned selections → setOptions → assign → add. Existing variants keep
 * their ids wherever a combination can take them (carts and stock point at variant ids).
 */
export function planOptionChange(input: {
  readonly productSku: string;
  readonly variants: readonly MatrixVariant[];
  readonly nextOptions: readonly MatrixOption[];
}): OptionPlan {
  const { productSku, variants, nextOptions } = input;
  if (!validOptions(nextOptions)) return { ok: false, reason: "invalid_options" };
  const combos = combinations(nextOptions);
  if (combos.length > MAX_VARIANTS) return { ok: false, reason: "too_many_variants" };
  const [first] = variants;
  if (first === undefined) return { ok: false, reason: "invalid_options" };

  const operations: MatrixOperation[] = [];

  if (combos.length === 0) {
    const keep = first;
    for (const variant of variants.slice(1)) {
      operations.push({ kind: "remove", variantId: variant.id });
    }
    if (keep.selection !== null) {
      operations.push({ kind: "assign", variantId: keep.id, selection: null });
    }
    operations.push({ kind: "setOptions", options: [] });
    return {
      ok: true,
      operations,
      summary: { adds: 0, removes: variants.length - 1 },
      rows: [{ selection: null, variantId: keep.id }],
    };
  }

  // 1. Variants already sitting on a combination keep it.
  const claimed = new Map<number, MatrixVariant>();
  const unplaced: MatrixVariant[] = [];
  for (const variant of variants) {
    const index =
      variant.selection === null
        ? -1
        : combos.findIndex((c, i) => !claimed.has(i) && sameSelection(c, variant.selection!));
    if (index >= 0) claimed.set(index, variant);
    else unplaced.push(variant);
  }

  // 2. The others take free combinations in order, a partial match first (a variant that had
  //    Size: S takes Size: S / Color: Red before an unrelated combination).
  const reassigned: { variant: MatrixVariant; index: number }[] = [];
  const toRemove: MatrixVariant[] = [];
  for (const variant of unplaced) {
    const free = combos
      .map((combo, index) => ({ combo, index }))
      .filter(({ index }) => !claimed.has(index));
    const partial = free.find(
      ({ combo }) =>
        variant.selection !== null &&
        Object.entries(variant.selection).every(([name, value]) => combo[name] === value),
    );
    const target = partial ?? free[0];
    if (target === undefined) {
      toRemove.push(variant);
    } else {
      claimed.set(target.index, variant);
      reassigned.push({ variant, index: target.index });
    }
  }

  for (const variant of toRemove) operations.push({ kind: "remove", variantId: variant.id });
  for (const { variant } of reassigned) {
    if (variant.selection !== null) {
      operations.push({ kind: "assign", variantId: variant.id, selection: null });
    }
  }
  operations.push({
    kind: "setOptions",
    options: nextOptions.map((o) => ({ name: o.name, values: [...o.values] })),
  });
  for (const { variant, index } of reassigned) {
    operations.push({ kind: "assign", variantId: variant.id, selection: combos[index]! });
  }

  const taken = new Set(variants.map((variant) => variant.sku));
  let adds = 0;
  combos.forEach((combo, index) => {
    if (claimed.has(index)) return;
    const sku = variantSkuFor(
      productSku,
      nextOptions.map((o) => combo[o.name]!),
      taken,
    );
    taken.add(sku);
    operations.push({
      kind: "add",
      sku,
      selection: combo,
      priceAmountMinor: first.priceAmountMinor,
      currency: first.currency,
    });
    adds += 1;
  });

  const rows = combos.map((combo, index) => ({
    selection: combo,
    variantId: claimed.get(index)?.id ?? null,
  }));
  return { ok: true, operations, summary: { adds, removes: toRemove.length }, rows };
}
