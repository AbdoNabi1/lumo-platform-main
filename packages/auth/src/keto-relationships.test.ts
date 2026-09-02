import { describe, expect, it } from "vitest";
import type { Logger } from "@platform/utils";
import { KetoRelationshipClient } from "./keto-relationships";
import type { HttpFetch } from "./kratos";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

function client(fetchImpl: HttpFetch): KetoRelationshipClient {
  return new KetoRelationshipClient({
    readUrl: "http://keto:4466",
    writeUrl: "http://keto:4467",
    fetch: fetchImpl,
    namespace: "permissions",
    logger: silent,
  });
}

describe("KetoRelationshipClient — check (ReBAC)", () => {
  it("queries the read API and honors allowed=true/false", async () => {
    const c = client(async (url) => {
      expect(url).toContain("http://keto:4466/relation-tuples/check?");
      expect(url).toContain("namespace=permissions");
      expect(url).toContain("object=doc%3A1");
      expect(url).toContain("relation=viewer");
      expect(url).toContain("subject_id=principal%3Aa");
      return { status: 200, json: async () => ({ allowed: true }) };
    });
    expect(
      await c.check({
        namespace: "permissions",
        object: "doc:1",
        relation: "viewer",
        subjectId: "principal:a",
      }),
    ).toBe(true);
  });

  it("FAILS CLOSED on non-200 and on transport error", async () => {
    expect(
      await client(async () => ({ status: 500, json: async () => ({}) })).check({
        namespace: "n",
        object: "o",
        relation: "r",
        subjectId: "s",
      }),
    ).toBe(false);
    expect(
      await client(async () => {
        throw new Error("ECONNREFUSED");
      }).check({ namespace: "n", object: "o", relation: "r", subjectId: "s" }),
    ).toBe(false);
  });
});

describe("KetoRelationshipClient — write/delete (sync)", () => {
  it("PUTs a direct-subject tuple as subject_id", async () => {
    let body: unknown;
    const c = client(async (url, init) => {
      expect(url).toBe("http://keto:4467/admin/relation-tuples");
      expect(init?.method).toBe("PUT");
      body = JSON.parse(init?.body ?? "{}");
      return { status: 201, json: async () => ({}) };
    });
    await c.write({
      namespace: "permissions",
      object: "doc:1",
      relation: "viewer",
      subject: "principal:a",
    });
    expect(body).toEqual({
      namespace: "permissions",
      object: "doc:1",
      relation: "viewer",
      subject_id: "principal:a",
    });
  });

  it("PUTs a subject-set tuple as structured subject_set", async () => {
    let body: Record<string, unknown> = {};
    const c = client(async (_url, init) => {
      body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
      return { status: 200, json: async () => ({}) };
    });
    await c.write({
      namespace: "permissions",
      object: "doc:1",
      relation: "viewer",
      subject: "group:eng#member",
    });
    expect(body["subject_set"]).toEqual({
      namespace: "permissions",
      object: "group:eng",
      relation: "member",
    });
    expect(body["subject_id"]).toBeUndefined();
  });

  it("THROWS on a write failure so the sync consumer retries", async () => {
    const c = client(async () => ({ status: 500, json: async () => ({}) }));
    await expect(
      c.write({ namespace: "n", object: "o", relation: "r", subject: "s" }),
    ).rejects.toThrow(/write failed/);
  });

  it("DELETE treats 404 (already gone) as idempotent success", async () => {
    const c = client(async (url, init) => {
      expect(init?.method).toBe("DELETE");
      expect(url).toContain("subject_id=s");
      return { status: 404, json: async () => ({}) };
    });
    await expect(
      c.delete({ namespace: "n", object: "o", relation: "r", subject: "s" }),
    ).resolves.toBeUndefined();
  });

  it("DELETE of a subject-set maps to subject_set.* query params", async () => {
    const c = client(async (url) => {
      expect(url).toContain("subject_set.object=group%3Aeng");
      expect(url).toContain("subject_set.relation=member");
      return { status: 204, json: async () => ({}) };
    });
    await expect(
      c.delete({
        namespace: "permissions",
        object: "doc:1",
        relation: "viewer",
        subject: "group:eng#member",
      }),
    ).resolves.toBeUndefined();
  });
});
