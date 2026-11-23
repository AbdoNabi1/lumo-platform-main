import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { RoleTableAccessControl } from "@platform/auth";
import { JsonEventSerializer } from "@platform/domain-events";
import {
  API,
  bootMultiTenant,
  seedBasicPlan,
  signUpStoreOf,
  type Store,
} from "./testing/multi-tenant-signup";

/**
 * Lead Site Part C — two stores that signed themselves up (A as a lead website, B as a store) keep
 * their leads apart, through the REAL multi-mode pipeline (real tenant rows and site types from
 * sign-up, real token claims, the real role table, the real tenancy-backed shop facts). Only the
 * Redis-shaped ports are in-memory doubles. No public route changes a site type, so the only way a
 * shop becomes a lead site is the sign-up choice.
 *
 * Layer under test: application (transport + composition). No RLS, no Postgres.
 */

beforeEach(() => {
  expect.hasAssertions();
});

describe("leads stay with their shop (real multi-tenant pipeline)", () => {
  let app: FastifyInstance;
  let a: Store;
  let b: Store;
  let leadOfA: string;

  const authed = (token: string, extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...extra,
  });
  const get = (token: string, url: string, extra: Record<string, string> = {}) =>
    app.inject({ method: "GET", url: `${API}${url}`, headers: authed(token, extra) });
  const publicSubmit = (tenantId: string, key: string) =>
    app.inject({
      method: "POST",
      url: `${API}/public/leads`,
      headers: {
        "content-type": "application/json",
        "x-tenant-id": tenantId,
        "idempotency-key": key,
      },
      payload: {
        formId: "home-form",
        name: "Mona Ali",
        phone: "01012345678",
        email: "mona@example.com",
        message: "I would like to book a visit",
        sessionId: "session-0001",
        sessionAlreadyEmitted: false,
        spamSignals: { honeypot: false, elapsedMs: 8_000 },
        context: {
          pageUrl: "https://alpha.test/",
          referrer: null,
          ip: "203.0.113.7",
          userAgent: "Mozilla/5.0",
          cookies: {},
        },
      },
    });

  beforeAll(async () => {
    const booted = await bootMultiTenant({
      serializer: new JsonEventSerializer(),
      accessControl: new RoleTableAccessControl(),
    });
    app = booted.app;
    // Seeded only AFTER the boot check (see merchant-onboarding-isolation.e2e.test.ts).
    await seedBasicPlan(booted.licensing);
    a = await signUpStoreOf(app, "Alpha Clinic", "owner@alpha-clinic.test", "lead_site");
    b = await signUpStoreOf(app, "Beta Store", "owner@beta-store.test", "store");
  });
  afterAll(async () => {
    await app.close();
  });

  it("control: sign-up recorded each shop's site type", async () => {
    expect(((await get(a.token, "/store/settings")).json() as { siteType: string }).siteType).toBe(
      "lead_site",
    );
    expect(((await get(b.token, "/store/settings")).json() as { siteType: string }).siteType).toBe(
      "store",
    );
  });

  it("the lead site takes a lead (201 emit); the store refuses it (409 BUSINESS_RULE)", async () => {
    const taken = await publicSubmit(a.tenantId, "alpha-key-0001");
    expect(taken.statusCode).toBe(201);
    const body = taken.json() as { leadId: string; emission: string };
    expect(body.emission).toBe("emit");
    leadOfA = body.leadId;

    const refused = await publicSubmit(b.tenantId, "beta-key-00001");
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { code: string }).code).toBe("BUSINESS_RULE");
  });

  it("A's owner lists A's lead and reads it", async () => {
    const list = await get(a.token, "/leads");
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: { id: string }[] }).items.map((l) => l.id)).toEqual([leadOfA]);
    const one = await get(a.token, `/leads/${leadOfA}`);
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ id: leadOfA, name: "Mona Ali", status: "new" });
  });

  it("B's token sees none of A's leads: empty list and export, 404 for A's lead id and its status", async () => {
    const list = await get(b.token, "/leads");
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items).toEqual([]);
    const exported = await get(b.token, "/leads/export-rows");
    expect(exported.statusCode).toBe(200);
    expect((exported.json() as { items: unknown[] }).items).toEqual([]);

    expect((await get(b.token, `/leads/${leadOfA}`)).statusCode).toBe(404);
    const status = await app.inject({
      method: "POST",
      url: `${API}/leads/${leadOfA}/status`,
      headers: authed(b.token, { "idempotency-key": "beta-status-0001" }),
      payload: { status: "rejected" },
    });
    expect(status.statusCode).toBe(404);
    expect(((await get(a.token, `/leads/${leadOfA}`)).json() as { status: string }).status).toBe(
      "new",
    );
  });

  it("a forged x-tenant-id naming A does not move B's token onto A's leads", async () => {
    const forged = { "x-tenant-id": a.tenantId };
    const list = await get(b.token, "/leads", forged);
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items).toEqual([]);
    expect((await get(b.token, `/leads/${leadOfA}`, forged)).statusCode).toBe(404);
    expect((await get(b.token, "/leads/export-rows", forged)).statusCode).toBe(200);
    expect(
      ((await get(b.token, "/leads/export-rows", forged)).json() as { items: unknown[] }).items,
    ).toEqual([]);
  });
});
