import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type * as PlatformUi from "@platform/ui";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";
import { en } from "@/messages/en";

const request = vi.hoisted(() => ({
  shell: null as StorefrontShell | null,
  token: null as string | null,
}));
vi.mock("@/lib/request-locale", () => ({
  getRequestShell: async () => request.shell,
  getRequestLocale: async () => "en",
  getPreviewToken: async () => request.token,
}));
vi.mock("@/components/locale-switch", () => ({ LocaleSwitch: () => <span>lang</span> }));
vi.mock("@/components/preview-link-keeper", () => ({ PreviewLinkKeeper: () => null }));
vi.mock("@platform/ui", async (original) => ({
  ...(await original<typeof PlatformUi>()),
  ThemeToggle: () => <span>theme-toggle</span>,
}));
const { default: NotFound } = await import("./not-found");

describe("NotFound (Ruling 23)", () => {
  it("renders inside the shop's own header and footer", async () => {
    request.shell = { ...FALLBACK_SHELL, storeName: "Nour" };
    request.token = null;
    render(await NotFound());
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Nour" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(screen.getByRole("contentinfo")).getByText(en.footer.poweredBy)).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: en.notFound.title })).toBeVisible();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a 404 in a preview keeps ?preview= on the shell links (review M-2)", async () => {
    request.shell = { ...FALLBACK_SHELL, storeName: "Nour", mode: "preview" };
    request.token = "tok";
    render(await NotFound());
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Nour" })).toHaveAttribute(
      "href",
      "/?preview=tok",
    );
    expect(screen.getByRole("status")).toHaveTextContent(en.preview.banner);
  });

  it("a token the shell did not honour is never echoed into links", async () => {
    request.shell = { ...FALLBACK_SHELL, storeName: "Nour", mode: "live", previewExpired: true };
    request.token = "tok";
    render(await NotFound());
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Nour" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("status")).toHaveTextContent(en.preview.expired);
  });
});
