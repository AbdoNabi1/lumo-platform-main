import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { AppShellView } from "./app-shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const user = { name: "owner@example.com", role: "Admin", initials: "OW" };
const emptyStore = {
  storeName: null,
  storeUrl: null,
  banner: null,
  trialDaysLeft: null,
  sessionTenantId: null,
} as const;

function renderShell(store?: Parameters<typeof AppShellView>[0]["store"]) {
  return render(
    <AppShellView t={en} locale="en" activeNavId="home" user={user} store={store}>
      <p>page body</p>
    </AppShellView>,
  );
}

beforeEach(() => {
  vi.stubEnv("STOREFRONT_URL", "https://fallback.example.com");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("AppShellView store context", () => {
  it("falls back to the brand when there is no store prop", () => {
    renderShell();
    expect(screen.getAllByText(en.brand).length).toBeGreaterThan(0);
  });

  it("falls back to the brand when the store name is empty", () => {
    renderShell({ ...emptyStore, storeName: "" });
    expect(screen.getAllByText(en.brand).length).toBeGreaterThan(0);
  });

  it("shows the store name instead of the brand", () => {
    renderShell({ ...emptyStore, storeName: "Acme Goods" });
    expect(screen.getAllByText("Acme Goods").length).toBeGreaterThan(0);
    expect(screen.queryByText(en.brand)).not.toBeInTheDocument();
  });

  it("points View your store at the store's own domain", () => {
    renderShell({ ...emptyStore, storeUrl: "https://acme.morbeh.shop" });
    const links = screen.getAllByRole("link", { name: /view your store/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute("href", "https://acme.morbeh.shop");
  });

  it("falls back to STOREFRONT_URL when the store has no domain", () => {
    renderShell(emptyStore);
    const links = screen.getAllByRole("link", { name: /view your store/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute("href", "https://fallback.example.com");
  });

  it("hides View your store for a store with no domain rather than open the default store", () => {
    vi.stubEnv("TENANT_DEFAULT_ID", "tenant-default");
    renderShell({ ...emptyStore, sessionTenantId: "shop-acme" });
    expect(screen.queryByRole("link", { name: /view your store/i })).not.toBeInTheDocument();
  });

  it("shows the trial banner above the page content", () => {
    renderShell({ ...emptyStore, banner: "trial-ending", trialDaysLeft: 2 });
    const banner = screen.getByRole("link", { name: /Your free trial ends in 2 days/ });
    const body = screen.getByText("page body");
    expect(banner.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has no banner when billing is fine", () => {
    renderShell(emptyStore);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
