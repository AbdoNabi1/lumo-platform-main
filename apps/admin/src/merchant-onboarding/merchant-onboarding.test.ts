import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
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
import { MerchantOnboarding, type SignupInput } from "./merchant-onboarding";

const PLATFORM = "platform";
const NOW = new Date("2026-10-16T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const clock: Clock = { now: () => NOW };
/** Any principal: the default access control allows every action, these reads are only assertions. */
const operator: Principal = { id: "operator", kind: "staff", roles: [], tenantId: PLATFORM };

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
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
    staffTokenIssuer: issuer(),
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
};

describe("MerchantOnboarding.signUp", () => {
  it("creates the store, its owner, its settings and its trial, then signs the owner in", async () => {
    const { admin, licensing } = await setup();

    const outcome = await admin.merchantOnboarding.signUp(nour);

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect(outcome.storeUrl).toBe("https://nour-store.morbeh.test");
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

  it("answers not-multi when no platform tenant is configured", async () => {
    const { admin } = await setup({ defaultPlanKey: "basic" });

    expect(await admin.merchantOnboarding.signUp(nour)).toEqual({
      kind: "unavailable",
      reason: "not-multi",
    });
  });
});
