import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  cookieLocale: { value: undefined as string | undefined },
}));
const api = vi.hoisted(() => ({
  fetchCustomerSegments: vi.fn(),
  fetchCustomerSegment: vi.fn(),
  fetchSegmentStoreCurrency: vi.fn(),
  fetchSegmentMembers: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  readSession: mocks.readSession,
  highestRole: (roles: readonly string[]) =>
    (["admin", "operator", "viewer"] as const).find((role) => roles.includes(role)),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/api/customer-segments", () => api);
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () =>
      mocks.cookieLocale.value === undefined ? undefined : { value: mocks.cookieLocale.value },
  }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ activeNavId, children }: { activeNavId: string; children: ReactNode }) => (
    <div data-testid="shell" data-active={activeNavId}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/customers/segments/segment-editor", () => ({
  SegmentEditor: (props: {
    mode: string;
    currency: string;
    version: number | null;
    segmentId: string;
    initialName: string;
    readOnly: boolean;
  }) => (
    <div
      data-testid="editor"
      data-mode={props.mode}
      data-currency={props.currency}
      data-version={String(props.version)}
      data-id={props.segmentId}
      data-name={props.initialName}
      data-readonly={String(props.readOnly)}
    />
  ),
}));
vi.mock("@/components/customers/segments/segment-delete-dialog", () => ({
  SegmentDeleteDialog: (props: { segmentId: string; version: number; name: string }) => (
    <button
      type="button"
      data-testid="delete"
      data-id={props.segmentId}
      data-version={props.version}
    >
      Delete segment {props.name}
    </button>
  ),
}));
vi.mock("@/components/customers/segments/segment-members-search", () => ({
  SegmentMembersSearch: () => <div data-testid="members-search" />,
}));
vi.mock("@/components/customers/segments/segment-members", () => ({
  SegmentMembers: (props: {
    segmentId: string;
    search?: string;
    after?: string;
    stack?: string;
  }) => (
    <div
      data-testid="members"
      data-id={props.segmentId}
      data-search={props.search ?? ""}
      data-after={props.after ?? ""}
      data-stack={props.stack ?? ""}
    />
  ),
}));

const { default: SegmentDetailPage } = await import("./page");

const custom = {
  id: "7c1f0f6e-0000-4000-8000-000000000001",
  kind: "custom",
  key: null,
  name: "عملاء VIP",
  version: 3,
  conditions: [{ field: "orders_count", op: "gte", value: 3 }],
  updatedAt: "2026-11-20T10:00:00.000Z",
};
const notPurchased = {
  id: "default:not_purchased",
  kind: "default",
  key: "notPurchased",
  name: null,
  version: null,
  conditions: [{ field: "orders_count", op: "eq", value: 0 }],
  updatedAt: null,
};

async function show(
  role: string | null,
  segmentId = custom.id,
  searchParams: Record<string, string> = {},
) {
  mocks.readSession.mockResolvedValue(role === null ? null : { roles: [role] });
  render(
    await SegmentDetailPage({
      params: Promise.resolve({ segmentId }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

const body = () => within(document.body);

beforeEach(() => {
  expect.hasAssertions();
  mocks.readSession.mockReset();
  mocks.cookieLocale.value = undefined;
  api.fetchCustomerSegment.mockReset();
  api.fetchCustomerSegment.mockResolvedValue({ outcome: "ok", data: custom });
  api.fetchSegmentStoreCurrency.mockReset();
  api.fetchSegmentStoreCurrency.mockResolvedValue({ outcome: "ok", data: { currency: "JPY" } });
});

describe("SegmentDetailPage — custom segment", () => {
  it.each(["operator", "admin"])(
    "%s gets an editable editor, Duplicate and Delete",
    async (role) => {
      await show(role);

      expect(screen.getByTestId("shell")).toHaveAttribute("data-active", "customers-segments");
      expect(body().getByRole("heading", { level: 1 })).toHaveTextContent("عملاء VIP");
      expect(body().getByText("عملاء VIP", { selector: "bdi" })).toHaveAttribute("dir", "auto");
      const editor = screen.getByTestId("editor");
      expect(editor).toHaveAttribute("data-readonly", "false");
      expect(editor).toHaveAttribute("data-mode", "edit");
      expect(editor).toHaveAttribute("data-version", "3");
      expect(editor).toHaveAttribute("data-currency", "JPY");
      expect(editor).toHaveAttribute("data-name", "عملاء VIP");
      expect(body().getByRole("link", { name: en.segments.duplicate })).toHaveAttribute(
        "href",
        `/customers/segments/new?from=${custom.id}`,
      );
      expect(screen.getByTestId("delete")).toHaveAttribute("data-version", "3");
      expect(screen.getByTestId("delete")).toHaveAttribute("data-id", custom.id);
    },
  );

  it.each([["viewer"], ["guest"], [null]])(
    "%s sees the segment read-only: no Duplicate, no Delete, a note",
    async (role) => {
      await show(role);

      expect(screen.getByTestId("editor")).toHaveAttribute("data-readonly", "true");
      expect(body().queryByRole("link", { name: en.segments.duplicate })).toBeNull();
      expect(body().queryByRole("button", { name: /Delete segment/ })).toBeNull();
      expect(body().getByText(en.segments.viewerNote)).toBeVisible();
      expect(screen.getByTestId("members")).toBeInTheDocument();
    },
  );

  it("passes the search, cursor and stack to the members, and the id to the editor", async () => {
    await show("operator", custom.id, { q: "nour", after: "c-2", stack: "c-1" });

    expect(screen.getByTestId("members")).toHaveAttribute("data-search", "nour");
    expect(screen.getByTestId("members")).toHaveAttribute("data-after", "c-2");
    expect(screen.getByTestId("members")).toHaveAttribute("data-stack", "c-1");
    expect(screen.getByTestId("members")).toHaveAttribute("data-id", custom.id);
    expect(screen.getByTestId("members-search")).toBeInTheDocument();
  });
});

describe("SegmentDetailPage — default segment", () => {
  beforeEach(() => {
    api.fetchCustomerSegment.mockResolvedValue({ outcome: "ok", data: notPurchased });
  });

  it("is read-only for an operator, with Duplicate but no Delete, and decodes the route id", async () => {
    await show("operator", "default%3Anot_purchased");

    expect(api.fetchCustomerSegment).toHaveBeenCalledWith("default:not_purchased");
    expect(screen.getByTestId("editor")).toHaveAttribute("data-readonly", "true");
    expect(screen.getByTestId("editor")).toHaveAttribute("data-name", "Haven't purchased");
    expect(body().getByRole("heading", { level: 1 })).toHaveTextContent("Haven't purchased");
    expect(body().getByText(en.segments.readOnlyNote)).toBeVisible();
    expect(body().getByRole("link", { name: en.segments.duplicate })).toHaveAttribute(
      "href",
      "/customers/segments/new?from=default%3Anot_purchased",
    );
    expect(body().queryByRole("button", { name: /Delete segment/ })).toBeNull();
  });

  it("a viewer sees no Duplicate either", async () => {
    await show("viewer", "default:not_purchased");

    expect(body().queryByRole("link", { name: en.segments.duplicate })).toBeNull();
    expect(body().queryByRole("button", { name: /Delete segment/ })).toBeNull();
    expect(body().getByText(en.segments.readOnlyNote)).toBeVisible();
  });

  it("uses the Arabic label in Arabic", async () => {
    mocks.cookieLocale.value = "ar";

    await show("operator", "default:not_purchased");

    expect(body().getByRole("heading", { level: 1 })).toHaveTextContent(
      ar.segments.defaults.notPurchased,
    );
    expect(body().getByRole("link", { name: ar.segments.duplicate })).toBeVisible();
    expect(body().getByText(ar.segments.readOnlyNote)).toBeVisible();
  });
});

describe("SegmentDetailPage — failures", () => {
  it("a missing segment says it no longer exists, with no editor", async () => {
    api.fetchCustomerSegment.mockResolvedValue({ outcome: "not_found" });

    await show("operator", "gone");

    expect(body().getByText(en.segments.notFound)).toBeVisible();
    expect(body().getByRole("link", { name: en.segments.back })).toHaveAttribute(
      "href",
      "/customers/segments",
    );
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.queryByTestId("members")).toBeNull();
  });

  it("503 UNAVAILABLE is the store-database state; 500 is the generic error", async () => {
    api.fetchCustomerSegment.mockResolvedValueOnce({
      outcome: "error",
      message: "x",
      status: 503,
      code: "UNAVAILABLE",
    });
    const { unmount } = render(
      await SegmentDetailPage({
        params: Promise.resolve({ segmentId: "s" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(body().getByText(en.segments.unavailable)).toBeVisible();
    unmount();

    api.fetchCustomerSegment.mockResolvedValueOnce({ outcome: "error", message: "x", status: 500 });
    await show("operator", "s");
    expect(body().getByText(en.segments.error)).toBeVisible();
    expect(body().queryByText(en.segments.unavailable)).toBeNull();
  });

  it("unauthorized asks to sign in", async () => {
    api.fetchCustomerSegment.mockResolvedValue({ outcome: "unauthorized" });

    await show("operator");

    expect(body().getByText(en.segments.unauthorized)).toBeVisible();
  });

  it("without the store currency there is an error state and NO editor (never an EGP fallback)", async () => {
    api.fetchSegmentStoreCurrency.mockResolvedValue({
      outcome: "error",
      message: "x",
      status: 500,
    });

    await show("operator");

    expect(body().getByText(en.segments.currencyError)).toBeVisible();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.queryByTestId("members")).toBeNull();
  });
});
