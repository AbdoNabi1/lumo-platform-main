import { describe, expect, it } from "vitest";
import {
  cliMain,
  computeGate,
  createKetoClient,
  parseArgs,
  qualify,
  runBackfill,
  runCountGate,
  runDeleteBare,
  type KetoListedTuple,
} from "../../../scripts/ops/keto-tenant-tuples.mjs";

/**
 * G-70 — the three operator scripts (backfill, count gate, delete-bare), run against a FAKE Keto that
 * speaks the same REST shapes (paginated list, PUT, DELETE with subject params). Nothing here touches
 * Ory. The property under test is the interlock: bare tuples are never deleted unless every one has
 * its qualified twin, and dry-run never writes.
 */

const TENANT = "tenant-local";
const direct = (object: string, subject: string): KetoListedTuple => ({
  namespace: "permissions",
  object,
  relation: "granted",
  subject_id: subject,
});
const viaSet = (object: string, subject: string): KetoListedTuple => ({
  namespace: "permissions",
  object,
  relation: "granted",
  subject_set: { namespace: "User", object: subject, relation: "" },
});

/** In-memory Keto. Lists two-per-page so pagination is always exercised. */
function fakeKeto(seed: KetoListedTuple[]) {
  const tuples = new Map<string, KetoListedTuple>();
  const id = (t: KetoListedTuple) =>
    [
      t.namespace,
      t.object,
      t.relation,
      t.subject_id ??
        `${t.subject_set?.namespace}:${t.subject_set?.object}#${t.subject_set?.relation}`,
    ].join("|");
  for (const t of seed) tuples.set(id(t), t);
  const calls: string[] = [];
  const fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${u.pathname}`);
    if (method === "GET") {
      const all = [...tuples.values()];
      const start = Number(u.searchParams.get("page_token") ?? "0");
      const page = all.slice(start, start + 2);
      const next = start + 2 < all.length ? String(start + 2) : "";
      return {
        status: 200,
        json: async () => ({ relation_tuples: page, next_page_token: next }),
        text: async () => "",
      };
    }
    if (method === "PUT") {
      const body = JSON.parse(init?.body ?? "{}") as KetoListedTuple;
      tuples.set(id(body), body);
      return { status: 201, json: async () => ({}), text: async () => "" };
    }
    const p = u.searchParams;
    const gone: KetoListedTuple = {
      namespace: p.get("namespace") ?? "",
      object: p.get("object") ?? "",
      relation: p.get("relation") ?? "",
      ...(p.get("subject_id") !== null
        ? { subject_id: p.get("subject_id") ?? "" }
        : {
            subject_set: {
              namespace: p.get("subject_set.namespace") ?? "",
              object: p.get("subject_set.object") ?? "",
              relation: p.get("subject_set.relation") ?? "",
            },
          }),
    };
    tuples.delete(id(gone));
    return { status: 204, json: async () => ({}), text: async () => "" };
  };
  const client = createKetoClient({ baseUrl: "https://ory.example", apiKey: "k", fetch });
  const objects = () => [...tuples.values()].map((t) => t.object).sort();
  const mutations = () => calls.filter((c) => !c.startsWith("GET"));
  return { client, fetch, objects, mutations, tuples };
}

function capture() {
  const lines: string[] = [];
  return { out: (line: string) => void lines.push(line), text: () => lines.join("\n") };
}

const twoBare = [direct("orders:read", "u1"), direct("orders:write", "u1")];
const seededOperator = [
  ...twoBare,
  direct(qualify(TENANT, "orders:read"), "u1"),
  direct(qualify(TENANT, "orders:write"), "u1"),
];

describe("backfill", () => {
  it("dry-run (no --apply) prints what it would do, writes nothing, exits 0", async () => {
    const keto = fakeKeto(twoBare);
    const o = capture();
    const code = await runBackfill({
      client: keto.client,
      tenantId: TENANT,
      apply: false,
      out: o.out,
    });
    expect(code).toBe(0);
    expect(keto.mutations()).toEqual([]);
    expect(o.text()).toContain("would PUT");
    expect(o.text()).toContain("DRY RUN");
  });

  it("--apply writes one qualified twin per bare tuple, for direct AND subject-set subjects", async () => {
    const keto = fakeKeto([direct("orders:read", "u1"), viaSet("orders:write", "u2")]);
    await runBackfill({ client: keto.client, tenantId: TENANT, apply: true, out: capture().out });
    expect(keto.objects()).toEqual(
      [
        "orders:read",
        "orders:write",
        qualify(TENANT, "orders:read"),
        qualify(TENANT, "orders:write"),
      ].sort(),
    );
    const twin = [...keto.tuples.values()].find(
      (t) => t.object === qualify(TENANT, "orders:write"),
    );
    expect(twin?.subject_set).toEqual({ namespace: "User", object: "u2", relation: "" });
    expect(twin?.subject_id).toBeUndefined();
  });

  it("is idempotent: a second --apply writes nothing", async () => {
    const keto = fakeKeto(twoBare);
    const args = { client: keto.client, tenantId: TENANT, apply: true, out: capture().out };
    await runBackfill(args);
    const after = keto.mutations().length;
    await runBackfill(args);
    expect(keto.mutations().length).toBe(after);
  });
});

describe("count gate", () => {
  it("passes (exit 0) when every bare tuple has its twin, and prints per-permission and per-subject", async () => {
    const o = capture();
    const code = await runCountGate({
      client: fakeKeto(seededOperator).client,
      tenantId: TENANT,
      out: o.out,
    });
    expect(code).toBe(0);
    expect(o.text()).toMatch(/per permission:[\s\S]*orders:read/);
    expect(o.text()).toMatch(/per subject:[\s\S]*u1/);
    expect(o.text()).toContain("PASS");
  });

  it("FAILS (non-zero) on a bare tuple with no twin, and names it", async () => {
    const o = capture();
    const code = await runCountGate({
      client: fakeKeto([...twoBare, direct(qualify(TENANT, "orders:read"), "u1")]).client,
      tenantId: TENANT,
      out: o.out,
    });
    expect(code).toBe(1);
    expect(o.text()).toMatch(/MISSING TWIN\s+orders:write/);
  });

  it("FAILS on a subject who has the permission bare but not qualified (per-subject, not just per-count)", async () => {
    // Same COUNTS on both sides (2 and 2) but the subjects differ: a totals-only gate would pass.
    const code = await runCountGate({
      client: fakeKeto([
        direct("orders:read", "u1"),
        direct("orders:read", "u2"),
        direct(qualify(TENANT, "orders:read"), "u1"),
        direct(qualify(TENANT, "orders:read"), "u3"),
      ]).client,
      tenantId: TENANT,
      out: capture().out,
    });
    expect(code).toBe(1);
  });

  it("FAILS on an orphan qualified tuple (exact match, not >=)", async () => {
    const o = capture();
    const code = await runCountGate({
      client: fakeKeto([...seededOperator, direct(qualify(TENANT, "orders:delete"), "u1")]).client,
      tenantId: TENANT,
      out: o.out,
    });
    expect(code).toBe(1);
    expect(o.text()).toContain("ORPHAN TWIN");
  });

  it("ignores another tenant's twins", async () => {
    const code = await runCountGate({
      client: fakeKeto([...seededOperator, direct(qualify("tenant-b", "orders:read"), "u9")])
        .client,
      tenantId: TENANT,
      out: capture().out,
    });
    expect(code).toBe(0);
  });

  it("FAILS on an empty namespace (wrong project must not read as a pass)", async () => {
    expect(
      await runCountGate({ client: fakeKeto([]).client, tenantId: TENANT, out: capture().out }),
    ).toBe(1);
  });

  it("reads every page (the fake lists two per page)", async () => {
    const many = Array.from({ length: 7 }, (_, i) => direct(`p:${i}`, "u1"));
    const gate = computeGate(await fakeKeto(many).client.list(), TENANT);
    expect(gate.bare).toHaveLength(7);
  });
});

describe("delete-bare", () => {
  it("REFUSES with --apply when a twin is missing, and deletes nothing", async () => {
    const keto = fakeKeto([...twoBare, direct(qualify(TENANT, "orders:read"), "u1")]);
    const o = capture();
    const code = await runDeleteBare({
      client: keto.client,
      tenantId: TENANT,
      apply: true,
      out: o.out,
    });
    expect(code).toBe(1);
    expect(keto.mutations()).toEqual([]);
    expect(o.text()).toContain("REFUSING");
    expect(keto.objects()).toContain("orders:write");
  });

  it("REFUSES even when never run before the backfill (the gate is its own, on a fresh listing)", async () => {
    const keto = fakeKeto(twoBare);
    expect(
      await runDeleteBare({
        client: keto.client,
        tenantId: TENANT,
        apply: true,
        out: capture().out,
      }),
    ).toBe(1);
    expect(keto.mutations()).toEqual([]);
  });

  it("dry-run with a passing gate lists the deletes, deletes nothing, exits 0", async () => {
    const keto = fakeKeto(seededOperator);
    const o = capture();
    const code = await runDeleteBare({
      client: keto.client,
      tenantId: TENANT,
      apply: false,
      out: o.out,
    });
    expect(code).toBe(0);
    expect(keto.mutations()).toEqual([]);
    expect(o.text()).toContain("would DELETE");
  });

  it("--apply deletes ONLY the bare tuples and leaves every qualified twin", async () => {
    const keto = fakeKeto([
      ...seededOperator,
      viaSet("orders:read", "u2"),
      viaSet(qualify(TENANT, "orders:read"), "u2"),
    ]);
    const code = await runDeleteBare({
      client: keto.client,
      tenantId: TENANT,
      apply: true,
      out: capture().out,
    });
    expect(code).toBe(0);
    expect(keto.objects().every((o) => o.startsWith("tenant/"))).toBe(true);
    expect(keto.objects()).toHaveLength(3);
  });

  it("is idempotent: a second run finds nothing to delete and exits 0", async () => {
    const keto = fakeKeto(seededOperator);
    const args = { client: keto.client, tenantId: TENANT, apply: true, out: capture().out };
    await runDeleteBare(args);
    const o = capture();
    expect(await runDeleteBare({ ...args, out: o.out })).toBe(0);
    expect(o.text()).toContain("Nothing to delete");
  });
});

describe("cli entry", () => {
  const env = { ORY_SDK_URL: "https://ory.example", ORY_API_KEY: "k" };

  it("requires --tenant (no default) and rejects unknown flags and slashes", () => {
    expect(() => parseArgs([])).toThrow(/--tenant/);
    expect(() => parseArgs(["--tenant", "a", "--yes"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--tenant", "a/b"])).toThrow(/invalid tenant id/);
    expect(parseArgs(["--tenant=a", "--apply"])).toEqual({ tenantId: "a", apply: true });
    expect(parseArgs(["--tenant", "a"]).apply).toBe(false);
  });

  it("defaults to dry-run: no --apply, no writes, exit 0", async () => {
    const keto = fakeKeto(twoBare);
    const code = await cliMain(runBackfill, {
      argv: ["--tenant", TENANT],
      env,
      fetch: keto.fetch,
      out: capture().out,
    });
    expect(code).toBe(0);
    expect(keto.mutations()).toEqual([]);
  });

  it("exits 2 (and writes nothing) when Ory answers the listing with an error", async () => {
    const calls: string[] = [];
    const code = await cliMain(runBackfill, {
      argv: ["--tenant", TENANT, "--apply"],
      env,
      fetch: async (url: string, init?: { method?: string }) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        return { status: 403, json: async () => ({}), text: async () => "forbidden" };
      },
      out: capture().out,
    });
    expect(code).toBe(2);
    expect(calls.every((c) => c.startsWith("GET"))).toBe(true);
  });

  it("exits 2 without credentials", async () => {
    expect(
      await cliMain(runCountGate, { argv: ["--tenant", TENANT], env: {}, out: capture().out }),
    ).toBe(2);
  });
});
