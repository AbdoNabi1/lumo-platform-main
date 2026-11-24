import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@platform/db";
import type { SegmentCondition } from "@platform/identity";
import {
  compileSegmentQuery,
  escapeLikePattern,
  PrismaCustomerSegmentQuery,
  UnavailableCustomerSegmentQuery,
  type SegmentMembersInput,
} from "./customer-segment-query";

const NOW = new Date("2026-07-05T10:30:00.000Z");
const AFTER = "0190a000-0000-7000-8000-000000000042";

function inputOf(
  conditions: readonly SegmentCondition[],
  extra: Partial<SegmentMembersInput> = {},
): SegmentMembersInput {
  return {
    tenantId: "tenant-a",
    conditions,
    currency: "EGP",
    timezone: "Africa/Cairo",
    now: NOW,
    first: 20,
    ...extra,
  };
}

/** The distinct `$n` placeholders of a statement. */
function placeholdersOf(sql: string): number[] {
  return [...new Set([...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))].sort(
    (a, b) => a - b,
  );
}

function expectPlaceholdersMatch(statement: { sql: string; params: readonly unknown[] }) {
  const numbers = placeholdersOf(statement.sql);
  expect(numbers).toEqual(Array.from({ length: statement.params.length }, (_, i) => i + 1));
}

/** The compiled WHERE clause of the count statement (everything after the `c.tenant_id` anchor). */
function conditionSql(conditions: readonly SegmentCondition[]) {
  const compiled = compileSegmentQuery(inputOf(conditions));
  const sql = compiled.count.sql;
  return {
    where: sql.slice(sql.indexOf('WHERE c."tenant_id" = $1 AND c."deleted_at" IS NULL AND ')),
    params: compiled.count.params.slice(4),
    compiled,
  };
}

const BASE_PREFIX = 'WHERE c."tenant_id" = $1 AND c."deleted_at" IS NULL AND ';

describe("compileSegmentQuery — fixed fragments per condition", () => {
  const cases: readonly {
    readonly name: string;
    readonly condition: SegmentCondition;
    readonly fragment: string;
    readonly params: readonly unknown[];
  }[] = [
    {
      name: "orders_count gte",
      condition: { field: "orders_count", op: "gte", value: 1 },
      fragment: 'COALESCE(oa."orders_count", 0) >= $5::int',
      params: [1],
    },
    {
      name: "orders_count eq 0 includes the zero-order customer through COALESCE",
      condition: { field: "orders_count", op: "eq", value: 0 },
      fragment: 'COALESCE(oa."orders_count", 0) = $5::int',
      params: [0],
    },
    {
      name: "orders_count neq",
      condition: { field: "orders_count", op: "neq", value: 3 },
      fragment: 'COALESCE(oa."orders_count", 0) <> $5::int',
      params: [3],
    },
    {
      name: "orders_count lt",
      condition: { field: "orders_count", op: "lt", value: 4 },
      fragment: 'COALESCE(oa."orders_count", 0) < $5::int',
      params: [4],
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name}`, () => {
      const { where, params } = conditionSql([testCase.condition]);
      expect(where).toBe(`${BASE_PREFIX}${testCase.fragment}`);
      expect(params).toEqual(testCase.params);
    });
  }

  it("amount_spent compares COALESCE(spent_minor, 0) as bigint with every operator", () => {
    const expected: Record<string, string> = {
      eq: "=",
      neq: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
    };
    for (const [op, sign] of Object.entries(expected)) {
      const { where, params } = conditionSql([
        { field: "amount_spent", op: op as "eq", valueMinor: 2900 },
      ]);
      expect(where).toBe(`${BASE_PREFIX}COALESCE(oa."spent_minor", 0) ${sign} $5::bigint`);
      expect(params).toEqual([2900]);
    }
  });

  it("last_order_date within_last_days: NOT NULL guard and a rolling UTC bound on timestamp", () => {
    const { where, params } = conditionSql([
      { field: "last_order_date", op: "within_last_days", days: 30 },
    ]);
    expect(where).toBe(
      `${BASE_PREFIX}(oa."last_order_at" IS NOT NULL AND oa."last_order_at" >= ($5::timestamp - make_interval(days => $6::int)))`,
    );
    expect(params).toEqual(["2026-07-05T10:30:00.000Z", 30]);
  });

  it("last_order_date not_within_last_days includes the never-ordered", () => {
    const { where, params } = conditionSql([
      { field: "last_order_date", op: "not_within_last_days", days: 90 },
    ]);
    expect(where).toBe(
      `${BASE_PREFIX}(oa."last_order_at" IS NULL OR oa."last_order_at" < ($5::timestamp - make_interval(days => $6::int)))`,
    );
    expect(params).toEqual(["2026-07-05T10:30:00.000Z", 90]);
  });

  it("last_order_date on_or_after / before: shop-zone midnight, NOT NULL guard", () => {
    const after = conditionSql([
      { field: "last_order_date", op: "on_or_after", date: "2026-03-01" },
    ]);
    expect(after.where).toBe(
      `${BASE_PREFIX}(oa."last_order_at" IS NOT NULL AND oa."last_order_at" >= (($5::date)::timestamp AT TIME ZONE $6::text) AT TIME ZONE 'UTC')`,
    );
    expect(after.params).toEqual(["2026-03-01", "Africa/Cairo"]);
    const before = conditionSql([{ field: "last_order_date", op: "before", date: "2026-03-01" }]);
    expect(before.where).toBe(
      `${BASE_PREFIX}(oa."last_order_at" IS NOT NULL AND oa."last_order_at" < (($5::date)::timestamp AT TIME ZONE $6::text) AT TIME ZONE 'UTC')`,
    );
  });

  it("last_order_date never = no counted order", () => {
    const { where, params } = conditionSql([{ field: "last_order_date", op: "never" }]);
    expect(where).toBe(`${BASE_PREFIX}oa."last_order_at" IS NULL`);
    expect(params).toEqual([]);
  });

  it("email / sms subscribed read the latest consent per scope, id as the tie-break", () => {
    const email = conditionSql([{ field: "email_subscribed", value: true }]);
    expect(email.where).toContain(
      `COALESCE((SELECT cre."granted" FROM "identity"."consent_records" cre WHERE cre."customer_id" = c."id" AND cre."tenant_id" = $1 AND cre."scope" = 'marketing' ORDER BY cre."occurred_at" DESC, cre."id" DESC LIMIT 1), FALSE) = $5::boolean`,
    );
    expect(email.params).toEqual([true]);
    const sms = conditionSql([{ field: "sms_subscribed", value: false }]);
    expect(sms.where).toContain(
      `crs."scope" = 'marketing_sms' ORDER BY crs."occurred_at" DESC, crs."id" DESC LIMIT 1), FALSE) = $5::boolean`,
    );
    expect(sms.params).toEqual([false]);
  });

  it("tags has_any / has_none / has_all match tag_key, normalized and de-duplicated", () => {
    const any = conditionSql([{ field: "tags", op: "has_any", values: ["VIP", " vip ", "Cairo"] }]);
    expect(any.where).toBe(
      `${BASE_PREFIX}EXISTS (SELECT 1 FROM "identity"."customer_tags" t WHERE t."customer_id" = c."id" AND t."tenant_id" = $1 AND t."tag_key" = ANY($5::text[]))`,
    );
    expect(any.params).toEqual([["vip", "cairo"]]);
    const none = conditionSql([{ field: "tags", op: "has_none", values: ["VIP"] }]);
    expect(none.where).toContain("NOT EXISTS (SELECT 1 FROM");
    expect(none.params).toEqual([["vip"]]);
    const all = conditionSql([{ field: "tags", op: "has_all", values: ["VIP", "Cairo"] }]);
    expect(all.where).toBe(
      `${BASE_PREFIX}(SELECT count(DISTINCT t."tag_key") FROM "identity"."customer_tags" t WHERE t."customer_id" = c."id" AND t."tenant_id" = $1 AND t."tag_key" = ANY($5::text[])) = cardinality($5::text[])`,
    );
    expect(all.params).toEqual([["vip", "cairo"]]);
  });

  it("country in / not_in: any address, trim + upper-case", () => {
    const included = conditionSql([{ field: "country", op: "in", values: [" eg ", "US"] }]);
    expect(included.where).toBe(
      `${BASE_PREFIX}EXISTS (SELECT 1 FROM "identity"."addresses" a WHERE a."customer_id" = c."id" AND a."tenant_id" = $1 AND upper(trim(a."country")) = ANY($5::text[]))`,
    );
    expect(included.params).toEqual([["EG", "US"]]);
    const excluded = conditionSql([{ field: "country", op: "not_in", values: ["EG"] }]);
    expect(excluded.where).toContain("NOT EXISTS (SELECT 1 FROM");
  });

  it("created_date within / not_within / on_or_after / before use customers.created_at", () => {
    const within = conditionSql([{ field: "created_date", op: "within_last_days", days: 7 }]);
    expect(within.where).toBe(
      `${BASE_PREFIX}c."created_at" >= ($5::timestamp - make_interval(days => $6::int))`,
    );
    const notWithin = conditionSql([
      { field: "created_date", op: "not_within_last_days", days: 7 },
    ]);
    expect(notWithin.where).toBe(
      `${BASE_PREFIX}c."created_at" < ($5::timestamp - make_interval(days => $6::int))`,
    );
    const onOrAfter = conditionSql([
      { field: "created_date", op: "on_or_after", date: "2026-01-01" },
    ]);
    expect(onOrAfter.where).toBe(
      `${BASE_PREFIX}c."created_at" >= (($5::date)::timestamp AT TIME ZONE $6::text) AT TIME ZONE 'UTC'`,
    );
    const before = conditionSql([{ field: "created_date", op: "before", date: "2026-01-01" }]);
    expect(before.where).toContain('c."created_at" < ((');
  });

  it("language eq / neq / unset: neq keeps unset customers (IS DISTINCT FROM)", () => {
    expect(conditionSql([{ field: "language", op: "eq", value: "ar" }]).where).toBe(
      `${BASE_PREFIX}c."language" = $5::text`,
    );
    const neq = conditionSql([{ field: "language", op: "neq", value: "en" }]);
    expect(neq.where).toBe(`${BASE_PREFIX}c."language" IS DISTINCT FROM $5::text`);
    expect(neq.params).toEqual(["en"]);
    const unset = conditionSql([{ field: "language", op: "unset" }]);
    expect(unset.where).toBe(`${BASE_PREFIX}c."language" IS NULL`);
    expect(unset.params).toEqual([]);
  });

  it("a day window and a calendar date share ONE now and ONE zone parameter", () => {
    const { compiled } = conditionSql([
      { field: "last_order_date", op: "within_last_days", days: 5 },
      { field: "created_date", op: "within_last_days", days: 6 },
      { field: "created_date", op: "on_or_after", date: "2026-01-01" },
      { field: "created_date", op: "before", date: "2026-02-01" },
    ]);
    expect(
      compiled.count.params.filter((value) => value === "2026-07-05T10:30:00.000Z"),
    ).toHaveLength(1);
    expect(compiled.count.params.filter((value) => value === "Africa/Cairo")).toHaveLength(1);
  });

  it("ANDs several conditions and adds the search after them", () => {
    const compiled = compileSegmentQuery(
      inputOf(
        [
          { field: "orders_count", op: "gte", value: 1 },
          { field: "language", op: "unset" },
        ],
        { search: "nour" },
      ),
    );
    expect(compiled.count.sql).toContain(
      `${BASE_PREFIX}COALESCE(oa."orders_count", 0) >= $5::int AND c."language" IS NULL AND (c."name" ILIKE $6::text OR c."email" ILIKE $6::text)`,
    );
    expect(compiled.count.params).toEqual([
      "tenant-a",
      "EGP",
      ["cancelled"],
      ["refunded", "refund_requested"],
      1,
      "%nour%",
    ]);
  });

  it("rejects out-of-range numbers and malformed dates instead of compiling them", () => {
    expect(() =>
      compileSegmentQuery(inputOf([{ field: "orders_count", op: "eq", value: 1.5 }])),
    ).toThrow(RangeError);
    expect(() =>
      compileSegmentQuery(inputOf([{ field: "amount_spent", op: "eq", valueMinor: -1 }])),
    ).toThrow(RangeError);
    expect(() =>
      compileSegmentQuery(inputOf([{ field: "last_order_date", op: "within_last_days", days: 0 }])),
    ).toThrow(RangeError);
    expect(() =>
      compileSegmentQuery(
        inputOf([{ field: "created_date", op: "before", date: "2026-1-1'); DROP" }]),
      ),
    ).toThrow(RangeError);
    expect(() => compileSegmentQuery(inputOf([], { first: 101 }))).toThrow(RangeError);
    expect(() => compileSegmentQuery(inputOf([], { first: 0 }))).toThrow(RangeError);
  });
});

describe("compileSegmentQuery — the order aggregate is the sales summary's rule", () => {
  const { list, count } = compileSegmentQuery(inputOf([]));

  for (const [name, statement] of [
    ["list", list],
    ["count", count],
  ] as const) {
    it(`${name}: shop currency, cancelled excluded, refunded spends 0, totals JSON else bigint item sum`, () => {
      const sql = statement.sql;
      expect(sql).toContain(`o."currency" = $2::text`);
      expect(sql).toContain(`xc."type" = ANY($3::text[])`);
      expect(sql).toContain(`xr."type" = ANY($4::text[])`);
      expect(sql).toContain(
        `THEN 0 ELSE COALESCE((o."totals"->>'totalMinor')::bigint, (SELECT COALESCE(SUM(i."unit_price_amount_minor"::bigint * i."quantity"), 0)`,
      );
      expect(sql).toContain(`max(o."created_at") AS "last_order_at"`);
      expect(sql).toContain(`LEFT JOIN "oa" oa ON oa."customer_ref" = c."id"::text`);
      expect(statement.params.slice(0, 4)).toEqual([
        "tenant-a",
        "EGP",
        ["cancelled"],
        ["refunded", "refund_requested"],
      ]);
    });
  }

  it("every output column coalesces a customer without orders to 0 / NULL", () => {
    expect(list.sql).toContain(`COALESCE(oa."orders_count", 0)::int AS "orders_count"`);
    expect(list.sql).toContain(`COALESCE(oa."spent_minor", 0)::bigint AS "spent_minor"`);
    expect(list.sql).toContain(`oa."last_order_at" AS "last_order_at"`);
  });

  it("the total is count(*)::bigint over the same filters, newest id first for the list", () => {
    expect(count.sql).toContain(`SELECT count(*)::bigint AS "total" FROM "identity"."customers" c`);
    expect(count.sql).not.toContain("ORDER BY");
    expect(count.sql).not.toContain("LIMIT");
    expect(list.sql).toContain(`ORDER BY c."id" DESC LIMIT $5::int`);
  });
});

describe("compileSegmentQuery — tenant isolation of every table reference", () => {
  // One filter that touches every field (every alias occurs, including the output-only ones).
  const everyField: readonly SegmentCondition[] = [
    { field: "orders_count", op: "gte", value: 1 },
    { field: "amount_spent", op: "gt", valueMinor: 100 },
    { field: "last_order_date", op: "within_last_days", days: 30 },
    { field: "last_order_date", op: "on_or_after", date: "2026-01-01" },
    { field: "email_subscribed", value: true },
    { field: "sms_subscribed", value: false },
    { field: "tags", op: "has_all", values: ["vip", "cairo"] },
    { field: "country", op: "not_in", values: ["EG"] },
    { field: "created_date", op: "before", date: "2026-02-01" },
    { field: "language", op: "neq", value: "en" },
  ];
  const ALIAS_TABLES: Record<string, string> = {
    c: "identity.customers",
    o: "orders.orders",
    i: "orders.order_items",
    xc: "orders.order_events",
    xr: "orders.order_events",
    cre: "identity.consent_records",
    crs: "identity.consent_records",
    t: "identity.customer_tags",
    a: "identity.addresses",
  };

  for (const [name, pick] of [
    ["list", (compiled: ReturnType<typeof compileSegmentQuery>) => compiled.list],
    ["count", (compiled: ReturnType<typeof compileSegmentQuery>) => compiled.count],
  ] as const) {
    it(`${name}: every table reference carries its own alias."tenant_id" = $1`, () => {
      const statement = pick(
        compileSegmentQuery(inputOf(everyField, { search: "x", after: AFTER })),
      );
      const references = [...statement.sql.matchAll(/(?:FROM|JOIN) "(\w+)"\."(\w+)" (\w+)/g)].map(
        (match) => ({ table: `${match[1]}.${match[2]}`, alias: match[3] ?? "" }),
      );
      expect(new Set(references.map((reference) => reference.alias))).toEqual(
        new Set(Object.keys(ALIAS_TABLES)),
      );
      for (const { alias, table } of references) {
        expect(table).toBe(ALIAS_TABLES[alias]);
        const predicate = new RegExp(`\\b${alias}\\."tenant_id" = \\$1\\b`, "g");
        const referencesOfAlias = references.filter((r) => r.alias === alias).length;
        expect((statement.sql.match(predicate) ?? []).length).toBeGreaterThanOrEqual(
          referencesOfAlias,
        );
      }
      // The aggregate and the outer customers read are pinned to the same bound tenant.
      expect(statement.params[0]).toBe("tenant-a");
      expect(statement.sql).not.toContain("tenant-a");
    });
  }

  it("a filter without conditions still tenant-scopes customers, orders, items and events", () => {
    for (const statement of [
      compileSegmentQuery(inputOf([])).list,
      compileSegmentQuery(inputOf([])).count,
    ]) {
      for (const alias of ["c", "o", "i", "xc", "xr"]) {
        expect(statement.sql).toContain(`${alias}."tenant_id" = $1`);
      }
    }
  });
});

describe("compileSegmentQuery — bind arrays, injection, cursor", () => {
  it("placeholders are exactly 1..params.length for list and count, with and without search/after", () => {
    const conditions: readonly SegmentCondition[] = [
      { field: "last_order_date", op: "within_last_days", days: 30 },
      { field: "tags", op: "has_any", values: ["a"] },
      { field: "created_date", op: "on_or_after", date: "2026-01-01" },
    ];
    for (const extra of [{}, { search: "nour" }, { after: AFTER }, { after: AFTER, search: "n" }]) {
      const compiled = compileSegmentQuery(inputOf(conditions, extra));
      expectPlaceholdersMatch(compiled.list);
      expectPlaceholdersMatch(compiled.count);
    }
  });

  it("count.params never carries the cursor or the limit; list.params = base + cursor + first+1", () => {
    const compiled = compileSegmentQuery(
      inputOf([{ field: "orders_count", op: "gte", value: 1 }], { after: AFTER, first: 20 }),
    );
    expect(compiled.count.params).toEqual([
      "tenant-a",
      "EGP",
      ["cancelled"],
      ["refunded", "refund_requested"],
      1,
    ]);
    expect(compiled.list.params).toEqual([...compiled.count.params, AFTER, 21]);
    expect(compiled.list.sql).toContain(`AND c."id" < $6::uuid ORDER BY c."id" DESC LIMIT $7::int`);
    expect(compiled.list.params).not.toBe(compiled.count.params);
  });

  it("an injection probe in a tag and in the search appears only in params", () => {
    const tag = "x'); DROP TABLE identity.customers; --";
    const search = "%_\\";
    const compiled = compileSegmentQuery(
      inputOf([{ field: "tags", op: "has_any", values: [tag] }], { search }),
    );
    for (const statement of [compiled.list, compiled.count]) {
      expect(statement.sql).not.toContain("DROP TABLE");
      expect(statement.sql).not.toContain(tag);
      expect(statement.sql).not.toContain(search);
      expect(statement.sql).not.toContain("%\\%\\_\\\\%");
    }
    expect(compiled.count.params).toContainEqual([tag.toLowerCase()]);
    expect(compiled.count.params).toContain("%\\%\\_\\\\%");
    expect(escapeLikePattern("%_\\")).toBe("\\%\\_\\\\");
  });

  it("injection probes in country, language-free values and the shop zone never reach the SQL text", () => {
    const probe = "EG'); DELETE FROM identity.customers; --";
    const zone = "UTC'; DROP TABLE orders.orders; --";
    const compiled = compileSegmentQuery(
      inputOf(
        [
          { field: "country", op: "in", values: [probe] },
          { field: "created_date", op: "on_or_after", date: "2026-01-01" },
        ],
        { timezone: zone, currency: "EGP'; --", tenantId: "t'; --" },
      ),
    );
    for (const statement of [compiled.list, compiled.count]) {
      expect(statement.sql).not.toMatch(/DELETE|DROP|--/);
    }
    expect(compiled.count.params).toContain(zone);
    expect(compiled.count.params).toContain("t'; --");
  });

  it("a non-UUID after yields a list that cannot match (FALSE), no cursor param, and an unaffected total", () => {
    const compiled = compileSegmentQuery(
      inputOf([{ field: "orders_count", op: "gte", value: 1 }], { after: "not-a-uuid'; --" }),
    );
    expect(compiled.list.sql).toContain(' AND FALSE ORDER BY c."id" DESC');
    expect(compiled.list.sql).not.toContain("not-a-uuid");
    expect(compiled.list.params).not.toContain("not-a-uuid'; --");
    expect(compiled.list.params).toEqual([...compiled.count.params, 21]);
    expect(compiled.count.sql).not.toContain("FALSE");
    expectPlaceholdersMatch(compiled.list);
  });

  it("without an after there is no cursor predicate", () => {
    const compiled = compileSegmentQuery(inputOf([]));
    expect(compiled.list.sql).not.toContain('c."id" <');
    expect(compiled.list.sql).not.toContain("AND FALSE");
  });

  it("an uppercase UUID after is accepted as a cursor", () => {
    const compiled = compileSegmentQuery(inputOf([], { after: AFTER.toUpperCase() }));
    expect(compiled.list.sql).toContain('c."id" < $5::uuid');
  });
});

/** ---- adapter with a recording TransactionClient ---------------------------------------- */

interface Recorded {
  readonly kind: "set_config" | "query";
  readonly sql: string;
  readonly params: readonly unknown[];
}

function recordingDatabase(answers: readonly (readonly Record<string, unknown>[])[]) {
  const events: Recorded[] = [];
  let next = 0;
  const client = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      events.push({ kind: "set_config", sql: strings.join("?"), params: values });
      return 0;
    },
    $queryRawUnsafe: async (sql: string, ...values: unknown[]) => {
      events.push({ kind: "query", sql, params: values });
      const answer = answers[next] ?? [];
      next += 1;
      return answer;
    },
  };
  const database = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  } as unknown as Database;
  return { database, events };
}

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Name ${id}`,
  email: `${id}@example.com`,
  is_guest: false,
  orders_count: 2,
  spent_minor: 5000n,
  last_order_at: new Date("2026-06-01T12:00:00.000Z"),
  email_subscribed: true,
  sms_subscribed: false,
  ...extra,
});

describe("PrismaCustomerSegmentQuery (recording TransactionClient)", () => {
  let base: SegmentMembersInput;
  beforeEach(() => {
    base = inputOf([{ field: "orders_count", op: "gte", value: 1 }], { first: 2 });
  });

  function queriesOf(events: readonly Recorded[]) {
    return events.filter((event) => event.kind === "query");
  }

  it("sets the tenant first, then runs list and count each with its own bind array", async () => {
    const { database, events } = recordingDatabase([
      [row("id-3"), row("id-2"), row("id-1")],
      [{ total: 5n }],
    ]);
    const page = await new PrismaCustomerSegmentQuery({ prisma: database }).members(base);

    expect(events.map((event) => event.kind)).toEqual(["set_config", "query", "query"]);
    expect(events[0]?.sql).toContain("set_config('app.tenant_id'");
    expect(events[0]?.params).toEqual(["tenant-a"]);
    const [list, count] = queriesOf(events);
    expect(list?.sql).toContain('ORDER BY c."id" DESC LIMIT $6::int');
    expect(list?.params).toEqual([
      "tenant-a",
      "EGP",
      ["cancelled"],
      ["refunded", "refund_requested"],
      1,
      3,
    ]);
    expect(count?.params).toEqual([
      "tenant-a",
      "EGP",
      ["cancelled"],
      ["refunded", "refund_requested"],
      1,
    ]);
    expect(placeholdersOf(list?.sql ?? "")).toHaveLength(list?.params.length ?? -1);
    expect(placeholdersOf(count?.sql ?? "")).toHaveLength(count?.params.length ?? -1);
    expect(count?.params).not.toContain(3);
    expect(page).toEqual({
      items: [
        {
          id: "id-3",
          name: "Name id-3",
          email: "id-3@example.com",
          isGuest: false,
          ordersCount: 2,
          amountSpentMinor: 5000,
          lastOrderAt: "2026-06-01T12:00:00.000Z",
          emailSubscribed: true,
          smsSubscribed: false,
        },
        expect.objectContaining({ id: "id-2" }),
      ],
      pageInfo: { hasNextPage: true, endCursor: "id-2" },
      total: 5,
      currency: "EGP",
    });
  });

  it("page 2 (with after) puts the cursor in the list only and keeps the same total", async () => {
    const cursor = AFTER;
    const first = recordingDatabase([[row("id-3"), row("id-2"), row("id-1")], [{ total: 3n }]]);
    const page1 = await new PrismaCustomerSegmentQuery({ prisma: first.database }).members(base);
    const second = recordingDatabase([[row("id-1")], [{ total: 3n }]]);
    const page2 = await new PrismaCustomerSegmentQuery({ prisma: second.database }).members({
      ...base,
      after: cursor,
    });
    const [list, count] = queriesOf(second.events);
    expect(list?.sql).toContain('AND c."id" < $6::uuid ORDER BY c."id" DESC LIMIT $7::int');
    expect(list?.params.slice(-2)).toEqual([cursor, 3]);
    expect(count?.params).not.toContain(cursor);
    expect(count?.params).toHaveLength(5);
    expect(count?.sql).not.toContain("LIMIT");
    expect(placeholdersOf(list?.sql ?? "")).toHaveLength(list?.params.length ?? -1);
    expect(placeholdersOf(count?.sql ?? "")).toHaveLength(count?.params.length ?? -1);
    expect(page1.total).toBe(3);
    expect(page2.total).toBe(page1.total);
    expect(page2.pageInfo).toEqual({ hasNextPage: false, endCursor: "id-1" });
  });

  it("a search is escaped and bound in BOTH statements", async () => {
    const { database, events } = recordingDatabase([[row("id-1")], [{ total: 1n }]]);
    await new PrismaCustomerSegmentQuery({ prisma: database }).members({
      ...base,
      search: " 50%_off\\ ",
    });
    const [list, count] = queriesOf(events);
    for (const query of [list, count]) {
      expect(query?.params).toContain("%50\\%\\_off\\\\%");
      expect(query?.sql).not.toContain("50%");
      expect(placeholdersOf(query?.sql ?? "")).toHaveLength(query?.params.length ?? -1);
    }
  });

  it("an empty result is an empty page with total 0 and no cursor", async () => {
    const { database } = recordingDatabase([[], [{ total: 0n }]]);
    const page = await new PrismaCustomerSegmentQuery({ prisma: database }).members(base);
    expect(page).toEqual({
      items: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      total: 0,
      currency: "EGP",
    });
  });

  it("maps bigint counts to numbers and a zone-less timestamp string as UTC; null stays null", async () => {
    const { database } = recordingDatabase([
      [
        row("id-2", { spent_minor: 2_000_000_000n * 3n, last_order_at: "2026-06-01 12:00:00" }),
        row("id-1", { orders_count: 0n, spent_minor: 0n, last_order_at: null }),
      ],
      [{ total: 2n }],
    ]);
    const page = await new PrismaCustomerSegmentQuery({ prisma: database }).members(base);
    expect(page.items[0]).toMatchObject({
      amountSpentMinor: 6_000_000_000,
      lastOrderAt: "2026-06-01T12:00:00.000Z",
    });
    expect(page.items[1]).toMatchObject({ ordersCount: 0, amountSpentMinor: 0, lastOrderAt: null });
  });

  it("a non-UUID after answers an empty page through the compiled FALSE, still counting the total", async () => {
    const { database, events } = recordingDatabase([[], [{ total: 4n }]]);
    const page = await new PrismaCustomerSegmentQuery({ prisma: database }).members({
      ...base,
      after: "garbage",
    });
    expect(queriesOf(events)[0]?.sql).toContain("AND FALSE");
    expect(page.items).toEqual([]);
    expect(page.total).toBe(4);
  });

  it("passes the day window as an ISO UTC string for a timestamp parameter", async () => {
    const { database, events } = recordingDatabase([[], [{ total: 0n }]]);
    await new PrismaCustomerSegmentQuery({ prisma: database }).members({
      ...base,
      conditions: [{ field: "last_order_date", op: "within_last_days", days: 30 }],
    });
    const [list] = queriesOf(events);
    expect(list?.params).toContain("2026-07-05T10:30:00.000Z");
    expect(list?.sql).toContain("$5::timestamp - make_interval(days => $6::int)");
  });
});

describe("UnavailableCustomerSegmentQuery", () => {
  it("rejects with an UNAVAILABLE AppError", async () => {
    await expect(new UnavailableCustomerSegmentQuery().members()).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "Segments need the database",
    });
  });
});
