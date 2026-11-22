import { NotFoundError, ValidationError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import type { TemplateDraft } from "../domain/message-template";
import { MetaApiError } from "../infrastructure/meta-graph-client";
import {
  BODY_ONE_VAR,
  createOutreachKit,
  metaTemplate,
  seedConnection,
  seedTemplate,
  T1,
  T2,
} from "../testing/outreach-kit";
import { errorOf, okValue } from "../testing/result-helpers";
import { seconds, templateStatusPayload } from "../testing/webhook-fixtures";
import { ProcessWhatsAppWebhook } from "./webhook.use-case";
import { CreateTemplate, DeleteTemplate, ListTemplates, SyncTemplates } from "./template.use-cases";

const draft: TemplateDraft = {
  name: "order_update",
  language: "en_US",
  category: "UTILITY",
  body: { text: "Hi {{1}}, order shipped", examples: ["Sara"] },
};

describe("SyncTemplates", () => {
  it("inserts remote templates under the active WABA, emitting one status_changed each", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.templates = [
      {
        ...metaTemplate(await seedTemplate(kit, { tenantId: T2, wabaId: "other" })),
        name: "t_one",
        id: "m1",
        language: "en-US",
      },
    ];
    const list = okValue(await new SyncTemplates(kit.deps).execute({ tenantId: T1 }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "t_one", language: "en_US", status: "APPROVED" });
    expect(kit.whatsapp.callsOf("listTemplates")[0]?.[0]).toBe("waba-1");
    const events = kit.events.ofType("outreach.template.status_changed");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      wabaId: "waba-1",
      metaTemplateId: "m1",
      from: null,
      to: "APPROVED",
    });
  });

  it("marks a local row missing remotely DELETED and an unchanged second sync emits nothing", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const local = await seedTemplate(kit);
    kit.whatsapp.templates = [];
    const uc = new SyncTemplates(kit.deps);
    const first = okValue(await uc.execute({ tenantId: T1 }));
    expect(first[0]?.status).toBe("DELETED");
    expect(kit.events.ofType("outreach.template.status_changed")[0]?.payload).toMatchObject({
      from: "APPROVED",
      to: "DELETED",
      name: local.name,
    });
    kit.events.calls.length = 0;
    okValue(await uc.execute({ tenantId: T1 }));
    expect(kit.events.calls).toHaveLength(0);
  });

  it("maps unknown statuses to UNKNOWN and an unknown category to MARKETING + UNKNOWN", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const base = metaTemplate(await seedTemplate(kit, { tenantId: T2, wabaId: "x" }));
    kit.whatsapp.templates = [
      { ...base, id: "a", name: "a_t", status: "FLAGGED" },
      { ...base, id: "b", name: "b_t", category: "SOMETHING_NEW" },
    ];
    const list = okValue(await new SyncTemplates(kit.deps).execute({ tenantId: T1 }));
    const byName = Object.fromEntries(list.map((t) => [t.name, t]));
    expect(byName.a_t).toMatchObject({ status: "UNKNOWN" });
    expect(byName.b_t).toMatchObject({ status: "UNKNOWN", category: "MARKETING" });
  });

  it("refuses without ports and without a connected account, with zero Meta calls", async () => {
    expect.hasAssertions();
    const off = createOutreachKit({ configured: false });
    expect(errorOf(await new SyncTemplates(off.deps).execute({ tenantId: T1 })).message).toBe(
      "WHATSAPP_NOT_CONFIGURED",
    );
    const kit = createOutreachKit();
    expect(errorOf(await new SyncTemplates(kit.deps).execute({ tenantId: T1 })).message).toBe(
      "WHATSAPP_NOT_CONNECTED",
    );
    await seedConnection(kit, { status: "onboarding" });
    expect(errorOf(await new SyncTemplates(kit.deps).execute({ tenantId: T1 })).message).toBe(
      "WHATSAPP_NOT_CONNECTED",
    );
    expect(kit.whatsapp.total).toBe(0);
  });

  it("a Meta failure is META_<code> and persists nothing", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.set("listTemplates", () => {
      throw new MetaApiError("190", "Invalid token", 401);
    });
    const error = errorOf(await new SyncTemplates(kit.deps).execute({ tenantId: T1 }));
    expect(error.message).toBe("META_190");
    expect(kit.mem.store.templates.values()).toHaveLength(0);
    expect(kit.events.calls).toHaveLength(0);
  });

  it("a connection that changed during the fetch is CONNECTION_CHANGED with no write", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const conn = await seedConnection(kit);
    kit.whatsapp.templates = [metaTemplate(await seedTemplate(kit, { tenantId: T2, wabaId: "x" }))];
    kit.whatsapp.set("listTemplates", async () => {
      await kit.mem.connections.save({ ...conn, qualityRating: "YELLOW" }, conn.version);
      return kit.whatsapp.templates;
    });
    expect(errorOf(await new SyncTemplates(kit.deps).execute({ tenantId: T1 })).message).toBe(
      "CONNECTION_CHANGED",
    );
    expect(kit.mem.store.templates.values().filter((t) => t.tenantId === T1)).toHaveLength(0);
  });

  it("a disconnect during the fetch writes nothing and does not refresh to connected", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const conn = await seedConnection(kit);
    kit.whatsapp.templates = [metaTemplate(await seedTemplate(kit, { tenantId: T2, wabaId: "x" }))];
    kit.whatsapp.set("listTemplates", async () => {
      await kit.mem.connections.save(
        { ...conn, status: "disconnected", sealedCredentials: "" },
        conn.version,
      );
      return kit.whatsapp.templates;
    });
    expect(errorOf(await new SyncTemplates(kit.deps).execute({ tenantId: T1 })).message).toBe(
      "CONNECTION_CHANGED",
    );
    expect((await kit.mem.connections.get(T1))?.status).toBe("disconnected");
  });
});

describe("CreateTemplate", () => {
  it("turns domain issues into ValidationError fields with the issue code as message", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const error = errorOf(
      await new CreateTemplate(kit.deps).execute({
        tenantId: T1,
        draft: { ...draft, name: "Bad Name", body: { text: "", examples: [] } },
      }),
    );
    expect(error).toBeInstanceOf(ValidationError);
    const fields = (error as ValidationError).fields;
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((f) => f.field !== "" && f.message !== "")).toBe(true);
    expect(kit.whatsapp.total).toBe(0);
  });

  it("stores what Meta returns, including a recategorization", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.set("createTemplate", () => ({
      id: "m-9",
      status: "PENDING",
      category: "MARKETING",
    }));
    const dto = okValue(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft }));
    expect(dto).toMatchObject({
      name: "order_update",
      category: "MARKETING",
      status: "PENDING",
      variableCount: 1,
    });
    const call = kit.whatsapp.callsOf("createTemplate")[0];
    expect(call?.[0]).toBe("waba-1");
    expect(kit.events.ofType("outreach.template.status_changed")[0]?.payload).toMatchObject({
      from: null,
      to: "PENDING",
      category: "MARKETING",
    });
  });

  it("an unrecognised category from Meta is stored non-sendable", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.set("createTemplate", () => ({
      id: "m-9",
      status: "APPROVED",
      category: "WEIRD",
    }));
    const dto = okValue(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft }));
    expect(dto.status).toBe("UNKNOWN");
    expect(dto.category).toBe("UTILITY");
  });

  it("refuses a local duplicate before any Meta call and surfaces a Meta failure as META_<code>", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedTemplate(kit, { name: "order_update", language: "en_US" });
    expect(
      errorOf(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft })).message,
    ).toBe("TEMPLATE_ALREADY_EXISTS");
    expect(kit.whatsapp.total).toBe(0);
    kit.whatsapp.set("createTemplate", () => {
      throw new MetaApiError("100", "bad", 400);
    });
    const fresh = { ...draft, name: "fresh_one" };
    expect(
      errorOf(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft: fresh })).message,
    ).toBe("META_100");
    expect(
      await kit.mem.templates.findByNameLanguage(T1, "waba-1", "fresh_one", "en_US"),
    ).toBeNull();
  });

  it("recreating over a DELETED local row updates it", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedTemplate(kit, { name: "order_update", language: "en_US", status: "DELETED" });
    const dto = okValue(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft }));
    expect(dto.status).toBe("PENDING");
    expect(kit.mem.store.templates.values()).toHaveLength(1);
    expect(kit.events.ofType("outreach.template.status_changed")[0]?.payload).toMatchObject({
      from: "DELETED",
      to: "PENDING",
    });
  });

  it("a connection change after the remote create is CONNECTION_CHANGED and stores nothing", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const conn = await seedConnection(kit);
    kit.whatsapp.set("createTemplate", async () => {
      await kit.mem.connections.save(
        { ...conn, status: "disconnected", sealedCredentials: "" },
        conn.version,
      );
      return { id: "m-1", status: "PENDING", category: "UTILITY" };
    });
    expect(
      errorOf(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft })).message,
    ).toBe("CONNECTION_CHANGED");
    expect(kit.mem.store.templates.values()).toHaveLength(0);
  });

  it("needs a connected account", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    expect(
      errorOf(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft })).message,
    ).toBe("WHATSAPP_NOT_CONNECTED");
    expect(kit.whatsapp.total).toBe(0);
  });
});

describe("DeleteTemplate", () => {
  it("deletes remotely and marks every language DELETED with an event each", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedTemplate(kit, { name: "promo", language: "ar" });
    await seedTemplate(kit, { name: "promo", language: "en_US", metaTemplateId: "meta-promo-en" });
    const out = okValue(
      await new DeleteTemplate(kit.deps).execute({ tenantId: T1, name: "promo" }),
    );
    expect(out.deleted).toBe(2);
    expect(kit.whatsapp.callsOf("deleteTemplate")[0]?.[2]).toBe("promo");
    expect(kit.events.ofType("outreach.template.status_changed")).toHaveLength(2);
    expect(kit.mem.store.templates.values().every((t) => t.status === "DELETED")).toBe(true);
  });

  it("is NotFound for an unknown name (no Meta call) and surfaces Meta failures", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    expect(
      errorOf(await new DeleteTemplate(kit.deps).execute({ tenantId: T1, name: "nope" })),
    ).toBeInstanceOf(NotFoundError);
    expect(
      errorOf(await new DeleteTemplate(kit.deps).execute({ tenantId: T1, name: " " })),
    ).toBeInstanceOf(ValidationError);
    expect(kit.whatsapp.total).toBe(0);
    await seedTemplate(kit, { name: "promo" });
    kit.whatsapp.set("deleteTemplate", () => {
      throw new MetaApiError("100", "x", 400);
    });
    expect(
      errorOf(await new DeleteTemplate(kit.deps).execute({ tenantId: T1, name: "promo" })).message,
    ).toBe("META_100");
    expect(kit.mem.store.templates.values()[0]?.status).toBe("APPROVED");
  });

  it("a disconnect during the remote delete is CONNECTION_CHANGED with no write", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const conn = await seedConnection(kit);
    await seedTemplate(kit, { name: "promo" });
    kit.whatsapp.set("deleteTemplate", async () => {
      await kit.mem.connections.save(
        { ...conn, status: "disconnected", sealedCredentials: "" },
        conn.version,
      );
    });
    expect(
      errorOf(await new DeleteTemplate(kit.deps).execute({ tenantId: T1, name: "promo" })).message,
    ).toBe("CONNECTION_CHANGED");
    expect(kit.mem.store.templates.values()[0]?.status).toBe("APPROVED");
  });

  it("needs a connected account", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    expect(
      errorOf(await new DeleteTemplate(kit.deps).execute({ tenantId: T1, name: "promo" })).message,
    ).toBe("WHATSAPP_NOT_CONNECTED");
  });
});

describe("ListTemplates", () => {
  it("maps stored templates to DTOs with the send shape and sanitised reason", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedTemplate(kit, {
      components: [
        ...BODY_ONE_VAR,
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Confirm" }] },
      ],
    });
    const stored = kit.mem.store.templates.values()[0];
    if (stored === undefined) throw new Error("seed");
    kit.mem.store.templates.set(stored.id, { ...stored, rejectedReason: "NONE" }, undefined);
    const list = okValue(await new ListTemplates(kit.deps).execute({ tenantId: T1 }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      supported: true,
      variableCount: 1,
      rejectedReason: null,
      buttons: [{ type: "QUICK_REPLY", text: "Confirm" }],
      sendShape: { bodyVariableCount: 1, headerHasVariable: false },
    });
  });

  it("an unsupported shape is reported and a disconnected shop lists nothing", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    expect(okValue(await new ListTemplates(kit.deps).execute({ tenantId: T1 }))).toEqual([]);
    await seedConnection(kit);
    await seedTemplate(kit, { components: [{ type: "HEADER", format: "IMAGE" }] });
    expect(okValue(await new ListTemplates(kit.deps).execute({ tenantId: T1 }))[0]?.supported).toBe(
      false,
    );
    await kit.mem.connections.save(
      { ...(await kit.mem.connections.get(T1))!, status: "disconnected" },
      1,
    );
    expect(okValue(await new ListTemplates(kit.deps).execute({ tenantId: T1 }))).toEqual([]);
  });
});

describe("CreateTemplate — replacing a DELETED tombstone (I7) and a stable aggregate id (M2)", () => {
  const seedTombstone = async (kit: ReturnType<typeof createOutreachKit>) => {
    const tombstone = await seedTemplate(kit, {
      id: "tpl-stable",
      name: "order_update",
      language: "en_US",
      status: "DELETED",
      metaTemplateId: "meta-old",
    });
    // markers of the OLD provider object
    kit.mem.store.templates.set(
      tombstone.id,
      {
        ...tombstone,
        statusEventAt: new Date("2026-11-19T09:00:00.000Z"),
        categoryEventAt: new Date("2026-11-19T09:30:00.000Z"),
      },
      undefined,
    );
    return tombstone;
  };

  it("a remote create that returns a DIFFERENT provider id replaces the tombstone in place", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedTombstone(kit);
    kit.whatsapp.set("createTemplate", () => ({
      id: "meta-NEW",
      status: "PENDING",
      category: "UTILITY",
    }));
    const dto = okValue(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft }));
    expect(dto).toMatchObject({ name: "order_update", language: "en_US", status: "PENDING" });
    const rows = kit.mem.store.templates.values();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "tpl-stable",
      metaTemplateId: "meta-NEW",
      status: "PENDING",
      statusEventAt: null,
      categoryEventAt: null,
      revision: 2,
    });
    // both lookup directions: the new provider id finds the row, the old one no longer does
    expect((await kit.mem.templates.findByProviderId(T1, "waba-1", "meta-NEW"))?.id).toBe(
      "tpl-stable",
    );
    expect(await kit.mem.templates.findByProviderId(T1, "waba-1", "meta-old")).toBeNull();
    const events = kit.events.ofType("outreach.template.status_changed");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      aggregateId: "tpl-stable",
      payload: { metaTemplateId: "meta-NEW", from: "DELETED", to: "PENDING" },
    });
  });

  it("a write that landed on the tombstone after the pre-check (revision moved) is TEMPLATE_ALREADY_EXISTS and replaces nothing", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const tombstone = await seedTombstone(kit);
    kit.whatsapp.set("createTemplate", () => {
      kit.mem.store.templates.set(
        tombstone.id,
        { ...tombstone, revision: tombstone.revision + 1, version: tombstone.version + 1 },
        undefined,
      );
      return { id: "meta-NEW", status: "PENDING", category: "UTILITY" };
    });
    expect(
      errorOf(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft })).message,
    ).toBe("TEMPLATE_ALREADY_EXISTS");
    expect(kit.mem.store.templates.values()[0]).toMatchObject({
      metaTemplateId: "meta-old",
      status: "DELETED",
    });
    expect(kit.events.calls).toHaveLength(0);
  });

  it("provider id REUSED + a revision bump on the tombstone: TEMPLATE_ALREADY_EXISTS, never the stale tombstone as success, no event", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const tombstone = await seedTombstone(kit);
    kit.whatsapp.set("createTemplate", () => {
      kit.mem.store.templates.set(
        tombstone.id,
        { ...tombstone, revision: tombstone.revision + 1, version: tombstone.version + 1 },
        undefined,
      );
      // Meta handed back the SAME provider id the tombstone carries
      return { id: "meta-old", status: "PENDING", category: "UTILITY" };
    });
    expect(
      errorOf(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft })).message,
    ).toBe("TEMPLATE_ALREADY_EXISTS");
    expect(kit.mem.store.templates.values()[0]).toMatchObject({
      metaTemplateId: "meta-old",
      status: "DELETED",
    });
    expect(kit.events.calls).toHaveLength(0);
  });

  it("a sync that adopted the very template just created (live row, same local and new provider id) is an idempotent success without a second event", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const tombstone = await seedTombstone(kit);
    kit.whatsapp.set("createTemplate", () => ({
      id: "meta-NEW",
      status: "PENDING",
      category: "UTILITY",
    }));
    // The adopting sync lands between the use case's read of the tombstone and its CAS (inside the transaction).
    const real = kit.mem.templates;
    kit.deps.templates = new Proxy(real, {
      get(target, prop) {
        if (prop === "replaceTombstone") {
          return (...args: Parameters<typeof real.replaceTombstone>) => {
            kit.mem.store.templates.set(
              tombstone.id,
              {
                ...tombstone,
                metaTemplateId: "meta-NEW",
                status: "PENDING",
                revision: tombstone.revision + 1,
                version: tombstone.version + 1,
              },
              undefined,
            );
            return target.replaceTombstone(...args);
          };
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const dto = okValue(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft }));
    expect(dto).toMatchObject({ name: "order_update", status: "PENDING" });
    expect(kit.mem.store.templates.values()[0]).toMatchObject({
      id: "tpl-stable",
      metaTemplateId: "meta-NEW",
    });
    expect(kit.mem.store.templates.values()).toHaveLength(1);
    expect(kit.events.calls).toHaveLength(0);
  });

  it("a row that came back live (not DELETED) during the remote create is never overwritten", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const tombstone = await seedTombstone(kit);
    kit.whatsapp.set("createTemplate", () => {
      kit.mem.store.templates.set(
        tombstone.id,
        { ...tombstone, status: "APPROVED", revision: tombstone.revision + 1 },
        undefined,
      );
      return { id: "meta-NEW", status: "PENDING", category: "UTILITY" };
    });
    expect(
      errorOf(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft })).message,
    ).toBe("TEMPLATE_ALREADY_EXISTS");
    expect(kit.mem.store.templates.values()[0]).toMatchObject({
      metaTemplateId: "meta-old",
      status: "APPROVED",
    });
  });

  it("create, sync and webhook events all carry the one stable local row id as aggregate id", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.set("createTemplate", () => ({
      id: "m-77",
      status: "PENDING",
      category: "UTILITY",
    }));
    okValue(await new CreateTemplate(kit.deps).execute({ tenantId: T1, draft }));
    const local = kit.mem.store.templates.values()[0];
    expect(local).toBeDefined();
    kit.clock.advance(10_000);
    kit.whatsapp.templates = [
      {
        id: "m-77",
        name: "order_update",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        components: local?.components as unknown[],
        rejectedReason: null,
        qualityScore: null,
      },
    ];
    okValue(await new SyncTemplates(kit.deps).execute({ tenantId: T1 }));
    kit.clock.advance(10_000);
    okValue(
      await new ProcessWhatsAppWebhook(kit.deps).execute({
        payload: templateStatusPayload({
          time: seconds(kit.clock.now()),
          metaTemplateId: "m-77",
          event: "PAUSED",
        }),
      }),
    );
    const events = kit.events.ofType("outreach.template.status_changed");
    expect(events.map((e) => e.payload.to)).toEqual(["PENDING", "APPROVED", "PAUSED"]);
    expect(events.map((e) => e.aggregateId)).toEqual([local?.id, local?.id, local?.id]);
  });
});
