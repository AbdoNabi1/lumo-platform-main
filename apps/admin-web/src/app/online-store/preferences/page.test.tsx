import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as SessionModule from "@/lib/auth/session";

/**
 * The page decides which controls a role gets; the components are tested with those props
 * separately. This pins the mapping itself: viewer reads, operator edits, admin also locks the
 * store and may follow the link to the admin-only Settings → General.
 */
const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  preferencesForm: vi.fn(),
  passwordCard: vi.fn(),
}));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  readSession: mocks.readSession,
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/lib/api/online-store", () => ({
  fetchPreferences: async () => ({ outcome: "ok", data: { version: 1 } }),
  fetchAccess: async () => ({ outcome: "ok", data: { version: 1 } }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/online-store/preferences-form", () => ({
  PreferencesForm: (props: unknown) => {
    mocks.preferencesForm(props);
    return null;
  },
}));
vi.mock("@/components/online-store/password-protection-card", () => ({
  PasswordProtectionCard: (props: unknown) => {
    mocks.passwordCard(props);
    return null;
  },
}));
const { default: OnlineStorePreferencesPage } = await import("./page");

beforeEach(() => {
  mocks.readSession.mockReset();
  mocks.preferencesForm.mockReset();
  mocks.passwordCard.mockReset();
});

async function renderAs(roles: readonly string[] | null) {
  mocks.readSession.mockResolvedValue(roles === null ? null : { roles, token: "t" });
  render(await OnlineStorePreferencesPage());
  return {
    form: mocks.preferencesForm.mock.calls.at(-1)?.[0] as {
      canEdit: boolean;
      canChangeStoreName: boolean;
    },
    card: mocks.passwordCard.mock.calls.at(-1)?.[0] as { isAdmin: boolean },
  };
}

describe("Online Store → Preferences page: role to controls", () => {
  it.each([
    [["viewer"], { canEdit: false, canChangeStoreName: false, isAdmin: false }],
    [["operator"], { canEdit: true, canChangeStoreName: false, isAdmin: false }],
    [["admin"], { canEdit: true, canChangeStoreName: true, isAdmin: true }],
    // highestRole picks the top tier whatever the order, and ignores unknown roles.
    [
      ["orders:read", "viewer", "admin"],
      { canEdit: true, canChangeStoreName: true, isAdmin: true },
    ],
    [["orders:read"], { canEdit: false, canChangeStoreName: false, isAdmin: false }],
    [null, { canEdit: false, canChangeStoreName: false, isAdmin: false }],
  ] as const)("%j", async (roles, expected) => {
    const { form, card } = await renderAs(roles);
    expect({
      canEdit: form.canEdit,
      canChangeStoreName: form.canChangeStoreName,
      isAdmin: card.isAdmin,
    }).toEqual(expected);
  });
});
