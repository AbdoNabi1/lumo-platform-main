import { describe, expect, it } from "vitest";
import type { Principal } from "@platform/contracts";
import type { RouteDefinition } from "@platform/http";
import { adminRoutes } from "./admin-routes";
import type { TimelineEntryDto } from "./order-timeline-dto";
import {
  adminStaff,
  buildOrdersAdmin,
  callRoute,
  operatorStaff,
  placeTestOrder,
  viewerStaff,
} from "./testing/orders-harness";

const NAMES = { "staff-admin": "Ahmed", "staff-op": "Mona" };
const UNKNOWN_ORDER = "00000000-0000-7000-8000-0000000000ff";

interface Detail {
  readonly note: string | null;
  readonly tags: readonly string[];
  readonly timelineEntries: readonly TimelineEntryDto[];
}

async function setup() {
  const admin = buildOrdersAdmin({ staffNames: NAMES });
  const orderId = await placeTestOrder(admin);
  const routes = adminRoutes(admin);
  const route = (method: RouteDefinition["method"], path: string) =>
    routes.find((candidate) => candidate.method === method && candidate.path === path);
  const call = (
    method: RouteDefinition["method"],
    path: string,
    input: { params?: Record<string, string>; body?: unknown; query?: Record<string, string> },
    principal: Principal = adminStaff,
  ) => {
    const schema = route(method, path)?.schema;
    return callRoute(
      routes,
      method,
      path,
      {
        ...(input.params === undefined ? {} : { params: input.params }),
        ...(input.body === undefined ? {} : { body: schema?.body?.parse(input.body) }),
        ...(input.query === undefined ? {} : { query: schema?.querystring?.parse(input.query) }),
      },
      principal,
    );
  };
  const detail = async (principal: Principal = adminStaff, id = orderId) =>
    (await call("GET", "/orders/:orderId", { params: { orderId: id } }, principal)).body as Detail;
  return { admin, orderId, route, call, detail };
}

describe("PUT /orders/:orderId/note (order operations Part 2)", () => {
  it("saves the note for an operator; the order page shows it with an activity line by name", async () => {
    const { orderId, call, detail } = await setup();
    const saved = await call(
      "PUT",
      "/orders/:orderId/note",
      { params: { orderId }, body: { note: "  Ring twice " } },
      operatorStaff,
    );
    expect(saved).toEqual({ status: 200, body: { note: "Ring twice" } });
    const page = await detail();
    expect(page.note).toBe("Ring twice");
    expect(page.timelineEntries.map((line) => [line.kind, line.authorName])).toEqual([
      ["note_changed", "Mona"],
    ]);
  });

  it("is orders:edit_note, idempotent, strict; refuses a viewer (403) and an unknown order (404)", async () => {
    const { route, call } = await setup();
    const definition = route("PUT", "/orders/:orderId/note");
    expect(definition?.permission).toBe("orders:edit_note");
    expect(definition?.idempotent).toBe(true);
    expect(definition?.schema.body?.safeParse({ note: null }).success).toBe(true);
    expect(definition?.schema.body?.safeParse({ note: "x", extra: 1 }).success).toBe(false);
    const viewer = await call(
      "PUT",
      "/orders/:orderId/note",
      { params: { orderId: UNKNOWN_ORDER }, body: { note: "x" } },
      viewerStaff,
    );
    expect(viewer.status).toBe(403);
    const missing = await call("PUT", "/orders/:orderId/note", {
      params: { orderId: UNKNOWN_ORDER },
      body: { note: "x" },
    });
    expect(missing.status).toBe(404);
  });
});

describe("POST /orders/:orderId/tags", () => {
  it("adds then removes, answering the order's tags sorted", async () => {
    const { orderId, call, detail } = await setup();
    const added = await call(
      "POST",
      "/orders/:orderId/tags",
      { params: { orderId }, body: { add: ["VIP", "urgent, Gift"] } },
      operatorStaff,
    );
    expect(added).toEqual({ status: 200, body: { tags: ["Gift", "urgent", "VIP"] } });
    const changed = await call("POST", "/orders/:orderId/tags", {
      params: { orderId },
      body: { add: ["new"], remove: ["vip"] },
    });
    expect(changed).toEqual({ status: 200, body: { tags: ["Gift", "new", "urgent"] } });
    expect((await detail()).tags).toEqual(["Gift", "new", "urgent"]);
  });

  it("refuses an empty change and a viewer; answers 422 past 250 tags", async () => {
    const { orderId, route, call } = await setup();
    const schema = route("POST", "/orders/:orderId/tags")?.schema.body;
    expect(schema?.safeParse({}).success).toBe(false);
    expect(schema?.safeParse({ add: [] }).success).toBe(false);
    expect(route("POST", "/orders/:orderId/tags")?.permission).toBe("orders:tag");
    const viewer = await call(
      "POST",
      "/orders/:orderId/tags",
      { params: { orderId }, body: { add: ["vip"] } },
      viewerStaff,
    );
    expect(viewer.status).toBe(403);
    const full = Array.from({ length: 250 }, (_, i) => `t${i}`);
    expect(
      (await call("POST", "/orders/:orderId/tags", { params: { orderId }, body: { add: full } }))
        .status,
    ).toBe(200);
    const tooMany = await call("POST", "/orders/:orderId/tags", {
      params: { orderId },
      body: { add: ["one-more"] },
    });
    expect(tooMany.status).toBe(422);
    // The 422 names the cap and the offending field (carried 3).
    expect(tooMany.body).toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("250"),
      fields: [expect.objectContaining({ field: "tags" })],
    });
  });
});

describe("GET /order-tags", () => {
  it("suggests the shop's tags by literal prefix, for anyone who reads orders", async () => {
    const { orderId, route, call } = await setup();
    expect(route("GET", "/order-tags")?.permission).toBe("orders:read");
    await call("POST", "/orders/:orderId/tags", { params: { orderId }, body: { add: ["VIP"] } });
    const found = await call("GET", "/order-tags", { query: { q: "v" } }, viewerStaff);
    expect(found).toEqual({ status: 200, body: { tags: [{ tag: "VIP", count: 1 }] } });
    expect((await call("GET", "/order-tags", { query: { q: "%" } })).body).toEqual({ tags: [] });
  });
});

describe("comments on the timeline", () => {
  it("posts as the signed-in staff member and shows each viewer what they may do", async () => {
    const { orderId, call, detail } = await setup();
    const posted = await call(
      "POST",
      "/orders/:orderId/comments",
      { params: { orderId }, body: { body: "Called — no answer" } },
      operatorStaff,
    );
    expect(posted.status).toBe(201);
    expect(posted.body).toMatchObject({
      kind: "comment",
      authorName: "Mona",
      body: "Called — no answer",
      canEdit: true,
      canDelete: true,
    });
    await call("POST", "/orders/:orderId/comments", {
      params: { orderId },
      body: { body: "Paid by bank" },
    });

    const asAdmin = (await detail(adminStaff)).timelineEntries;
    const asOperator = (await detail(operatorStaff)).timelineEntries;
    const byAuthor = (lines: readonly TimelineEntryDto[], name: string) =>
      lines.find((line) => line.authorName === name);
    expect(byAuthor(asAdmin, "Mona")).toMatchObject({ canEdit: false, canDelete: true });
    expect(byAuthor(asOperator, "Ahmed")).toMatchObject({ canEdit: false, canDelete: false });
    expect(byAuthor(asOperator, "Mona")).toMatchObject({ canEdit: true, canDelete: true });
  });

  it("an operator cannot edit or delete an admin's comment; an admin deletes an operator's", async () => {
    const { orderId, call } = await setup();
    const byAdmin = (
      await call("POST", "/orders/:orderId/comments", { params: { orderId }, body: { body: "A" } })
    ).body as TimelineEntryDto;
    const byOperator = (
      await call(
        "POST",
        "/orders/:orderId/comments",
        { params: { orderId }, body: { body: "B" } },
        operatorStaff,
      )
    ).body as TimelineEntryDto;
    const params = (entryId: string) => ({ orderId, entryId });

    expect(
      (
        await call(
          "PATCH",
          "/orders/:orderId/comments/:entryId",
          { params: params(byAdmin.id), body: { body: "edited" } },
          operatorStaff,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "DELETE",
          "/orders/:orderId/comments/:entryId",
          { params: params(byAdmin.id) },
          operatorStaff,
        )
      ).status,
    ).toBe(403);

    const deleted = await call("DELETE", "/orders/:orderId/comments/:entryId", {
      params: params(byOperator.id),
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ deleted: true, body: null });
    const editDeleted = await call(
      "PATCH",
      "/orders/:orderId/comments/:entryId",
      { params: params(byOperator.id), body: { body: "again" } },
      operatorStaff,
    );
    expect(editDeleted.status).toBe(409);
  });

  it("PATCH with another order's entry id is 404 and leaves that comment alone (Review Focus 5)", async () => {
    const { admin, orderId, call, detail } = await setup();
    const other = await placeTestOrder(admin);
    const onOther = (
      await call("POST", "/orders/:orderId/comments", {
        params: { orderId: other },
        body: { body: "keep" },
      })
    ).body as TimelineEntryDto;
    const moved = await call("PATCH", "/orders/:orderId/comments/:entryId", {
      params: { orderId, entryId: onOther.id },
      body: { body: "hijacked" },
    });
    expect(moved.status).toBe(404);
    expect((await detail(adminStaff, other)).timelineEntries[0]?.body).toBe("keep");
  });

  it("a viewer cannot comment; archiving shows on the timeline by name", async () => {
    const { orderId, call, detail } = await setup();
    const viewer = await call(
      "POST",
      "/orders/:orderId/comments",
      { params: { orderId }, body: { body: "x" } },
      viewerStaff,
    );
    expect(viewer.status).toBe(403);
    await call("POST", "/orders/:orderId/archive", { params: { orderId } });
    expect((await detail()).timelineEntries.map((line) => [line.kind, line.authorName])).toEqual([
      ["archived", "Ahmed"],
    ]);
  });
});

describe("a deleted comment's text is never served again (global constraints, resolution 9)", () => {
  it("not by the DELETE response, a repeated DELETE, the edit refusal, or the order detail", async () => {
    const { orderId, call, detail } = await setup();
    const SECRET = "Customer's door code is 4471";
    const posted = (
      await call(
        "POST",
        "/orders/:orderId/comments",
        { params: { orderId }, body: { body: SECRET } },
        operatorStaff,
      )
    ).body as TimelineEntryDto;
    const params = { orderId, entryId: posted.id };

    const deleted = await call(
      "DELETE",
      "/orders/:orderId/comments/:entryId",
      { params },
      operatorStaff,
    );
    expect(deleted).toMatchObject({ status: 200, body: { body: null, deleted: true } });
    expect(JSON.stringify(deleted.body)).not.toContain("4471");

    const again = await call("DELETE", "/orders/:orderId/comments/:entryId", { params });
    expect(again).toMatchObject({ status: 200, body: { body: null, deleted: true } });
    expect(JSON.stringify(again.body)).not.toContain("4471");

    const edit = await call(
      "PATCH",
      "/orders/:orderId/comments/:entryId",
      { params, body: { body: "again" } },
      operatorStaff,
    );
    expect(edit.status).toBe(409);
    expect(JSON.stringify(edit.body)).not.toContain("4471");

    for (const viewer of [adminStaff, operatorStaff, viewerStaff]) {
      const page = await detail(viewer);
      expect(page.timelineEntries.find((line) => line.id === posted.id)).toMatchObject({
        body: null,
        deleted: true,
        canEdit: false,
        canDelete: false,
      });
      expect(JSON.stringify(page)).not.toContain("4471");
    }
  });

  it("the edit response serves the edited text of a live comment through the same mapper", async () => {
    const { orderId, call } = await setup();
    const posted = (
      await call("POST", "/orders/:orderId/comments", { params: { orderId }, body: { body: "A" } })
    ).body as TimelineEntryDto;
    const edited = await call("PATCH", "/orders/:orderId/comments/:entryId", {
      params: { orderId, entryId: posted.id },
      body: { body: "A, then B" },
    });
    expect(edited).toMatchObject({
      status: 200,
      body: { id: posted.id, body: "A, then B", deleted: false, canEdit: true, canDelete: true },
    });
    expect((edited.body as TimelineEntryDto).editedAt).not.toBeNull();
  });
});

describe("another shop's order is 404 on every annotation route (carried 2)", () => {
  it("note, tags and comments answer 404 and write nothing", async () => {
    const { admin, orderId, call, detail } = await setup();
    const foreign = await placeTestOrder(admin, "shop-b");
    const mine = (
      await call("POST", "/orders/:orderId/comments", {
        params: { orderId },
        body: { body: "mine" },
      })
    ).body as TimelineEntryDto;
    const theirs = (
      await callRoute(
        adminRoutes(admin),
        "POST",
        "/orders/:orderId/comments",
        { params: { orderId: foreign }, body: { body: "theirs" } },
        { ...adminStaff, tenantId: "shop-b" },
      )
    ).body as TimelineEntryDto;
    expect(theirs.id).toBeDefined();

    const attempts = [
      await call("PUT", "/orders/:orderId/note", {
        params: { orderId: foreign },
        body: { note: "x" },
      }),
      await call("POST", "/orders/:orderId/tags", {
        params: { orderId: foreign },
        body: { add: ["vip"] },
      }),
      await call("POST", "/orders/:orderId/tags", {
        params: { orderId: foreign },
        body: { remove: ["vip"] },
      }),
      await call("POST", "/orders/:orderId/comments", {
        params: { orderId: foreign },
        body: { body: "x" },
      }),
      // The foreign order's own comment, addressed through its real id from the wrong shop.
      await call("PATCH", "/orders/:orderId/comments/:entryId", {
        params: { orderId: foreign, entryId: theirs.id },
        body: { body: "hijacked" },
      }),
      await call("DELETE", "/orders/:orderId/comments/:entryId", {
        params: { orderId: foreign, entryId: theirs.id },
      }),
      // A foreign comment id under my own order.
      await call("PATCH", "/orders/:orderId/comments/:entryId", {
        params: { orderId, entryId: theirs.id },
        body: { body: "hijacked" },
      }),
      await call("DELETE", "/orders/:orderId/comments/:entryId", {
        params: { orderId, entryId: theirs.id },
      }),
      // My comment id under the foreign order.
      await call("PATCH", "/orders/:orderId/comments/:entryId", {
        params: { orderId: foreign, entryId: mine.id },
        body: { body: "hijacked" },
      }),
    ];
    expect(attempts.map((response) => response.status)).toEqual(attempts.map(() => 404));

    // Nothing of mine changed, and the foreign order was never touched.
    const page = await detail();
    expect(page.note).toBeNull();
    expect(page.tags).toEqual([]);
    expect(page.timelineEntries.map((line) => line.body)).toEqual(["mine"]);
    const theirPage = (
      await callRoute(
        adminRoutes(admin),
        "GET",
        "/orders/:orderId",
        { params: { orderId: foreign } },
        { ...adminStaff, tenantId: "shop-b" },
      )
    ).body as Detail;
    expect(theirPage.note).toBeNull();
    expect(theirPage.tags).toEqual([]);
    expect(theirPage.timelineEntries.map((line) => line.body)).toEqual(["theirs"]);
  });
});
