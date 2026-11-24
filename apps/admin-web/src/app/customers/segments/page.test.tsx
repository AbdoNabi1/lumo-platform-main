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

const { default: SegmentsPage } = await import("./page");

const segments = [
  {
    id: "default:not_purchased",
    kind: "default",
    key: "notPurchased",
    name: null,
    version: null,
    conditions: [{ field: "orders_count", op: "eq", value: 0 }],
    updatedAt: null,
  },
  {
    id: "s-1",
    kind: "custom",
    key: null,
    name: "VIP",
    version: 1,
    conditions: [{ field: "orders_count", op: "gte", value: 3 }],
    updatedAt: "2026-11-20T10:00:00.000Z",
  },
];

async function show(role: string | null = "operator") {
  mocks.readSession.mockResolvedValue(role === null ? null : { roles: [role] });
  render(await SegmentsPage());
}

beforeEach(() => {
  expect.hasAssertions();
  mocks.readSession.mockReset();
  mocks.cookieLocale.value = undefined;
  api.fetchCustomerSegments.mockReset();
  api.fetchCustomerSegments.mockResolvedValue({ outcome: "ok", data: { items: segments } });
});

const body = () => within(document.body);

describe("SegmentsPage", () => {
  it("lists the segments under the Segments nav item, with the title and subtitle", async () => {
    await show();

    expect(screen.getByTestId("shell")).toHaveAttribute("data-active", "customers-segments");
    expect(body().getByRole("heading", { level: 1, name: "Segments" })).toBeVisible();
    expect(body().getByText(en.segments.subtitle)).toBeVisible();
    expect(body().getByRole("table", { name: en.segments.listLabel })).toBeVisible();
    expect(body().getByText("Haven't purchased")).toBeVisible();
    expect(body().getByText("VIP")).toBeVisible();
  });

  it.each(["operator", "admin"])(
    "%s sees Create segment, linking to /customers/segments/new",
    async (role) => {
      await show(role);

      expect(body().getByRole("link", { name: en.segments.create })).toHaveAttribute(
        "href",
        "/customers/segments/new",
      );
    },
  );

  it.each([["viewer"], ["guest"], [null]])("%s sees no Create segment", async (role) => {
    await show(role);

    expect(body().queryByRole("link", { name: en.segments.create })).toBeNull();
    expect(body().getByRole("table")).toBeVisible();
  });

  it("503 + UNAVAILABLE is 'Segments need the store database'", async () => {
    api.fetchCustomerSegments.mockResolvedValue({
      outcome: "error",
      message: "x",
      status: 503,
      code: "UNAVAILABLE",
    });

    await show();

    expect(body().getByText(en.segments.unavailable)).toBeVisible();
    expect(body().queryByRole("table")).toBeNull();
  });

  it.each([
    ["503 without the code", { outcome: "error", message: "x", status: 503 }],
    ["500", { outcome: "error", message: "x", status: 500 }],
    ["a network failure", { outcome: "error", message: "x" }],
    [
      "UNAVAILABLE with another status",
      { outcome: "error", message: "x", status: 500, code: "UNAVAILABLE" },
    ],
  ])("%s is the generic error, never the unavailable state", async (_label, result) => {
    api.fetchCustomerSegments.mockResolvedValue(result);

    await show();

    expect(body().getByText(en.segments.error)).toBeVisible();
    expect(body().queryByText(en.segments.unavailable)).toBeNull();
  });

  it("unauthorized asks to sign in", async () => {
    api.fetchCustomerSegments.mockResolvedValue({ outcome: "unauthorized" });

    await show();

    expect(body().getByText(en.segments.unauthorized)).toBeVisible();
  });

  it("renders in Arabic", async () => {
    mocks.cookieLocale.value = "ar";

    await show();

    expect(body().getByRole("heading", { level: 1, name: ar.segments.title })).toBeVisible();
    expect(body().getByText(ar.segments.defaults.notPurchased)).toBeVisible();
    expect(body().getByRole("link", { name: ar.segments.create })).toBeVisible();
    expect(body().queryByText(en.segments.title)).toBeNull();
  });
});
