import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { NativeTokenIssuer } from "@platform/auth";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireLicensing, type WiredLicensing } from "@platform/licensing";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import { wireAdmin, type WiredAdmin } from "../composition";
import type { SiteType } from "@platform/tenancy";
import { MerchantOnboarding, type SignupInput } from "./merchant-onboarding";

const PLATFORM = "platform";
const NOW = new Date("2026-10-16T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const clock: Clock = { now: () => NOW };
/**
 * Any principal: the default access control allows every action, these reads are only assertions. A
 * `service` caller on purpose: with native sign-in wired, a `staff` principal is looked up live in Security
 * (Wave 1d) and this fixture person does not exist there.
 */
const operator: Principal = { id: "operator", kind: "service", roles: [], tenantId: PLATFORM };

function issuer() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return new NativeTokenIssuer({
    privateKey,
    issuer: "https://api.test/",
    audience: "morbeh-admin",
    ttlSeconds: 7200,
  });
}

interface SetupOptions {
  readonly platformTenantId?: string;
  readonly defaultPlanKey?: string;
  /** `"no-issuer"`: no staff token issuer; `"in-memory-passwords"`: not the durable hashed provider. */
  readonly signIn?: "native" | "no-issuer" | "in-memory-passwords";
}

async function setup(
  options: SetupOptions = { platformTenantId: PLATFORM, defaultPlanKey: "basic" },
): Promise<{ admin: WiredAdmin; licensing: WiredLicensing }> {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const serializer = new InMemoryEventSerializer();
  const licensing = wireLicensing({
    serializer,
    idGenerator,
    clock,
    ...(options.platformTenantId === undefined
      ? {}
      : { platformTenantId: options.platformTenantId }),
  });
  const admin = wireAdmin({
    serializer,
    idGenerator,
    clock,
    licensing,
    // Without an injected provider Security falls back to its in-memory reference one.
    ...(options.signIn === "in-memory-passwords"
      ? {}
      : {
          passwordAuthProvider: new HashedPasswordAuthProvider({
            store: new InMemoryPasswordCredentialStore(),
            hasher: new ScryptPasswordHasher({ log2N: 10 }),
            clock,
          }),
        }),
    ...(options.signIn === "no-issuer" ? {} : { staffTokenIssuer: issuer() }),
    platformStoreDomain: "morbeh.test",
    ...(options.platformTenantId === undefined
      ? {}
      : { platformTenantId: options.platformTenantId }),
    ...(options.defaultPlanKey === undefined ? {} : { defaultPlanKey: options.defaultPlanKey }),
  });
  await seedPlan(licensing, "basic");
  return { admin, licensing };
}

/** createPlan -> createPlanDraft -> publishPlanVersion, as the platform. */
async function seedPlan(licensing: WiredLicensing, key: string): Promise<void> {
  const plan = await licensing.licensing.createPlan({
    key,
    name: "Basic",
    tier: "starter",
    tenantId: PLATFORM,
  });
  const planId = (plan.body as { id: string }).id;
  const draft = await licensing.licensing.createPlanDraft({
    planId,
    spec: {
      limits: { maxProducts: 100 },
      featureEntitlements: ["basic_reports"],
      pricing: {
        basePriceMinor: 49_900,
        currency: "EGP",
        billingCycle: "monthly",
        trialDays: 14,
        creditAllowances: {},
      },
    },
    tenantId: PLATFORM,
  });
  const planVersionId = (draft.body as { planVersionId: string }).planVersionId;
  const published = await licensing.licensing.publishPlanVersion({
    planId,
    planVersionId,
    tenantId: PLATFORM,
  });
  expect(published.status).toBe(200);
}

async function tenantCount(admin: WiredAdmin): Promise<number> {
  const listed = await admin.tenancy.listTenants(operator, { first: 100 });
  expect(listed.status).toBe(200);
  return (listed.body as { items: readonly unknown[] }).items.length;
}

const nour: SignupInput = {
  storeName: "Nour Store",
  email: "Owner@Nour.test",
  password: "correct-horse-1",
  country: "SA",
  siteType: "store",
};

describe("MerchantOnboarding.signUp", () => {
  it("creates the store, its owner, its settings and its trial, then signs the owner in", async () => {
    const { admin, licensing } = await setup();

    const outcome = await admin.merchantOnboarding.signUp(nour);

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect(outcome.storeUrl).toBe("https://nour-store.morbeh.test");
    expect(outcome.siteType).toBe("store");
    expect(outcome.session.status).toBe(200);
    expect(outcome.session.body).toHaveProperty("accessToken");

    const settings = await admin.tenancy.getStoreSettings(operator, outcome.tenantId);
    expect(settings.body).toMatchObject({
      storeName: "Nour Store",
      currency: "SAR",
      timezone: "Asia/Riyadh",
      weightUnit: "kg",
      contactEmail: "owner@nour.test",
    });

    const entry = await admin.merchantOnboarding.ports.findEntry("owner@nour.test");
    expect(entry).toMatchObject({ shopId: outcome.tenantId, status: "active" });

    const billing = await licensing.licensing.getMerchantBilling({
      tenantRef: outcome.tenantId,
      tenantId: PLATFORM,
    });
    expect(billing.body).toMatchObject({
      status: "active",
      trialEndsAt: new Date(NOW.getTime() + 14 * DAY_MS).toISOString(),
    });
  });

  it("answers email-taken for an email that already has a store, whatever its casing", async () => {
    const { admin } = await setup();
    expect((await admin.merchantOnboarding.signUp(nour)).kind).toBe("created");
    const before = await tenantCount(admin);

    const again = await admin.merchantOnboarding.signUp({
      ...nour,
      storeName: "Other Store",
      email: "  OWNER@nour.TEST ",
    });

    expect(again).toEqual({ kind: "email-taken" });
    expect(await tenantCount(admin)).toBe(before);
  });

  it("suffixes the slug when the name's slug is taken", async () => {
    const { admin } = await setup();
    const first = await admin.merchantOnboarding.signUp(nour);
    const second = await admin.merchantOnboarding.signUp({ ...nour, email: "other@nour.test" });

    expect(first.kind === "created" && first.storeUrl).toBe("https://nour-store.morbeh.test");
    expect(second.kind === "created" && second.storeUrl).toBe("https://nour-store-2.morbeh.test");
  });

  it.each([
    ["unset", undefined],
    ["a plan with no published version", "gold"],
  ])("refuses sign-up without creating a tenant when the default plan is %s", async (_, key) => {
    const { admin } = await setup({
      platformTenantId: PLATFORM,
      ...(key === undefined ? {} : { defaultPlanKey: key }),
    });

    const outcome = await admin.merchantOnboarding.signUp(nour);

    expect(outcome).toEqual({ kind: "unavailable", reason: "no-default-plan" });
    expect(await tenantCount(admin)).toBe(0);
  });

  it("resumes the same store after provisioning failed once", async () => {
    const { admin } = await setup();
    const real = admin.merchantOnboarding.ports;
    let failures = 1;
    const onboarding = new MerchantOnboarding({
      ...real,
      provision: async (tenantId, owner) => {
        if (failures > 0) {
          failures -= 1;
          return false;
        }
        return real.provision(tenantId, owner);
      },
    });

    const first = await onboarding.signUp(nour);
    expect(first).toEqual({ kind: "unavailable", reason: "provisioning-incomplete" });
    const pending = await real.findEntry("owner@nour.test");
    expect(pending?.status).toBe("pending");
    const count = await tenantCount(admin);

    const second = await onboarding.signUp(nour);

    expect(second.kind).toBe("created");
    if (second.kind !== "created") return;
    expect(second.tenantId).toBe(pending?.shopId);
    expect(second.session.status).toBe(200);
    expect(await tenantCount(admin)).toBe(count);
    expect((await real.findEntry("owner@nour.test"))?.status).toBe("active");
  });

  describe("site type", () => {
    /** The real ports, with the steps around settlement recorded in the order they run. */
    function recording(admin: WiredAdmin) {
      const real = admin.merchantOnboarding.ports;
      const calls: string[] = [];
      const settled: [string, string][] = [];
      const ports = {
        ...real,
        provision: async (tenantId: string, owner: string) => {
          calls.push("provision");
          return real.provision(tenantId, owner);
        },
        settleSiteType: async (tenantId: string, siteType: SiteType) => {
          calls.push("settleSiteType");
          settled.push([tenantId, siteType]);
          return real.settleSiteType(tenantId, siteType);
        },
        setOwnerPassword: async (...args: Parameters<typeof real.setOwnerPassword>) => {
          calls.push("setOwnerPassword");
          return real.setOwnerPassword(...args);
        },
      };
      return { real, calls, settled, ports };
    }
    const storedType = async (admin: WiredAdmin, tenantId: string) =>
      (await admin.tenancy.getStoreSettings(operator, tenantId)).body as { siteType: SiteType };

    it("settles the chosen type after provision and before the owner's password", async () => {
      const { admin } = await setup();
      const { calls, settled, ports } = recording(admin);
      const warn = vi.spyOn(ports.logger, "warn");

      const outcome = await new MerchantOnboarding(ports).signUp({
        ...nour,
        siteType: "lead_site",
      });

      expect(outcome.kind).toBe("created");
      if (outcome.kind !== "created") return;
      expect(calls).toEqual(["provision", "settleSiteType", "setOwnerPassword"]);
      expect(settled).toEqual([[outcome.tenantId, "lead_site"]]);
      expect(outcome.siteType).toBe("lead_site");
      expect(await storedType(admin, outcome.tenantId)).toMatchObject({ siteType: "lead_site" });
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("applies the retrier's choice when the first attempt stopped before settlement", async () => {
      const { admin } = await setup();
      const { real, settled, ports } = recording(admin);
      let failures = 1;
      const onboarding = new MerchantOnboarding({
        ...ports,
        provision: async (tenantId, owner) => {
          if (failures > 0) {
            failures -= 1;
            return false;
          }
          return real.provision(tenantId, owner);
        },
      });

      const first = await onboarding.signUp({ ...nour, siteType: "lead_site" });
      expect(first).toEqual({ kind: "unavailable", reason: "provisioning-incomplete" });
      expect(settled).toEqual([]);

      const second = await onboarding.signUp({ ...nour, siteType: "store" });

      expect(second.kind).toBe("created");
      if (second.kind !== "created") return;
      expect(settled).toEqual([[second.tenantId, "store"]]);
      expect(second.siteType).toBe("store");
      expect(await storedType(admin, second.tenantId)).toMatchObject({ siteType: "store" });
    });

    it("keeps the first type, and warns once, when the first attempt failed after settlement", async () => {
      const { admin } = await setup();
      const { real, ports } = recording(admin);
      const warn = vi.spyOn(ports.logger, "warn");
      let failures = 1;
      const onboarding = new MerchantOnboarding({
        ...ports,
        startTrial: async (tenantRef, planVersionRef) => {
          if (failures > 0) {
            failures -= 1;
            throw new Error("crashed after settling the site type");
          }
          return real.startTrial(tenantRef, planVersionRef);
        },
      });

      await expect(onboarding.signUp({ ...nour, siteType: "lead_site" })).rejects.toThrow(
        "crashed",
      );
      expect(warn).not.toHaveBeenCalled();
      const second = await onboarding.signUp({ ...nour, siteType: "store" });

      expect(second.kind).toBe("created");
      if (second.kind !== "created") return;
      expect(second.siteType).toBe("lead_site");
      expect(await storedType(admin, second.tenantId)).toMatchObject({ siteType: "lead_site" });
      const warned = warn.mock.calls.filter(([message]) =>
        String(message).includes("site type already settled"),
      );
      expect(warned).toEqual([
        ["merchant signup: site type already settled; keeping it", { tenantId: second.tenantId }],
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it("two overlapping resumes with opposite choices end on one persisted type", async () => {
      // The e2e builds its ports inside `createAdminHttpApi`, so it cannot pause one: the overlap
      // is driven here, on the real ports with the first resume's settle held back.
      const { admin } = await setup();
      const real = admin.merchantOnboarding.ports;
      let failures = 1;
      const seed = new MerchantOnboarding({
        ...real,
        provision: async (tenantId, owner) => {
          if (failures > 0) {
            failures -= 1;
            return false;
          }
          return real.provision(tenantId, owner);
        },
      });
      expect(await seed.signUp({ ...nour, siteType: "store" })).toEqual({
        kind: "unavailable",
        reason: "provisioning-incomplete",
      });
      const pending = await real.findEntry("owner@nour.test");
      expect(pending?.status).toBe("pending");

      let reachedSettle!: () => void;
      const atSettle = new Promise<void>((resolve) => (reachedSettle = resolve));
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const first = new MerchantOnboarding({
        ...real,
        settleSiteType: async (tenantId, siteType) => {
          reachedSettle();
          await held;
          return real.settleSiteType(tenantId, siteType);
        },
      });

      const firstDone = first.signUp({ ...nour, siteType: "lead_site" });
      await atSettle;
      const second = await new MerchantOnboarding(real).signUp({ ...nour, siteType: "store" });
      expect((await real.findEntry("owner@nour.test"))?.status).toBe("active");
      release();
      const firstOutcome = await firstDone;

      expect(second.kind).toBe("created");
      expect(firstOutcome.kind).toBe("created");
      if (second.kind !== "created" || firstOutcome.kind !== "created") return;
      expect(second.tenantId).toBe(pending?.shopId);
      expect(firstOutcome.tenantId).toBe(pending?.shopId);
      expect(second.siteType).toBe("store");
      expect(firstOutcome.siteType).toBe("store");
      expect(await storedType(admin, second.tenantId)).toMatchObject({ siteType: "store" });
    });
  });

  it("resumes a trial that was created but never activated", async () => {
    const { admin, licensing } = await setup();
    const real = admin.merchantOnboarding.ports;
    let failures = 1;
    const onboarding = new MerchantOnboarding({
      ...real,
      // The subscription is created, then the step "crashes" before activating it.
      startTrial: async (tenantRef, planVersionRef) => {
        if (failures > 0) {
          failures -= 1;
          await licensing.licensing.createSubscription({
            tenantRef,
            planVersionRef,
            tenantId: PLATFORM,
          });
          throw new Error("crashed after creating the subscription");
        }
        return real.startTrial(tenantRef, planVersionRef);
      },
    });

    await expect(onboarding.signUp(nour)).rejects.toThrow("crashed");
    const second = await onboarding.signUp(nour);

    expect(second.kind).toBe("created");
    if (second.kind !== "created") return;
    const billing = await licensing.licensing.getMerchantBilling({
      tenantRef: second.tenantId,
      tenantId: PLATFORM,
    });
    expect((billing.body as { status: string }).status).toBe("active");
  });

  it.each([
    ["no staff token issuer", "no-issuer"],
    ["no durable hashed password store", "in-memory-passwords"],
  ] as const)(
    "refuses sign-up without creating a tenant when native sign-in is not configured (%s)",
    async (_, signIn) => {
      const { admin } = await setup({
        platformTenantId: PLATFORM,
        defaultPlanKey: "basic",
        signIn,
      });
      const error = vi.spyOn(admin.merchantOnboarding.ports.logger, "error");

      const outcome = await admin.merchantOnboarding.signUp(nour);

      expect(outcome).toEqual({ kind: "unavailable", reason: "sign-in-unavailable" });
      expect(await tenantCount(admin)).toBe(0);
      expect(await admin.merchantOnboarding.ports.findEntry("owner@nour.test")).toBeNull();
      expect(error).toHaveBeenCalledWith(
        "merchant signup refused: native staff sign-in is not configured (AUTH_MODE=native, staff token issuer)",
      );
      error.mockRestore();
    },
  );

  it('treats a reserved word as a taken slug ("Admin" becomes admin-2)', async () => {
    const { admin } = await setup();
    const outcome = await admin.merchantOnboarding.signUp({ ...nour, storeName: "Admin" });
    expect(outcome.kind === "created" && outcome.storeUrl).toBe("https://admin-2.morbeh.test");
  });

  it("answers not-multi when no platform tenant is configured", async () => {
    const { admin } = await setup({ defaultPlanKey: "basic" });

    expect(await admin.merchantOnboarding.signUp(nour)).toEqual({
      kind: "unavailable",
      reason: "not-multi",
    });
  });
});
