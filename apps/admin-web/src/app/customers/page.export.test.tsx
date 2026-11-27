import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor, within } from "@testing-library/react";

// The page's real header, fed by the page's real props and the real URL: the export has no
// segment parameter yet, so it must not be offered while a segment is selected (I1).
const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  fetchCustomersPage: vi.fn(),
  fetchCustomerSegments: vi.fn(),
  search: "",
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
vi.mock("@/components/customers/customers-toolbar", () => ({ CustomersToolbar: () => null }));
vi.mock("@/components/customers/customers-table", () => ({ CustomersTable: () => null }));
vi.mock("@/components/customers/customers-pagination", () => ({ CustomersPagination: () => null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { default: CustomersPage } = await import("./page");
const { CustomersHeader } = await import("@/components/customers/customers-header");

function findHeader(node: ReactNode): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findHeader(child);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<{ children?: ReactNode }>;
  return element.type === CustomersHeader ? element : findHeader(element.props.children);
}

/** Renders the page's real <CustomersHeader> for these URL params. */
async function showHeader(params: Record<string, string>, role: string = "operator") {
  mocks.readSession.mockResolvedValue({ roles: [role] });
  mocks.search = new URLSearchParams(params).toString();
  const tree = await CustomersPage({ searchParams: Promise.resolve(params) });
  const header = findHeader(tree);
  expect(header).not.toBeNull();
  return render(cloneElement(header as ReactElement));
}

const body = () => within(document.body);

beforeEach(() => {
  expect.hasAssertions();
  mocks.readSession.mockReset();
  mocks.fetchCustomersPage.mockReset();
  mocks.fetchCustomerSegments.mockReset();
  mocks.fetchCustomerSegments.mockResolvedValue({ outcome: "ok", data: { items: [] } });
});

describe("Customers export under a segment filter (I1)", () => {
  it.each([["operator"], ["admin"]])(
    "%s sees Export without a segment, and it is gone once a segment is selected",
    async (role) => {
      const first = await showHeader({}, role);
      await waitFor(() => expect(body().getByRole("button", { name: "Export" })).toBeEnabled());
      first.unmount();

      await showHeader({ segment: "default:not_purchased" }, role);
      await waitFor(() => expect(body().queryByRole("button", { name: "Export" })).toBeNull());
      expect(body().queryByRole("dialog")).toBeNull();
      expect(body().queryByText("Export customers")).toBeNull();
      // Add customer stays available.
      expect(body().getByRole("link", { name: "Add customer" })).toHaveAttribute(
        "href",
        "/customers/new",
      );
    },
  );

  it("a segment together with a search still offers no export", async () => {
    await showHeader({ segment: "7c1f0f6e-0000-4000-8000-000000000001", q: "amira" });

    await waitFor(() => expect(body().queryByRole("button", { name: "Export" })).toBeNull());
    expect(body().queryByRole("dialog")).toBeNull();
    expect(body().getByRole("link", { name: "Add customer" })).toBeInTheDocument();
  });

  it("a search alone keeps the export", async () => {
    await showHeader({ q: "amira" });

    await waitFor(() => expect(body().getByRole("button", { name: "Export" })).toBeEnabled());
  });

  it("an empty ?segment= is no segment", async () => {
    await showHeader({ segment: "" });

    await waitFor(() => expect(body().getByRole("button", { name: "Export" })).toBeEnabled());
  });

  it("a viewer sees neither Export nor Add customer, with or without a segment", async () => {
    for (const params of [{}, { segment: "default:not_purchased" }] as Record<string, string>[]) {
      const view = await showHeader(params, "viewer");
      await waitFor(() => expect(body().getByRole("heading", { level: 1 })).toBeInTheDocument());
      expect(body().queryByRole("button")).toBeNull();
      expect(body().queryByRole("link")).toBeNull();
      view.unmount();
    }
  });
});
