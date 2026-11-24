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
    initialName: string;
    initialConditions: unknown;
    readOnly: boolean;
  }) => (
    <div
      data-testid="editor"
      data-mode={props.mode}
      data-currency={props.currency}
      data-name={props.initialName}
      data-conditions={JSON.stringify(props.initialConditions)}
      data-readonly={String(props.readOnly)}
    />
  ),
}));

const { default: NewSegmentPage } = await import("./page");

const custom = {
  id: "s-1",
  kind: "custom",
  key: null,
  name: "VIP",
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

async function show(searchParams: { from?: string } = {}) {
  render(await NewSegmentPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  expect.hasAssertions();
  mocks.cookieLocale.value = undefined;
  api.fetchSegmentStoreCurrency.mockReset();
  api.fetchSegmentStoreCurrency.mockResolvedValue({ outcome: "ok", data: { currency: "KWD" } });
  api.fetchCustomerSegment.mockReset();
});

describe("NewSegmentPage", () => {
  it("opens an empty create editor in the shop currency, under the Segments nav item", async () => {
    await show();

    const editor = screen.getByTestId("editor");
    expect(editor).toHaveAttribute("data-mode", "create");
    expect(editor).toHaveAttribute("data-currency", "KWD");
    expect(editor).toHaveAttribute("data-name", "");
    expect(editor).toHaveAttribute("data-conditions", "[]");
    expect(editor).toHaveAttribute("data-readonly", "false");
    expect(screen.getByTestId("shell")).toHaveAttribute("data-active", "customers-segments");
    expect(
      within(document.body).getByRole("heading", { level: 1, name: en.segments.newTitle }),
    ).toBeVisible();
    expect(api.fetchCustomerSegment).not.toHaveBeenCalled();
  });

  it("?from=<custom id> loads that segment on the server and prefills 'Copy of …' and its conditions", async () => {
    api.fetchCustomerSegment.mockResolvedValue({ outcome: "ok", data: custom });

    await show({ from: "s-1" });

    expect(api.fetchCustomerSegment).toHaveBeenCalledWith("s-1");
    const editor = screen.getByTestId("editor");
    expect(editor).toHaveAttribute("data-name", "Copy of VIP");
    expect(editor).toHaveAttribute("data-conditions", JSON.stringify(custom.conditions));
  });

  it("?from=<default id> decodes the id and names the copy after the localized label", async () => {
    api.fetchCustomerSegment.mockResolvedValue({ outcome: "ok", data: notPurchased });

    await show({ from: "default%3Anot_purchased" });

    expect(api.fetchCustomerSegment).toHaveBeenCalledWith("default:not_purchased");
    expect(screen.getByTestId("editor")).toHaveAttribute("data-name", "Copy of Haven't purchased");
  });

  it("prefills in Arabic with the Arabic default label", async () => {
    mocks.cookieLocale.value = "ar";
    api.fetchCustomerSegment.mockResolvedValue({ outcome: "ok", data: notPurchased });

    await show({ from: "default:not_purchased" });

    expect(screen.getByTestId("editor")).toHaveAttribute(
      "data-name",
      ar.segments.copyOf.replace("{name}", ar.segments.defaults.notPurchased),
    );
  });

  it("an unknown ?from= falls back to an empty editor", async () => {
    api.fetchCustomerSegment.mockResolvedValue({ outcome: "not_found" });

    await show({ from: "gone" });

    expect(screen.getByTestId("editor")).toHaveAttribute("data-name", "");
    expect(screen.getByTestId("editor")).toHaveAttribute("data-conditions", "[]");
  });

  it("without the store currency there is an error state and NO editor (never an EGP fallback)", async () => {
    api.fetchSegmentStoreCurrency.mockResolvedValue({
      outcome: "error",
      message: "x",
      status: 500,
    });

    await show();

    expect(within(document.body).getByText(en.segments.currencyError)).toBeVisible();
    expect(screen.queryByTestId("editor")).toBeNull();
  });

  it("a 403 on the currency is the same error state", async () => {
    api.fetchSegmentStoreCurrency.mockResolvedValue({ outcome: "unauthorized" });

    await show();

    expect(within(document.body).getByText(en.segments.currencyError)).toBeVisible();
    expect(screen.queryByTestId("editor")).toBeNull();
  });
});
