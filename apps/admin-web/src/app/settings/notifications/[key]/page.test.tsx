import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { en } from "@/messages/en";
import { TEMPLATES } from "@/components/settings/notifications/test-fixtures";

const mocks = vi.hoisted(() => ({
  fetchNotificationTemplates: vi.fn(),
  editor: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/lib/api/notification-settings", () => ({
  fetchNotificationTemplates: mocks.fetchNotificationTemplates,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/settings/notifications/template-editor", () => ({
  TemplateEditor: (props: unknown) => {
    mocks.editor(props);
    return <p>the editor</p>;
  },
}));
const { default: Page } = await import("./page");

const copy = en.notificationSettings;

beforeEach(() => {
  cleanup();
  mocks.editor.mockReset();
  mocks.notFound.mockClear();
  mocks.fetchNotificationTemplates
    .mockReset()
    .mockResolvedValue({ outcome: "ok", templates: TEMPLATES });
});

describe("/settings/notifications/[key] page", () => {
  it("renders the template's name with a way back, and hands the editor that template", async () => {
    expect.hasAssertions();
    render(await Page({ params: Promise.resolve({ key: "order_refunded" }) }));

    expect(
      screen.getByRole("heading", { level: 1, name: copy.templateNames.order_refunded }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: copy.editor.back })).toHaveAttribute(
      "href",
      "/settings/notifications",
    );
    expect(mocks.editor).toHaveBeenCalledWith(
      expect.objectContaining({
        template: TEMPLATES.find((item) => item.key === "order_refunded"),
        initialLocale: "en",
      }),
    );
  });

  it("is a 404 for a key that is not one of the six templates, before the API is asked", async () => {
    expect.hasAssertions();
    await expect(Page({ params: Promise.resolve({ key: "nope" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(mocks.fetchNotificationTemplates).not.toHaveBeenCalled();
  });

  it("says so when the templates cannot be read", async () => {
    expect.hasAssertions();
    mocks.fetchNotificationTemplates.mockResolvedValue({ outcome: "error", message: "x" });
    render(await Page({ params: Promise.resolve({ key: "order_refunded" }) }));

    expect(screen.getByText(copy.editor.loadError)).toBeInTheDocument();
    expect(mocks.editor).not.toHaveBeenCalled();
  });

  it("asks to sign in when unauthorized", async () => {
    expect.hasAssertions();
    mocks.fetchNotificationTemplates.mockResolvedValue({ outcome: "unauthorized" });
    render(await Page({ params: Promise.resolve({ key: "order_refunded" }) }));

    expect(screen.getByText(copy.unauthorized)).toBeInTheDocument();
  });
});
