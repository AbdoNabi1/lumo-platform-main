import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type * as PlatformUi from "@platform/ui";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";
import { en } from "@/messages/en";
import { usePreviewMode } from "./preview-mode";

vi.mock("@/components/locale-switch", () => ({ LocaleSwitch: () => <span>lang</span> }));
vi.mock("./preview-link-keeper", () => ({
  PreviewLinkKeeper: ({ token }: { token: string }) => <span>keeper:{token}</span>,
}));
vi.mock("@platform/ui", async (original) => ({
  ...(await original<typeof PlatformUi>()),
  ThemeToggle: () => <span>theme-toggle</span>,
}));
const { StoreChrome } = await import("./store-chrome");

const preview: StorefrontShell = {
  ...FALLBACK_SHELL,
  mode: "preview",
  previewExpiresAt: "2026-11-02T14:05:00.000Z",
  storeName: "Nour",
};

function Probe() {
  return <p>preview-active:{String(usePreviewMode().active)}</p>;
}

describe("StoreChrome preview pieces (Ruling 16)", () => {
  it("in preview: the banner comes first, links keep the token, and the page knows it is a preview", () => {
    const { container } = render(
      <StoreChrome shell={preview} locale="en" previewToken="tok" previewExpired={false}>
        <Probe />
      </StoreChrome>,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(en.preview.banner);
    expect(container.firstElementChild?.firstElementChild).toBe(banner);
    expect(screen.getByText("preview-active:true")).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Nour" })).toHaveAttribute(
      "href",
      "/?preview=tok",
    );
    expect(screen.getByRole("search").querySelector('input[name="preview"]')).toHaveValue("tok");
    expect(screen.getByText("keeper:tok")).toBeInTheDocument();
  });

  it("an expired preview shows the expired banner over the live shell, with nothing kept", () => {
    render(
      <StoreChrome shell={FALLBACK_SHELL} locale="en" previewToken={null} previewExpired>
        <Probe />
      </StoreChrome>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(en.preview.expired);
    expect(screen.getByText("preview-active:false")).toBeInTheDocument();
    expect(screen.queryByText(/^keeper:/)).toBeNull();
  });

  it("an ordinary visit has no banner and is not a preview", () => {
    render(
      <StoreChrome shell={FALLBACK_SHELL} locale="en" previewToken={null} previewExpired={false}>
        <Probe />
      </StoreChrome>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("preview-active:false")).toBeInTheDocument();
  });
});
