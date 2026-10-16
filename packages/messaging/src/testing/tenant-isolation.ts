/**
 * T10.5 (WP-10): the shared adversarial row-isolation harness. A context opts in with ONE call and a
 * small fixture — the same shape `assertWriteTimeTenant` established:
 *
 *   describe("finance tenant isolation", () => {
 *     for (const c of tenantRowIsolationCases(fixture)) it(c.name, c.run);
 *   });
 *
 * What it proves, and at which layer: it drives the adapter the fixture hands it, with ONE instance
 * serving every tenant (the production shape since ADR-0014), and asserts tenant A can neither
 * read, write, delete nor COUNT tenant B's rows. It exercises the *application layer's* tenant
 * scoping — the `tenantId` the adapter puts in its filter. It deliberately cannot pass because of
 * Postgres RLS: an in-memory adapter has none, and a Prisma adapter is driven through a fake whose
 * `where` is applied literally (RLS is inert under the `postgres` role until ADR-0014 Phase 2, so
 * a test that only passed under RLS would prove nothing about what ships).
 *
 * The fixture uses the SAME row key under both tenants on purpose. Distinct keys would let a
 * tenant-blind lookup pass by accident; identical keys make a missing tenant filter observable.
 */

/** The narrow surface a context adapts its repository/store to. */
export interface TenantRowStore {
  /** Insert (or upsert) the row `key` for `tenantId`, carrying `marker` so its owner is identifiable. */
  insert(tenantId: string, key: string, marker: string): Promise<void>;
  /** The marker `tenantId` sees for `key`, or `null` when it sees no such row. */
  find(tenantId: string, key: string): Promise<string | null>;
  /** The markers `tenantId` sees when it lists the collection. */
  list(tenantId: string): Promise<readonly string[]>;
  /**
   * A dedicated count / pagination-total surface, when the context has one. A count that ignores
   * the tenant filter leaks row EXISTENCE without leaking a row, so it is asserted separately from
   * `list`. Omit only when the context genuinely has no such surface — the case then counts `list`.
   */
  count?(tenantId: string): Promise<number>;
  /** `tenantId` attempts to overwrite `key`. May throw (not found / conflict) or no-op; must not touch another tenant's row. */
  update(tenantId: string, key: string, marker: string): Promise<void>;
  /** `tenantId` attempts to delete `key`. Omit when the context has no delete. */
  remove?(tenantId: string, key: string): Promise<void>;
}

export interface TenantRowIsolationFixture {
  /** Context name, e.g. `finance/account`. */
  readonly context: string;
  /** Which layer the store exercises — recorded in every case name so the report can say it. */
  readonly layer: string;
  /** A FRESH store per case; one instance must serve every tenant. */
  readonly make: () => TenantRowStore | Promise<TenantRowStore>;
}

export interface TenantIsolationCase {
  readonly name: string;
  readonly run: () => Promise<void>;
}

const A = "tenant-a";
const B = "tenant-b";
const NOBODY = "tenant-nobody";
const KEY = "shared-key";

function fail(fixture: TenantRowIsolationFixture, message: string): never {
  throw new Error(`${fixture.context} [${fixture.layer}]: ${message}`);
}

async function attempt(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // A refused write (not found / conflict) is a correct outcome; only a leak is a failure, and
    // that is asserted on the victim's data afterwards, not on whether the attacker got an error.
  }
}

export function tenantRowIsolationCases(
  fixture: TenantRowIsolationFixture,
): readonly TenantIsolationCase[] {
  const label = `${fixture.context} [${fixture.layer}]`;
  return [
    {
      name: `${label}: A cannot read B's row — by key or by list`,
      run: async () => {
        const store = await fixture.make();
        await store.insert(B, KEY, "b-row");
        if ((await store.find(A, KEY)) !== null) fail(fixture, "A read B's row by key");
        const seen = await store.list(A);
        if (seen.length !== 0)
          fail(fixture, `A listed ${seen.length} row(s) it does not own: ${seen.join(",")}`);
        if ((await store.find(NOBODY, KEY)) !== null)
          fail(fixture, "a tenant with no rows read another tenant's row");
        if ((await store.find(B, KEY)) !== "b-row") fail(fixture, "the owner lost its own row");
      },
    },
    {
      name: `${label}: the same key under two tenants is two rows — neither overwrites the other`,
      run: async () => {
        const store = await fixture.make();
        await store.insert(A, KEY, "a-row");
        await store.insert(B, KEY, "b-row");
        if ((await store.find(A, KEY)) !== "a-row") fail(fixture, "B's insert overwrote A's row");
        if ((await store.find(B, KEY)) !== "b-row") fail(fixture, "B's own row is not B's");
        const listedA = await store.list(A);
        if (listedA.length !== 1 || listedA[0] !== "a-row")
          fail(fixture, `A's list is not exactly its own row: [${listedA.join(",")}]`);
      },
    },
    {
      name: `${label}: A cannot write B's row`,
      run: async () => {
        const store = await fixture.make();
        await store.insert(B, KEY, "b-row");
        await attempt(() => store.update(A, KEY, "hijacked-by-a"));
        const after = await store.find(B, KEY);
        if (after !== "b-row")
          fail(fixture, `A's update reached B's row (B now sees ${JSON.stringify(after)})`);
      },
    },
    {
      name: `${label}: A cannot delete B's row`,
      run: async () => {
        const store = await fixture.make();
        const remove = store.remove?.bind(store);
        if (remove === undefined) return; // context has no delete — nothing to attack
        await store.insert(B, KEY, "b-row");
        await attempt(() => remove(A, KEY));
        if ((await store.find(B, KEY)) !== "b-row") fail(fixture, "A's delete removed B's row");
      },
    },
    {
      name: `${label}: A cannot count B's rows`,
      run: async () => {
        const store = await fixture.make();
        await store.insert(A, "a-1", "a");
        await store.insert(A, "a-2", "a");
        await store.insert(A, "a-3", "a");
        await store.insert(B, "b-1", "b");
        const counted = async (t: string): Promise<number> =>
          store.count !== undefined ? store.count(t) : (await store.list(t)).length;
        const countB = await counted(B);
        if (countB !== 1)
          fail(fixture, `B counts ${countB} rows, owns 1 — a count that ignores the tenant`);
        const countA = await counted(A);
        if (countA !== 3) fail(fixture, `A counts ${countA} rows, owns 3`);
        const countNobody = await counted(NOBODY);
        if (countNobody !== 0) fail(fixture, `a tenant with no rows counts ${countNobody}`);
      },
    },
  ];
}
