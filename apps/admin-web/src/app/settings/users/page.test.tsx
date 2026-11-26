import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  fetchStaff: vi.fn(),
  fetchStaffSecurityPolicy: vi.fn(),
  locale: { value: undefined as string | undefined },
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (mocks.locale.value === undefined ? undefined : { value: mocks.locale.value }),
    }),
}));
vi.mock("@/lib/api/staff", () => ({
  fetchStaff: mocks.fetchStaff,
  fetchStaffSecurityPolicy: mocks.fetchStaffSecurityPolicy,
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/app/settings/users/actions", () => ({
  inviteStaffAction: vi.fn(),
  resendInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
  changeStaffRoleAction: vi.fn(),
  setStaffActiveAction: vi.fn(),
  setRequireTwoStepAction: vi.fn(),
  resetStaffTwoStepAction: vi.fn(),
}));
const { default: UsersPage } = await import("./page");

const OWNER = {
  principalExternalId: "pid-owner",
  email: "owner@shop.example",
  role: "owner",
  status: "active",
  isOwner: true,
  isSelf: false,
  addedAt: "2026-11-01T10:00:00.000Z",
  lastSignInAt: null,
  twoStep: true,
  invitation: null,
};
const POLICY = {
  requireTwoStep: false,
  codeStepAvailable: true,
  activeStaff: 2,
  enrolledActiveStaff: 1,
  notEnrolled: [{ principalExternalId: "pid-me", email: "me@shop.example" }],
  pendingInvitations: 0,
};
const ME = {
  ...OWNER,
  principalExternalId: "pid-me",
  email: "me@shop.example",
  role: "admin",
  isOwner: false,
  isSelf: true,
};

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
  mocks.fetchStaff.mockReset();
  mocks.fetchStaffSecurityPolicy.mockReset();
  mocks.fetchStaffSecurityPolicy.mockResolvedValue({ outcome: "ok", data: POLICY });
  mocks.locale.value = undefined;
});

describe("/settings/users", () => {
  it("renders the staff table inside the settings frame with Users and permissions current", async () => {
    mocks.fetchStaff.mockResolvedValue({ outcome: "ok", data: { items: [OWNER, ME] } });
    render(await UsersPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Users and permissions" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add staff" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Staff" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: en.settingsNav.label });
    const current = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("href"))).toEqual(["/settings/users"]);
    expect(current[0]).toHaveTextContent("Users and permissions");
  });

  it("renders in Arabic when the locale cookie says so", async () => {
    mocks.locale.value = "ar";
    mocks.fetchStaff.mockResolvedValue({ outcome: "ok", data: { items: [OWNER, ME] } });
    render(await UsersPage());

    expect(screen.getByRole("heading", { level: 1, name: ar.users.title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.users.addStaff })).toBeInTheDocument();
    expect(screen.queryByText(en.users.addStaff)).toBeNull();
  });

  it("says who may open it on a 403, with no table and no Add staff", async () => {
    mocks.fetchStaff.mockResolvedValue({ outcome: "unauthorized", status: 403 });
    render(await UsersPage());

    expect(screen.getByRole("alert")).toHaveTextContent(en.users.forbidden);
    expect(screen.queryByRole("button", { name: "Add staff" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Staff" })).toBeNull();
  });

  it("asks to sign in on a 401, and shows a load error otherwise", async () => {
    mocks.fetchStaff.mockResolvedValue({ outcome: "unauthorized" });
    render(await UsersPage());
    expect(screen.getByRole("alert")).toHaveTextContent(en.users.unauthorized);
    cleanup();

    mocks.fetchStaff.mockResolvedValue({ outcome: "error", message: "boom", status: 500 });
    render(await UsersPage());
    expect(screen.getByRole("alert")).toHaveTextContent(en.users.loadError);
    expect(screen.queryByText("boom")).toBeNull();
    cleanup();

    mocks.fetchStaff.mockResolvedValue({ outcome: "not_found" });
    render(await UsersPage());
    expect(screen.getByRole("alert")).toHaveTextContent(en.users.loadError);
  });

  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)(
    "shows the read-only platform note instead of the switch when Morbeh requires two-step (%s)",
    async (locale, t) => {
      mocks.locale.value = locale;
      mocks.fetchStaff.mockResolvedValue({ outcome: "ok", data: { items: [OWNER, ME] } });
      mocks.fetchStaffSecurityPolicy.mockResolvedValue({
        outcome: "ok",
        data: { ...POLICY, platformRequired: true },
      });
      render(await UsersPage());
      expect(screen.getByRole("note")).toHaveTextContent(t.usersPolicy.platformNote);
      expect(screen.queryByRole("switch")).toBeNull();
      // The people-without-two-step list belongs to the switch that is gone.
      expect(document.body.textContent).not.toContain(t.usersPolicy.missingHeading);
    },
  );

  it("keeps the switch while the platform rule is off", async () => {
    mocks.fetchStaff.mockResolvedValue({ outcome: "ok", data: { items: [OWNER, ME] } });
    render(await UsersPage());
    expect(screen.getByRole("switch")).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: /Morbeh/ })).toBeNull();
  });
});
