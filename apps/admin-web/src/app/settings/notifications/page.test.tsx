import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { en } from "@/messages/en";
import { EMAIL_NONE, SETTINGS, TEMPLATES } from "@/components/settings/notifications/test-fixtures";

const mocks = vi.hoisted(() => ({
  fetchNotificationSettings: vi.fn(),
  fetchNotificationTemplates: vi.fn(),
  fetchEmailConnection: vi.fn(),
  panel: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/lib/api/notification-settings", () => ({
  fetchNotificationSettings: mocks.fetchNotificationSettings,
  fetchNotificationTemplates: mocks.fetchNotificationTemplates,
  fetchEmailConnection: mocks.fetchEmailConnection,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/settings/notifications/notification-settings-panel", () => ({
  NotificationSettingsPanel: (props: unknown) => {
    mocks.panel(props);
    return <p>the panel</p>;
  },
}));
const { default: Page } = await import("./page");

const copy = en.notificationSettings;

beforeEach(() => {
  cleanup();
  mocks.panel.mockReset();
  mocks.fetchNotificationSettings
    .mockReset()
    .mockResolvedValue({ outcome: "ok", settings: SETTINGS });
  mocks.fetchNotificationTemplates
    .mockReset()
    .mockResolvedValue({ outcome: "ok", templates: TEMPLATES });
  mocks.fetchEmailConnection
    .mockReset()
    .mockResolvedValue({ outcome: "ok", emailConnection: EMAIL_NONE });
});

describe("/settings/notifications page", () => {
  it("renders the title in the settings frame with its own entry current and hands the panel what it read", async () => {
    expect.hasAssertions();
    render(await Page());

    expect(screen.getByRole("heading", { level: 1, name: copy.title })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/settings/notifications"]);
    expect(mocks.panel).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: SETTINGS,
        templates: TEMPLATES,
        emailConnection: EMAIL_NONE,
      }),
    );
  });

  it("still shows the page when only the email account read fails (the card says so)", async () => {
    expect.hasAssertions();
    mocks.fetchEmailConnection.mockResolvedValue({ outcome: "error", message: "boom" });
    render(await Page());

    expect(mocks.panel).toHaveBeenCalledWith(expect.objectContaining({ emailConnection: null }));
  });

  it.each([
    ["settings", "fetchNotificationSettings"],
    ["templates", "fetchNotificationTemplates"],
  ])("says so when the %s cannot be read, without showing the sections", async (_label, name) => {
    expect.hasAssertions();
    mocks[name as "fetchNotificationSettings"].mockResolvedValue({
      outcome: "error",
      message: "x",
    });
    render(await Page());

    expect(screen.getByText(copy.loadError)).toBeInTheDocument();
    expect(mocks.panel).not.toHaveBeenCalled();
  });

  it("asks to sign in when the read is unauthorized", async () => {
    expect.hasAssertions();
    mocks.fetchNotificationSettings.mockResolvedValue({ outcome: "unauthorized" });
    render(await Page());

    expect(screen.getByText(copy.unauthorized)).toBeInTheDocument();
    expect(mocks.panel).not.toHaveBeenCalled();
  });
});
