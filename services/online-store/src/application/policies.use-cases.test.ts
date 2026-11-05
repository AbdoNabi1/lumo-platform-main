import { ConcurrencyError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { harness } from "../testing/fakes";

const T = "t-1";

describe("policies (spec 2.3, 2.6)", () => {
  it("lists all five, unset, in order", async () => {
    const { controller } = harness();
    const res = await controller.listPolicies({ tenantId: T });
    expect(res.status).toBe(200);
    expect((res.body as { policies: unknown[] }).policies).toEqual(
      ["refund", "shipping", "privacy", "terms", "contact"].map((type) => ({
        type,
        set: false,
        locales: [],
        updatedAt: null,
      })),
    );
  });

  it("saves one locale, then is set with that locale; the version guards a stale save", async () => {
    const { controller } = harness();
    const saved = await controller.updatePolicy({
      tenantId: T,
      type: "refund",
      by: "staff-1",
      expectedVersion: 0,
      body: { ar: "## الاسترجاع\nخلال 14 يوماً" },
    });
    expect(saved).toMatchObject({
      status: 200,
      body: { type: "refund", version: 1, body: { ar: "## الاسترجاع\nخلال 14 يوماً" } },
    });
    const stale = await controller.updatePolicy({
      tenantId: T,
      type: "refund",
      by: "s",
      expectedVersion: 0,
      body: {},
    });
    expect(stale).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    const list = (await controller.listPolicies({ tenantId: T })).body as {
      policies: { set: boolean; locales: string[] }[];
    };
    expect(list.policies[0]).toMatchObject({ set: true, locales: ["ar"] });
  });

  it("a lost race (ConcurrencyError from save) is answered 409 VERSION_CONFLICT", async () => {
    const { controller, repos } = harness();
    repos.policies.save = () => Promise.reject(new ConcurrencyError("lost"));
    const res = await controller.updatePolicy({
      tenantId: T,
      type: "refund",
      by: "s",
      expectedVersion: 0,
      body: { en: "x" },
    });
    expect(res).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
  });

  it("getPolicy returns the stored view and the version for the next save", async () => {
    const { controller } = harness();
    expect(await controller.getPolicy({ tenantId: T, type: "terms" })).toEqual({
      status: 200,
      body: { type: "terms", body: {}, updatedAt: null, version: 0 },
    });
    await controller.updatePolicy({
      tenantId: T,
      type: "terms",
      by: "s",
      expectedVersion: 0,
      body: { en: "Terms" },
    });
    expect(await controller.getPolicy({ tenantId: T, type: "terms" })).toEqual({
      status: 200,
      body: {
        type: "terms",
        body: { en: "Terms" },
        updatedAt: "2026-10-27T10:00:00.000Z",
        version: 1,
      },
    });
    expect((await controller.getPolicy({ tenantId: "t-2", type: "terms" })).body).toMatchObject({
      version: 0,
    });
  });

  it("TOO_LONG and UNSAFE_LINK per locale, validated before any write", async () => {
    const { controller, repos } = harness();
    const res = await controller.updatePolicy({
      tenantId: T,
      type: "terms",
      by: "s",
      expectedVersion: 0,
      body: { ar: "x".repeat(100_001), en: "[x](javascript:alert(1))" },
    });
    expect(res.status).toBe(422);
    expect((res.body as { fields: unknown[] }).fields).toEqual(
      expect.arrayContaining([
        { field: "body.ar", message: "TOO_LONG" },
        { field: "body.en", message: "UNSAFE_LINK" },
      ]),
    );
    expect((await repos.policies.get("terms", T)).snapshot().persisted).toBe(false);
  });

  it("text that normalises to nothing leaves the policy not set; the public read is then 404", async () => {
    const { controller } = harness();
    await controller.updatePolicy({
      tenantId: T,
      type: "privacy",
      by: "s",
      expectedVersion: 0,
      body: { en: "  \n " },
    });
    expect(await controller.publicPolicy({ tenantId: T, type: "privacy" })).toMatchObject({
      status: 404,
      body: { code: "POLICY_NOT_FOUND" },
    });
  });

  it("the public read serves a one-locale policy as stored, and never another shop's", async () => {
    const { controller } = harness();
    await controller.updatePolicy({
      tenantId: T,
      type: "shipping",
      by: "s",
      expectedVersion: 0,
      body: { en: "2–5 days" },
    });
    expect(await controller.publicPolicy({ tenantId: T, type: "shipping" })).toEqual({
      status: 200,
      body: { type: "shipping", body: { en: "2–5 days" }, updatedAt: "2026-10-27T10:00:00.000Z" },
    });
    expect((await controller.publicPolicy({ tenantId: "t-2", type: "shipping" })).status).toBe(404);
  });

  it("public views list their fields: no staff id and no internal field (Ruling 2)", async () => {
    const { controller } = harness();
    await controller.updatePolicy({
      tenantId: T,
      type: "contact",
      by: "staff-secret-id",
      expectedVersion: 0,
      body: { ar: "تواصل" },
    });
    const publicRes = await controller.publicPolicy({ tenantId: T, type: "contact" });
    expect(Object.keys(publicRes.body as object).sort()).toEqual(["body", "type", "updatedAt"]);
    expect(JSON.stringify(publicRes)).not.toContain("staff-secret-id");
    expect(JSON.stringify(publicRes)).not.toContain("updatedBy");
    expect(JSON.stringify(publicRes)).not.toContain("persisted");
    // The admin views do not carry the staff id either.
    const getRes = await controller.getPolicy({ tenantId: T, type: "contact" });
    const listRes = await controller.listPolicies({ tenantId: T });
    expect(JSON.stringify(getRes)).not.toContain("staff-secret-id");
    expect(JSON.stringify(listRes)).not.toContain("staff-secret-id");
    expect(Object.keys(getRes.body as object).sort()).toEqual([
      "body",
      "type",
      "updatedAt",
      "version",
    ]);
  });

  it("generating a template is pure: nothing is saved", async () => {
    const { controller, repos } = harness();
    const res = await controller.generatePolicyTemplate({
      type: "refund",
      locale: "en",
      inputs: { storeName: "Nour" },
    });
    expect(res.status).toBe(200);
    expect((res.body as { body: string }).body).toContain("within 14 days");
    expect((await repos.policies.get("refund", T)).snapshot().persisted).toBe(false);
    const bad = await controller.generatePolicyTemplate({
      type: "refund",
      locale: "en",
      inputs: { returnWindowDays: -1 },
    });
    expect(bad).toMatchObject({ status: 422 });
  });
});
