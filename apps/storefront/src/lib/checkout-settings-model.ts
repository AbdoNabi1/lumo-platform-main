/**
 * Wave 2a (D33-D37): the checkout and customer-account switches the storefront reads from
 * `GET /public/checkout-settings` (`apps/admin/src/http/checkout-settings-routes.ts`). Pure data and
 * a strict parser, no imports: client components may import it, and so may `runtime-api.ts`.
 *
 * Every default equals today's live behaviour (D33), so a shop with no settings row, or a settings
 * read that failed, renders and validates exactly like the storefront did before these switches.
 * The SERVER enforces every switch as well (D34); this model only decides what the form shows.
 */
export type NameMode = "required" | "optional";
export type PhoneMode = "required" | "optional";
export type Line2Mode = "hidden" | "optional" | "required";
export type MarketingEmailPrompt = "hidden" | "show" | "preselect";
export type AccountsMode = "optional" | "disabled";

export interface PublicCheckoutSettings {
  readonly nameMode: NameMode;
  readonly phoneMode: PhoneMode;
  readonly line2Mode: Line2Mode;
  readonly marketingEmailPrompt: MarketingEmailPrompt;
  /** The most of one item a cart line may hold; null = no limit. */
  readonly cartLineLimit: number | null;
  readonly requireLogin: boolean;
  readonly accountsMode: AccountsMode;
  readonly showAccountLink: boolean;
}

/** D33: name and phone required, line 2 optional, no marketing prompt, no limit, guests welcome, accounts on. */
export const DEFAULT_PUBLIC_CHECKOUT_SETTINGS: PublicCheckoutSettings = Object.freeze({
  nameMode: "required",
  phoneMode: "required",
  line2Mode: "optional",
  marketingEmailPrompt: "hidden",
  cartLineLimit: null,
  requireLogin: false,
  accountsMode: "optional",
  showAccountLink: true,
});

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/**
 * The settings in a response body, or `null` when the body is not exactly a settings document (a
 * missing key, an unknown mode, a limit outside 1-999, a non-boolean switch). A partly understood
 * document is never half-applied: the caller falls back to the defaults as a whole.
 */
export function parsePublicCheckoutSettings(raw: unknown): PublicCheckoutSettings | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const nameMode = oneOf(body["nameMode"], ["required", "optional"] as const);
  const phoneMode = oneOf(body["phoneMode"], ["required", "optional"] as const);
  const line2Mode = oneOf(body["line2Mode"], ["hidden", "optional", "required"] as const);
  const marketingEmailPrompt = oneOf(body["marketingEmailPrompt"], [
    "hidden",
    "show",
    "preselect",
  ] as const);
  const accountsMode = oneOf(body["accountsMode"], ["optional", "disabled"] as const);
  const limit = body["cartLineLimit"];
  const cartLineLimit =
    limit === null
      ? null
      : typeof limit === "number" && Number.isInteger(limit)
        ? limit
        : undefined;
  const requireLogin = body["requireLogin"];
  const showAccountLink = body["showAccountLink"];
  if (
    nameMode === null ||
    phoneMode === null ||
    line2Mode === null ||
    marketingEmailPrompt === null ||
    accountsMode === null ||
    cartLineLimit === undefined ||
    (cartLineLimit !== null && (cartLineLimit < 1 || cartLineLimit > 999)) ||
    typeof requireLogin !== "boolean" ||
    typeof showAccountLink !== "boolean"
  ) {
    return null;
  }
  return {
    nameMode,
    phoneMode,
    line2Mode,
    marketingEmailPrompt,
    cartLineLimit,
    requireLogin,
    accountsMode,
    showAccountLink,
  };
}

/** The account link belongs in the header only while accounts are on AND the merchant keeps the link. */
export function accountLinkVisible(settings: PublicCheckoutSettings): boolean {
  return settings.showAccountLink && settings.accountsMode !== "disabled";
}
