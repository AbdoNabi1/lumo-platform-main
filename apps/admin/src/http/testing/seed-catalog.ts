import type { ProductController } from "@platform/catalog";

/**
 * TEST-ONLY (Plan 2A). Never import this from production code: the cart now prices a line from the
 * VARIANT in Catalog (`resolveMerchandise`), so every cart/checkout/payment test needs a real,
 * published Catalog product instead of a bare product id plus a Pricing row. This is the one place
 * that knows how to build one, so the seven suites that used to hand-roll `seedPublishedPrice` do not
 * each re-implement it.
 *
 * It drives the REAL catalog use cases — either the raw controller (`controllerDriver`, for suites
 * that hold a `wireAdmin()` / `wireCatalog()` composition) or the staff HTTP API (`httpDriver`, for
 * suites that only hold the running pipeline) — never a fabricated repository row.
 */

export interface SeedVariant {
  readonly sku: string;
  readonly priceAmountMinor: number;
  /** Required for every variant of a product that declares `options`. */
  readonly selection?: Readonly<Record<string, string>>;
}

export interface SeedProductSpec {
  /** Product SKU; also derives the slug, so it must be unique per tenant. */
  readonly sku: string;
  readonly name?: string;
  readonly currency?: string;
  readonly options?: readonly { readonly name: string; readonly values: readonly string[] }[];
  readonly variants: readonly SeedVariant[];
  /** Default `true`. Pass `false` for a draft product (never sellable). */
  readonly publish?: boolean;
}

export interface SeededProduct {
  readonly productId: string;
  readonly variants: readonly {
    readonly id: string;
    readonly sku: string;
    readonly priceAmountMinor: number;
  }[];
  /** The first variant's id — the only one for a single-variant product. */
  readonly variantId: string;
}

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

/** What `seedCatalogProduct` needs from a catalog; implemented over the controller and over HTTP. */
export interface CatalogSeedDriver {
  create(input: {
    sku: string;
    name: string;
    slug: string;
    variants: { sku: string; priceAmountMinor: number; currency: string }[];
  }): Promise<Reply>;
  setOptions(
    productId: string,
    options: readonly { name: string; values: readonly string[] }[],
  ): Promise<Reply>;
  addVariant(
    productId: string,
    variant: {
      sku: string;
      priceAmountMinor: number;
      currency: string;
      selection?: Readonly<Record<string, string>>;
    },
  ): Promise<Reply>;
  removeVariant(productId: string, variantId: string): Promise<Reply>;
  publish(productId: string): Promise<Reply>;
  /** The product's current variants (`id` is a string on the wire and a value object in memory). */
  variantsOf(
    productId: string,
  ): Promise<readonly { id: string; sku: string; priceAmountMinor: number }[]>;
}

function ensure(reply: Reply, what: string): unknown {
  if (reply.status < 200 || reply.status >= 300) {
    throw new Error(
      `seedCatalogProduct: ${what} failed (${reply.status}): ${JSON.stringify(reply.body)}`,
    );
  }
  return reply.body;
}

function slugOf(sku: string): string {
  return sku
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Creates (and, unless told otherwise, publishes) a product whose variants carry the given prices. */
export async function seedCatalogProduct(
  driver: CatalogSeedDriver,
  spec: SeedProductSpec,
): Promise<SeededProduct> {
  const currency = spec.currency ?? "USD";
  const first = spec.variants[0];
  if (first === undefined) throw new Error("seedCatalogProduct: at least one variant is required");
  const hasOptions = spec.options !== undefined && spec.options.length > 0;

  // `create` cannot carry a selection, so an option-matrixed product is born with a placeholder
  // variant that is removed once the real, selected ones exist (a product must keep one variant).
  const created = ensure(
    await driver.create({
      sku: spec.sku,
      name: spec.name ?? `Product ${spec.sku}`,
      slug: slugOf(spec.sku),
      variants: hasOptions
        ? [{ sku: `${spec.sku}-BASE`, priceAmountMinor: 1, currency }]
        : spec.variants.map((v) => ({
            sku: v.sku,
            priceAmountMinor: v.priceAmountMinor,
            currency,
          })),
    }),
    "create",
  ) as { id: string };
  const productId = created.id;

  if (hasOptions && spec.options !== undefined) {
    ensure(await driver.setOptions(productId, spec.options), "setOptions");
    for (const variant of spec.variants) {
      ensure(
        await driver.addVariant(productId, {
          sku: variant.sku,
          priceAmountMinor: variant.priceAmountMinor,
          currency,
          ...(variant.selection === undefined ? {} : { selection: variant.selection }),
        }),
        `addVariant ${variant.sku}`,
      );
    }
    const base = (await driver.variantsOf(productId)).find((v) => v.sku === `${spec.sku}-BASE`);
    if (base === undefined) throw new Error("seedCatalogProduct: placeholder variant missing");
    ensure(await driver.removeVariant(productId, base.id), "removeVariant");
  }

  if (spec.publish !== false) ensure(await driver.publish(productId), "publish");

  const variants = await driver.variantsOf(productId);
  const firstVariant = variants[0];
  if (firstVariant === undefined) throw new Error("seedCatalogProduct: product has no variants");
  return { productId, variants, variantId: firstVariant.id };
}

/**
 * The common case: one published product with one variant priced `priceAmountMinor`. Replaces the
 * old per-suite `seedPublishedPrice(productId, amount)` — the cart now prices from this variant.
 */
export function seedSingleVariantProduct(
  driver: CatalogSeedDriver,
  sku: string,
  priceAmountMinor: number,
  currency = "USD",
): Promise<SeededProduct> {
  return seedCatalogProduct(driver, {
    sku,
    currency,
    variants: [{ sku: `${sku}-STD`, priceAmountMinor }],
  });
}

/** Drives a raw catalog `ProductController` — `wireAdmin().publicReads.products` or `wireCatalog().products`. */
export function controllerDriver(products: ProductController, tenantId: string): CatalogSeedDriver {
  return {
    create: (input) => products.create({ ...input, tenantId }),
    setOptions: (productId, options) => products.setOptions({ productId, options, tenantId }),
    addVariant: (productId, variant) => products.addVariant({ productId, ...variant, tenantId }),
    removeVariant: (productId, variantId) =>
      products.removeVariant({ productId, variantId, tenantId }),
    publish: (productId) => products.publish({ productId, tenantId }),
    variantsOf: async (productId) => {
      const body = ensure(await products.get({ productId, tenantId }), "get") as {
        variants: readonly {
          id: { toString(): string };
          sku: { value: string };
          price: { amountMinor: number };
        }[];
      };
      return body.variants.map((v) => ({
        id: v.id.toString(),
        sku: v.sku.value,
        priceAmountMinor: v.price.amountMinor,
      }));
    },
  };
}

/** Drives the staff product routes of a running pipeline, as the tenant that owns `headers`' token. */
export function httpDriver(
  send: (
    method: "GET" | "POST",
    url: string,
    payload?: unknown,
  ) => Promise<{
    statusCode: number;
    json: () => unknown;
  }>,
): CatalogSeedDriver {
  const reply = async (method: "GET" | "POST", url: string, payload?: unknown): Promise<Reply> => {
    const res = await send(method, url, payload);
    return { status: res.statusCode, body: res.json() };
  };
  return {
    create: (input) => reply("POST", "/products", input),
    setOptions: (productId, options) =>
      reply("POST", `/products/${productId}/options`, { options }),
    addVariant: (productId, variant) => reply("POST", `/products/${productId}/variants`, variant),
    removeVariant: (productId, variantId) =>
      reply("POST", `/products/${productId}/variants/${variantId}/remove`, {}),
    publish: (productId) => reply("POST", `/products/${productId}/publish`, {}),
    variantsOf: async (productId) => {
      const body = ensure(await reply("GET", `/products/${productId}`), "get") as {
        variants: readonly { id: string; sku: string; priceAmountMinor: number }[];
      };
      return body.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        priceAmountMinor: v.priceAmountMinor,
      }));
    },
  };
}
