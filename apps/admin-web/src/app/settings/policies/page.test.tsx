import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { POLICY_TITLES } from "@platform/storefront-content";
import type * as SessionModule from "@/lib/auth/session";
import { en } from "@/messages/en";

/**
 * The page decides what each card gets: the role (viewer reads, operator edits), the template
 * prefill (Ruling 20: the store name, and the email only when the admin-only settings read works),
 * the "set" flag from the list, and a load error per card for a failed read.
 */
const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  card: vi.fn(),
  fetchPolicy: vi.fn(),
  fetchPolicies: vi.fn(),
  fetchStoreSettings: vi.fn(),
}));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  readSession: mocks.readSession,
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/lib/api/online-store", () => ({
  fetchPolicies: mocks.fetchPolicies,
  fetchPolicy: mocks.fetchPolicy,
  fetchPreferences: async () => ({ outcome: "ok", data: { storeName: "Nour" } }),
}));
vi.mock("@/lib/api/store-settings", () => ({ fetchStoreSettings: mocks.fetchStoreSettings }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/online-store/policy-card", () => ({
  PolicyCard: (props: unknown) => {
    mocks.card(props);
    return null;
  },
}));
const { default: PoliciesPage } = await import("./page");

type CardProps = {
  type: string;
  title: string;
  set: boolean;
  canEdit: boolean;
  defaults: { storeName: string; contactEmail: string; returnWindowDays: number };
};

beforeEach(() => {
  cleanup();
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.fetchPolicies.mockResolvedValue({
    outcome: "ok",
    data: [{ type: "refund", set: true, locales: ["en"], updatedAt: null }],
  });
  mocks.fetchPolicy.mockImplementation(async (type: string) => ({
    outcome: "ok",
    data: { type, body: {}, updatedAt: null, version: 1 },
  }));
  mocks.fetchStoreSettings.mockResolvedValue({
    outcome: "ok",
    settings: { contactEmail: "hi@nour.example" },
  });
});

async function renderAs(roles: readonly string[]) {
  mocks.readSession.mockResolvedValue({ roles, token: "t" });
  render(await PoliciesPage());
  return mocks.card.mock.calls.map((call) => call[0] as CardProps);
}

describe("Settings → Policies page", () => {
  it("one card per policy, titled in the admin's language; editable for an operator", async () => {
    const cards = await renderAs(["operator"]);
    expect(cards.map((card) => card.type)).toEqual([
      "refund",
      "shipping",
      "privacy",
      "terms",
      "contact",
    ]);
    expect(cards[0]).toMatchObject({ title: POLICY_TITLES.refund.en, set: true, canEdit: true });
    expect(cards[1]?.set).toBe(false);
    expect(cards[0]?.defaults).toMatchObject({
      storeName: "Nour",
      contactEmail: "hi@nour.example",
      returnWindowDays: 14,
    });
  });

  it("is read-only for a viewer, and an operator's blocked settings read leaves the email blank", async () => {
    mocks.fetchStoreSettings.mockResolvedValue({ outcome: "unauthorized" });
    const cards = await renderAs(["viewer"]);
    expect(cards.every((card) => !card.canEdit)).toBe(true);
    expect(cards[0]?.defaults.contactEmail).toBe("");
    expect(screen.getByText(en.policies.readOnly)).toBeInTheDocument();
  });

  it("a policy that cannot be read says so in its own card", async () => {
    mocks.fetchPolicy.mockImplementation(async (type: string) =>
      type === "terms"
        ? { outcome: "error", message: "down" }
        : { outcome: "ok", data: { type, body: {}, updatedAt: null, version: 1 } },
    );
    const cards = await renderAs(["admin"]);
    expect(cards).toHaveLength(4);
    expect(screen.getByRole("alert")).toHaveTextContent(en.policies.loadError);
  });
});
