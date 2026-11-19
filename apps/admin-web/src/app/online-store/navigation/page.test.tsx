import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as SessionModule from "@/lib/auth/session";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({ readSession: vi.fn(), fetchMenus: vi.fn() }));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  readSession: mocks.readSession,
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/lib/api/online-store", () => ({ fetchMenus: mocks.fetchMenus }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const { default: OnlineStoreNavigationPage } = await import("./page");

const n = en.onlineStoreNavigation;

beforeEach(() => {
  mocks.readSession.mockReset();
  mocks.fetchMenus.mockReset().mockResolvedValue({
    outcome: "ok",
    data: [
      {
        id: null,
        handle: "main-menu",
        title: "Main menu",
        itemCount: 2,
        isDefault: true,
        topLabels: [{ en: "Shop" }, { ar: "العروض" }],
      },
      {
        id: "m-1",
        handle: "sale",
        title: "Sale links",
        itemCount: 0,
        isDefault: false,
        topLabels: [],
      },
    ],
  });
});

async function renderAs(roles: readonly string[]) {
  mocks.readSession.mockResolvedValue({ roles, token: "t" });
  render(await OnlineStoreNavigationPage());
}

describe("Online Store → Navigation list", () => {
  it("isolates each label on its own, so mixed scripts keep their own direction (review M-6)", async () => {
    await renderAs(["viewer"]);
    const row = screen.getByRole("link", { name: n.defaultMain }).closest("tr")!;
    const labels = within(row)
      .getAllByText((_, el) => el?.tagName === "BDI" && el.closest("td") !== null)
      .filter((el) => el.closest("a") === null)
      .map((el) => [el.textContent, el.getAttribute("dir")]);
    expect(labels).toEqual([
      ["Shop", "auto"],
      ["العروض", "auto"],
    ]);
    expect(row).toHaveTextContent("Shop, العروض");
    const sale = screen.getByRole("link", { name: "Sale links" }).closest("tr")!;
    expect(sale).toHaveTextContent(n.noItems);
    expect(screen.getByRole("link", { name: "Sale links" })).toHaveAttribute(
      "href",
      "/online-store/navigation/sale",
    );
  });

  it("offers Add menu to operators, not to viewers", async () => {
    await renderAs(["viewer"]);
    expect(screen.queryByRole("link", { name: n.addMenu })).toBeNull();
    cleanup();
    await renderAs(["operator"]);
    expect(screen.getByRole("link", { name: n.addMenu })).toHaveAttribute(
      "href",
      "/online-store/navigation/new",
    );
  });
});
