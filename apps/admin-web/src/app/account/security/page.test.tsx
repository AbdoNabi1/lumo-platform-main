import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  fetchOwnTwoStep: vi.fn(),
  locale: { value: undefined as string | undefined },
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (mocks.locale.value === undefined ? undefined : { value: mocks.locale.value }),
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/api/two-step", () => ({ fetchOwnTwoStep: mocks.fetchOwnTwoStep }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/app/account/security/actions", () => ({
  startTwoStepAction: vi.fn(),
  confirmTwoStepAction: vi.fn(),
  regenerateBackupCodesAction: vi.fn(),
  disableTwoStepAction: vi.fn(),
}));

const { default: AccountSecurityPage, metadata } = await import("./page");

const ON = {
  enabled: true,
  activatedAt: "2026-11-20T10:00:00.000Z",
  backupCodesLeft: 10,
  policyRequired: false,
};

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
  mocks.fetchOwnTwoStep.mockReset();
  mocks.locale.value = undefined;
  vi.stubEnv("AUTH_MODE", "native");
});

describe("/account/security", () => {
  it("renders the title and the panel for the signed-in member's status", async () => {
    mocks.fetchOwnTwoStep.mockResolvedValue({ outcome: "ok", data: ON });
    render(await AccountSecurityPage());
    expect(
      screen.getByRole("heading", { level: 1, name: en.accountSecurity.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(en.accountSecurity.statusOn)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.accountSecurity.turnOff })).toBeInTheDocument();
  });

  it("renders in Arabic when the locale cookie says so", async () => {
    mocks.locale.value = "ar";
    mocks.fetchOwnTwoStep.mockResolvedValue({
      outcome: "ok",
      data: { ...ON, enabled: false, activatedAt: null, backupCodesLeft: 0 },
    });
    render(await AccountSecurityPage());
    expect(
      screen.getByRole("heading", { level: 1, name: ar.accountSecurity.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.accountSecurity.turnOn })).toBeInTheDocument();
  });

  it("never renders a secret: the server component only knows the status", async () => {
    mocks.fetchOwnTwoStep.mockResolvedValue({ outcome: "ok", data: ON });
    render(await AccountSecurityPage());
    expect(document.body.innerHTML).not.toContain("otpauth://");
    expect(document.body.innerHTML.toLowerCase()).not.toContain("secret=");
  });

  it("says it could not load on an error and asks to sign in on a 401 (never the raw message)", async () => {
    mocks.fetchOwnTwoStep.mockResolvedValue({ outcome: "error", message: "boom", status: 500 });
    render(await AccountSecurityPage());
    expect(screen.getByRole("alert")).toHaveTextContent(en.accountSecurity.loadError);
    expect(screen.queryByText("boom")).toBeNull();
    cleanup();
    mocks.fetchOwnTwoStep.mockResolvedValue({ outcome: "unauthorized" });
    render(await AccountSecurityPage());
    expect(screen.getByRole("alert")).toHaveTextContent(en.formErrors.unauthorized);
  });

  it("is for native sign-in only (under Ory the factors live in Kratos): redirects to /", async () => {
    vi.stubEnv("AUTH_MODE", "ory");
    await expect(AccountSecurityPage()).rejects.toThrow("REDIRECT:/");
  });

  it("asks browsers not to send a Referer (the setup key is on this page)", () => {
    expect(metadata).toEqual({ referrer: "no-referrer" });
  });
});
