import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  cookieLocale: { value: undefined as string | undefined },
  fetchCustomersPage: vi.fn(),
  fetchCustomerSegments: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  readSession: mocks.readSession,
  highestRole: (roles: readonly string[]) =>
    (["admin", "operator", "viewer"] as const).find((role) => roles.includes(role)),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/api/customers", () => ({ fetchCustomersPage: mocks.fetchCustomersPage }));
vi.mock("@/lib/api/customer-segments", () => ({
  fetchCustomerSegments: mocks.fetchCustomerSegments,
}));
vi.mock("@/components/app-shell", () => ({ AppShell: () => null }));
vi.mock("@/components/customers/customers-header", () => ({ CustomersHeader: () => null }));
vi.mock("@/components/customers/customers-toolbar", () => ({ CustomersToolbar: () => null }));
vi.mock("@/components/customers/customers-table", () => ({ CustomersTable: () => null }));
vi.mock("@/components/customers/customers-pagination", () => ({ CustomersPagination: () => null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () =>
      mocks.cookieLocale.value === undefined ? undefined : { value: mocks.cookieLocale.value },
  }),
}));

const { default: CustomersPage } = await import("./page");
const { CustomersHeader } = await import("@/components/customers/customers-header");
const { CustomersToolbar } = await import("@/components/customers/customers-toolbar");
const { CustomersPagination } = await import("@/components/customers/customers-pagination");
const { Suspense } = await import("react");

/** Every element in the (unrendered) tree matching `match`, searching children depth-first. */
function findAll(node: ReactNode, match: (element: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, match));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [...(match(element) ? [element] : []), ...findAll(element.props.children, match)];
}

async function headerProps(params: Record<string, string> = {}) {
  const tree = await CustomersPage({ searchParams: Promise.resolve(params) });
  const [header] = findAll(tree, (element) => element.type === CustomersHeader);
  return { tree, props: header?.props as { canEdit: boolean; canExport: boolean; t: unknown } };
}

beforeEach(() => {
  expect.hasAssertions();
  mocks.readSession.mockReset();
  mocks.cookieLocale.value = undefined;
  mocks.fetchCustomersPage.mockReset();
  mocks.fetchCustomerSegments.mockReset();
  mocks.fetchCustomerSegments.mockResolvedValue({ outcome: "ok", data: { items: [] } });
});

describe("CustomersPage", () => {
  it.each(["operator", "admin"])("%s gets canEdit and canExport", async (role) => {
    mocks.readSession.mockResolvedValue({ roles: [role] });

    const { props } = await headerProps();

    expect(props).toMatchObject({ canEdit: true, canExport: true });
  });

  it("a viewer gets neither", async () => {
    mocks.readSession.mockResolvedValue({ roles: ["viewer"] });

    const { props } = await headerProps();

    expect(props).toMatchObject({ canEdit: false, canExport: false });
  });

  it("no session, an empty role list and an unknown role get neither", async () => {
    for (const session of [null, { roles: [] }, { roles: ["guest"] }]) {
      mocks.readSession.mockResolvedValue(session);

      const { props } = await headerProps();

      expect(props).toMatchObject({ canEdit: false, canExport: false });
    }
  });

  it("the highest of several roles decides", async () => {
    mocks.readSession.mockResolvedValue({ roles: ["viewer", "operator"] });

    expect((await headerProps()).props).toMatchObject({ canEdit: true, canExport: true });
  });

  it.each([
    ["too_many", en.customersPage.exportError.too_many],
    ["failed", en.customersPage.exportError.failed],
  ] as const)("shows the %s export error as an alert", async (code, message) => {
    mocks.readSession.mockResolvedValue({ roles: ["operator"] });

    const { tree } = await headerProps({ exportError: code });

    const alerts = findAll(
      tree,
      (element) => (element.props as { role?: string }).role === "alert",
    );
    expect(alerts.map((alert) => (alert.props as { children: string }).children)).toEqual([
      message,
    ]);
  });

  it("ignores an unknown exportError value", async () => {
    mocks.readSession.mockResolvedValue({ roles: ["operator"] });

    const { tree } = await headerProps({ exportError: "<script>" });

    expect(
      findAll(tree, (element) => (element.props as { role?: string }).role === "alert"),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Shopify parity Wave 1c — the segment filter on the list.
// ---------------------------------------------------------------------------------------------

type ResultsProps = {
  first: number;
  after?: string;
  stack?: string;
  search?: string;
  segment?: string;
};

/** The unrendered `CustomersResults` element and the tree it renders (it is an async server component). */
async function results(params: Record<string, string> = {}) {
  mocks.readSession.mockResolvedValue({ roles: ["operator"] });
  const tree = await CustomersPage({ searchParams: Promise.resolve(params) });
  const [suspense] = findAll(tree, (element) => element.type === Suspense);
  const child = (suspense?.props as { children: ReactElement }).children;
  const rendered = await (child.type as (props: ResultsProps) => Promise<ReactNode>)(
    child.props as ResultsProps,
  );
  return { tree, suspense, child, rendered };
}

const messageOf = (node: ReactNode): string | undefined =>
  (
    findAll(
      node,
      (element) => typeof (element.props as { message?: string }).message === "string",
    )[0]?.props as { message?: string } | undefined
  )?.message;

const item = { id: "c-1", name: "Nour", email: "n@example.com" };
const okPage = (items: unknown[] = [item]) => ({
  outcome: "ok",
  items,
  pageInfo: { hasNextPage: false, endCursor: null },
});

describe("CustomersPage segment filter (Wave 1c)", () => {
  it("threads ?segment= to the client as segmentId, with q and the cursor", async () => {
    mocks.fetchCustomersPage.mockResolvedValue(okPage());

    await results({ q: "nour", after: "c-0", segment: "default:not_purchased" });

    expect(mocks.fetchCustomersPage).toHaveBeenCalledWith({
      first: 20,
      after: "c-0",
      search: "nour",
      segmentId: "default:not_purchased",
    });
  });

  it("sends no segmentId without ?segment=", async () => {
    mocks.fetchCustomersPage.mockResolvedValue(okPage());

    await results({ q: "nour" });

    expect(mocks.fetchCustomersPage.mock.calls[0]?.[0]).not.toHaveProperty("segmentId");
  });

  it("keys the Suspense on q, after, stack AND segment, so each change shows a fresh fallback", async () => {
    mocks.fetchCustomersPage.mockResolvedValue(okPage());

    const { suspense } = await results({
      q: "nour",
      after: "c-2",
      stack: "c-1",
      segment: "s-1",
    });

    expect(suspense?.key).toBe("nour:c-2:c-1:s-1");
  });

  it("hands the toolbar the segments: defaults in their label, custom by name", async () => {
    mocks.fetchCustomerSegments.mockResolvedValue({
      outcome: "ok",
      data: {
        items: [
          { id: "default:not_purchased", kind: "default", key: "notPurchased", name: null },
          { id: "s-1", kind: "custom", key: null, name: "VIP" },
        ],
      },
    });
    mocks.fetchCustomersPage.mockResolvedValue(okPage());

    const { tree } = await results();

    const [toolbar] = findAll(tree, (element) => element.type === CustomersToolbar);
    expect((toolbar?.props as { segments: unknown }).segments).toEqual([
      { id: "default:not_purchased", label: en.segments.defaults.notPurchased },
      { id: "s-1", label: "VIP" },
    ]);
  });

  it("a segment list that fails to load leaves the toolbar without the select (search still works)", async () => {
    mocks.fetchCustomerSegments.mockResolvedValue({ outcome: "error", message: "x", status: 503 });
    mocks.fetchCustomersPage.mockResolvedValue(okPage());

    const { tree } = await results();

    const [toolbar] = findAll(tree, (element) => element.type === CustomersToolbar);
    expect((toolbar?.props as { segments: unknown }).segments).toBeNull();
  });

  it("shows the store-empty message only on page 1 with no search and no segment", async () => {
    mocks.fetchCustomersPage.mockResolvedValue(okPage([]));

    const { rendered } = await results();

    expect(messageOf(rendered)).toBe(en.customersPage.empty);
    expect(findAll(rendered, (element) => element.type === CustomersPagination)).toHaveLength(0);
  });

  it.each([
    ["a search", { q: "zzz" }],
    ["a segment", { segment: "default:not_purchased" }],
    ["both", { q: "zzz", segment: "s-1" }],
  ])("an empty page with %s says no customers match", async (_label, params) => {
    mocks.fetchCustomersPage.mockResolvedValue(okPage([]));

    const { rendered } = await results(params);

    expect(messageOf(rendered)).toBe(en.customersPage.emptyFiltered);
    expect(en.customersPage.emptyFiltered).toMatch(/^No customers match/);
  });

  it.each([
    ["after", { after: "c-9" }],
    ["stack", { stack: "c-1" }],
  ])(
    "an empty later page (%s) keeps Previous and is not the store-empty message",
    async (_label, params) => {
      mocks.fetchCustomersPage.mockResolvedValue(okPage([]));

      const { rendered } = await results(params);

      expect(messageOf(rendered)).toBe(en.customersPage.emptyPage);
      const [pagination] = findAll(rendered, (element) => element.type === CustomersPagination);
      expect(pagination?.props).toMatchObject({ hasNextPage: false, endCursor: null });
    },
  );

  it("an empty later filtered page keeps Previous AND says nothing matches", async () => {
    mocks.fetchCustomersPage.mockResolvedValue(okPage([]));

    const { rendered } = await results({ segment: "s-1", after: "c-9" });

    expect(messageOf(rendered)).toBe(en.customersPage.emptyFiltered);
    expect(findAll(rendered, (element) => element.type === CustomersPagination)).toHaveLength(1);
  });

  it("an unknown or deleted segment says it no longer exists, with a link that clears segment but keeps q", async () => {
    mocks.fetchCustomersPage.mockResolvedValue({ outcome: "not_found" });

    const withSearch = await results({ segment: "gone", q: "nour", after: "c-1" });
    const [link] = findAll(
      withSearch.rendered,
      (element) => typeof (element.props as { href?: string }).href === "string",
    );
    expect(messageOf(withSearch.rendered)).toBe(en.customersPage.segmentMissing);
    expect((link?.props as { href: string }).href).toBe("/customers?q=nour");

    const bare = await results({ segment: "gone" });
    const [bareLink] = findAll(
      bare.rendered,
      (element) => typeof (element.props as { href?: string }).href === "string",
    );
    expect((bareLink?.props as { href: string }).href).toBe("/customers");
  });

  it("503 UNAVAILABLE on a segment shows 'Segments need the store database'; other failures the list error", async () => {
    mocks.fetchCustomersPage.mockResolvedValueOnce({ outcome: "unavailable" });
    expect(messageOf((await results({ segment: "s-1" })).rendered)).toBe(en.segments.unavailable);

    mocks.fetchCustomersPage.mockResolvedValueOnce({ outcome: "error", message: "boom" });
    expect(messageOf((await results({ segment: "s-1" })).rendered)).toBe(en.customersPage.error);
  });
});
