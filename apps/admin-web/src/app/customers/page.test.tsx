import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  cookieLocale: { value: undefined as string | undefined },
}));

vi.mock("@/lib/auth/session", () => ({
  readSession: mocks.readSession,
  highestRole: (roles: readonly string[]) =>
    (["admin", "operator", "viewer"] as const).find((role) => roles.includes(role)),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/api/customers", () => ({ fetchCustomersPage: vi.fn() }));
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
