import { z } from "zod";

const refs = z.array(z.string().min(1)).min(1).max(250);
const scope = z.enum(["products", "categories"]);

/**
 * The Shopify discount form (Phase 2), one shape for the four types. Per-type requirements are
 * checked in `superRefine` so each missing field is reported on its own path. Amounts are minor
 * units; a percentage is 0–100 with up to two decimals.
 */
export const discountInputSchema = z
  .object({
    type: z.enum(["amount_off_products", "amount_off_order", "buy_x_get_y", "free_shipping"]),
    method: z.enum(["code", "automatic"]),
    title: z.string().trim().min(1).max(255).optional(),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{3,32}$/, "3-32 letters, digits, _ or -")
      .optional(),
    value: z
      .object({ kind: z.enum(["percentage", "fixed_amount"]), amount: z.number().positive() })
      .optional(),
    appliesTo: z.object({ kind: scope, refs }).optional(),
    appliesOncePerOrder: z.boolean().optional(),
    buys: z
      .object({
        kind: z.enum(["quantity", "amount"]),
        value: z.number().int().positive(),
        scope,
        refs,
      })
      .optional(),
    gets: z
      .object({
        quantity: z.number().int().positive(),
        scope,
        refs,
        effect: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("percentage"), value: z.number().positive().max(100) }),
          z.object({ kind: z.literal("free") }),
        ]),
      })
      .optional(),
    maxUsesPerOrder: z.number().int().positive().optional(),
    countries: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .optional(),
    maxShippingRateMinor: z.number().int().min(0).optional(),
    minimumRequirement: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }),
      z.object({ kind: z.literal("amount"), amountMinor: z.number().int().positive() }),
      z.object({ kind: z.literal("quantity"), quantity: z.number().int().positive() }),
    ]),
    customerEligibility: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("all") }),
      z.object({ kind: z.literal("customers"), customerRefs: z.array(z.string().min(1)).min(1) }),
    ]),
    usageLimit: z.number().int().positive().optional(),
    oncePerCustomer: z.boolean(),
    combinesWith: z.object({ product: z.boolean(), order: z.boolean(), shipping: z.boolean() }),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const need = (condition: boolean, path: string, message: string) => {
      if (!condition) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    need(
      input.method !== "code" || input.code !== undefined,
      "code",
      "required for a discount code",
    );
    need(
      input.method !== "automatic" || input.title !== undefined,
      "title",
      "required for an automatic discount",
    );
    // Shopify has no use limits on automatic discounts.
    need(
      input.method !== "automatic" || input.usageLimit === undefined,
      "usageLimit",
      "not available for an automatic discount",
    );
    need(
      input.method !== "automatic" || input.oncePerCustomer !== true,
      "oncePerCustomer",
      "not available for an automatic discount",
    );
    if (input.type === "amount_off_products" || input.type === "amount_off_order") {
      need(input.value !== undefined, "value", "required");
      if (input.value?.kind === "percentage")
        need(input.value.amount <= 100, "value", "at most 100");
      if (input.value?.kind === "fixed_amount") {
        need(Number.isInteger(input.value.amount), "value", "a whole number of minor units");
      }
    }
    if (input.type === "amount_off_products")
      need(input.appliesTo !== undefined, "appliesTo", "choose products or categories");
    if (input.type === "buy_x_get_y") {
      need(input.buys !== undefined, "buys", "required");
      need(input.gets !== undefined, "gets", "required");
    }
    need(
      input.endsAt === undefined || input.endsAt.getTime() > input.startsAt.getTime(),
      "endsAt",
      "must be after the start",
    );
  });

export type DiscountInput = z.infer<typeof discountInputSchema>;
