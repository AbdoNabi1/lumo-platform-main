import { randomUUID } from "node:crypto";
import type { Logger } from "@platform/utils";
import type { AdminResponse } from "../interfaces/admin-response";
import { COUNTRY_DEFAULTS, type SignupCountry } from "./country";
import { deriveSlugBase, isReservedSlug, randomSlugSuffix } from "./slug";

export type { SignupCountry } from "./country";
export { COUNTRY_DEFAULTS } from "./country";

export interface SignupInput {
  readonly storeName: string;
  readonly email: string;
  readonly password: string;
  readonly country: SignupCountry;
}

export type SignupOutcome =
  | {
      readonly kind: "created";
      readonly tenantId: string;
      /** `https://<slug>.<platform zone>`; `null` without a zone, or when an earlier attempt made the store. */
      readonly storeUrl: string | null;
      /** The staff login response (200 with `accessToken`). */
      readonly session: AdminResponse;
    }
  | { readonly kind: "email-taken" }
  | {
      readonly kind: "unavailable";
      readonly reason:
        "no-default-plan" | "provisioning-incomplete" | "not-multi" | "sign-in-unavailable";
    };

export interface DirectoryEntry {
  readonly email: string;
  readonly shopId: string;
  readonly ownerExternalId: string;
  readonly status: "pending" | "active";
}

export interface StoreSettingsDefaults {
  readonly storeName: string;
  readonly contactEmail: string;
  readonly currency: string;
  readonly timezone: string;
  readonly weightUnit: string;
}

/**
 * Narrow function ports only — no controller or repository objects, because the tenant-mode guard
 * walks every object reachable from `WiredAdmin` and fails on a field named like a tenant id.
 * `platformTenantId` is plain config and does not match that rule.
 */
export interface MerchantOnboardingPorts {
  readonly platformTenantId: string | undefined;
  readonly defaultPlanKey: string | undefined;
  readonly platformStoreDomain: string | undefined;
  /**
   * Whether a merchant can sign in to the store sign-up makes: native staff sign-in (a staff token
   * issuer) over the durable hashed password store. Without it the store would be unusable.
   */
  readonly nativeSignInAvailable: boolean;
  readonly logger: Logger;
  readonly findEntry: (email: string) => Promise<DirectoryEntry | null>;
  /** `false` ⇒ the email already has an entry (a concurrent sign-up won). */
  readonly recordPending: (entry: {
    readonly email: string;
    readonly shopId: string;
    readonly ownerExternalId: string;
  }) => Promise<boolean>;
  readonly activateEntry: (email: string) => Promise<void>;
  /** The default plan's published version ref, or `null` when it has none. */
  readonly resolveDefaultPlan: (planKey: string) => Promise<string | null>;
  readonly slugTaken: (slug: string) => Promise<boolean>;
  /** The new tenant's id, or `null` when the slug was taken meanwhile. */
  readonly createTenant: (input: {
    readonly slug: string;
    readonly name: string;
  }) => Promise<string | null>;
  /** Runs (or finishes) the tenant's security baseline and owner; `true` when complete. */
  readonly provision: (tenantId: string, ownerExternalId: string) => Promise<boolean>;
  readonly setOwnerPassword: (
    tenantId: string,
    email: string,
    password: string,
    ownerExternalId: string,
  ) => Promise<void>;
  readonly saveStoreSettings: (tenantId: string, input: StoreSettingsDefaults) => Promise<void>;
  /** Creates and activates the trial subscription; a repeat finishes or skips what is done. */
  readonly startTrial: (tenantRef: string, planVersionRef: string) => Promise<void>;
  readonly signIn: (tenantId: string, email: string, password: string) => Promise<AdminResponse>;
}

const MAX_SLUG_ATTEMPTS = 20;

/**
 * Project 1: self-serve sign-up — one store per email. The staff directory row is written `pending`
 * right after the tenant exists and `active` only once everything else is done, so a sign-up that
 * fails half-way is RESUMED by the next attempt with the same email (same tenant, never a second
 * one): every later step is idempotent. The default plan is checked before anything is created.
 */
export class MerchantOnboarding {
  constructor(readonly ports: MerchantOnboardingPorts) {}

  async signUp(input: SignupInput): Promise<SignupOutcome> {
    const p = this.ports;
    if (p.platformTenantId === undefined || p.platformTenantId === "") {
      return { kind: "unavailable", reason: "not-multi" };
    }
    if (!p.nativeSignInAvailable) {
      p.logger.error(
        "merchant signup refused: native staff sign-in is not configured (AUTH_MODE=native, staff token issuer)",
      );
      return { kind: "unavailable", reason: "sign-in-unavailable" };
    }
    const email = input.email.trim().toLowerCase();
    const storeName = input.storeName.trim();
    const existing = await p.findEntry(email);
    if (existing?.status === "active") return { kind: "email-taken" };

    const planVersionRef =
      p.defaultPlanKey === undefined || p.defaultPlanKey === ""
        ? null
        : await p.resolveDefaultPlan(p.defaultPlanKey);
    if (planVersionRef === null) {
      p.logger.error("merchant signup refused: DEFAULT_PLAN_KEY unset or not a published plan", {
        defaultPlanKey: p.defaultPlanKey ?? null,
      });
      return { kind: "unavailable", reason: "no-default-plan" };
    }

    let tenantId: string;
    let ownerExternalId: string;
    let slug: string | null = null;
    if (existing !== null) {
      // A retry for a PENDING email completes that store with the retrier's password, name and
      // country: no email-ownership proof exists (same as a first sign-up). Safe because merchant
      // login refuses pending entries, so nobody can sign in before the store is activated.
      tenantId = existing.shopId; // resume the half-created store, never a second one
      ownerExternalId = existing.ownerExternalId;
    } else {
      const created = await this.createUniqueTenant(storeName);
      tenantId = created.tenantId;
      slug = created.slug;
      ownerExternalId = randomUUID();
      if (!(await p.recordPending({ email, shopId: tenantId, ownerExternalId }))) {
        return { kind: "email-taken" }; // lost a race with a concurrent sign-up for this email
      }
    }

    if (!(await p.provision(tenantId, ownerExternalId))) {
      p.logger.error("merchant signup: provisioning incomplete; a retry resumes", { tenantId });
      return { kind: "unavailable", reason: "provisioning-incomplete" };
    }
    await p.setOwnerPassword(tenantId, email, input.password, ownerExternalId);
    const defaults = COUNTRY_DEFAULTS[input.country];
    await p.saveStoreSettings(tenantId, {
      storeName,
      contactEmail: email,
      currency: defaults.currency,
      timezone: defaults.timezone,
      weightUnit: "kg",
    });
    await p.startTrial(tenantId, planVersionRef);
    await p.activateEntry(email);
    const session = await p.signIn(tenantId, email, input.password);
    const zone = p.platformStoreDomain;
    const storeUrl =
      slug !== null && zone !== undefined && zone !== "" ? `https://${slug}.${zone}` : null;
    return { kind: "created", tenantId, storeUrl, session };
  }

  private async createUniqueTenant(name: string): Promise<{ tenantId: string; slug: string }> {
    const base = deriveSlugBase(name, randomSlugSuffix);
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
      const slug = attempt === 1 ? base : `${base}-${attempt}`;
      // A reserved word (admin, api, www…) is treated as taken: "Admin" becomes `admin-2`.
      if (isReservedSlug(slug) || (await this.ports.slugTaken(slug))) continue;
      const tenantId = await this.ports.createTenant({ slug, name });
      if (tenantId !== null) return { tenantId, slug };
    }
    throw new Error(`merchant signup: no free slug after ${MAX_SLUG_ATTEMPTS} attempts`);
  }
}
