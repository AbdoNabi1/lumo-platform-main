import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor, within } from "@testing-library/react";
import { en } from "@/messages/en";

// The real page with the REAL editor: a viewer must not get a single write control (I2).
const mocks = vi.hoisted(() => ({ readSession: vi.fn() }));
const api = vi.hoisted(() => ({
  fetchCustomerSegment: vi.fn(),
  fetchSegmentStoreCurrency: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  readSession: mocks.readSession,
  highestRole: (roles: readonly string[]) =>
    (["admin", "operator", "viewer"] as const).find((role) => roles.includes(role)),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/api/customer-segments", () => api);
vi.mock("@/app/customers/segments/actions", () => ({
  createSegmentAction: vi.fn(),
  updateSegmentAction: vi.fn(),
  previewSegmentAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { default: NewSegmentPage } = await import("./page");

const body = () => within(document.body);

async function show(searchParams: { from?: string } = {}) {
  return render(await NewSegmentPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  expect.hasAssertions();
  mocks.readSession.mockReset();
  api.fetchCustomerSegment.mockReset();
  api.fetchSegmentStoreCurrency.mockReset();
  api.fetchSegmentStoreCurrency.mockResolvedValue({ outcome: "ok", data: { currency: "EGP" } });
});

describe("new segment page, real editor", () => {
  it.each([
    ["a viewer", { roles: ["viewer"] }],
    ["an unknown role", { roles: ["guest"] }],
    ["an empty role list", { roles: [] }],
    ["no session", null],
  ])(
    "%s sees no Save, Add condition, Remove, name field or filter controls",
    async (_name, session) => {
      mocks.readSession.mockResolvedValue(session);

      await show();

      await waitFor(() => expect(body().getByText(en.segments.createNotAllowed)).toBeVisible());
      expect(body().queryByRole("button", { name: en.segments.editor.save })).toBeNull();
      expect(body().queryByRole("button", { name: en.segments.editor.addCondition })).toBeNull();
      expect(body().queryByRole("button", { name: /Remove condition/ })).toBeNull();
      expect(body().queryByLabelText(en.segments.editor.nameLabel)).toBeNull();
      expect(body().queryByRole("textbox")).toBeNull();
      expect(body().queryByRole("combobox")).toBeNull();
      expect(body().queryByRole("form")).toBeNull();
      expect(document.body.querySelector("form, input, select, textarea")).toBeNull();
    },
  );

  it.each([["operator"], ["admin"]])(
    "%s keeps the create editor with Save and Add condition",
    async (role) => {
      mocks.readSession.mockResolvedValue({ roles: [role] });

      await show();

      await waitFor(() =>
        expect(body().getByRole("button", { name: en.segments.editor.save })).toBeEnabled(),
      );
      expect(body().getByRole("button", { name: en.segments.editor.addCondition })).toBeEnabled();
      expect(body().getByLabelText(en.segments.editor.nameLabel)).toBeEnabled();
      expect(body().queryByText(en.segments.createNotAllowed)).toBeNull();
    },
  );

  it("an operator's Duplicate prefill still reaches the real editor", async () => {
    mocks.readSession.mockResolvedValue({ roles: ["operator"] });
    api.fetchCustomerSegment.mockResolvedValue({
      outcome: "ok",
      data: {
        id: "s-1",
        kind: "custom",
        key: null,
        name: "VIP",
        version: 3,
        conditions: [{ field: "orders_count", op: "gte", value: 3 }],
        updatedAt: "2026-11-20T10:00:00.000Z",
      },
    });

    await show({ from: "s-1" });

    await waitFor(() =>
      expect(body().getByLabelText(en.segments.editor.nameLabel)).toHaveValue("Copy of VIP"),
    );
    expect(api.fetchCustomerSegment).toHaveBeenCalledWith("s-1");
  });
});
