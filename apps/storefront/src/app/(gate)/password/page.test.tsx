import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type * as OnlineStore from "@/lib/online-store";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";
import { en } from "@/messages/en";

const request = vi.hoisted(() => ({
  shell: null as StorefrontShell | null,
  access: null as { locked: boolean; accessVersion: number; message: object } | null,
}));
vi.mock("@/lib/request-locale", () => ({
  getRequestShell: async () => request.shell,
  getRequestLocale: async () => "en",
}));
vi.mock("@/lib/online-store", async (original) => ({
  ...(await original<typeof OnlineStore>()),
  getPublicAccess: async () => request.access,
}));
vi.mock("./actions", () => ({ unlockAction: vi.fn() }));
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));
const { default: PasswordPage, generateMetadata } = await import("./page");

const page = async (returnTo?: string) =>
  render(
    await PasswordPage({
      searchParams: Promise.resolve(returnTo === undefined ? {} : { return_to: returnTo }),
    }),
  );

afterEach(() => vi.unstubAllEnvs());

describe("PasswordPage (spec 1.12)", () => {
  it("shows the store name, the merchant's message as isolated text, the form and the owner link", async () => {
    vi.stubEnv("ADMIN_ORIGIN", "https://admin.example/some/path");
    request.shell = { ...FALLBACK_SHELL, storeName: "</bdi><b>Nour</b>" };
    request.access = { locked: true, accessVersion: 2, message: { en: "Back on <Monday>" } };
    await page("/cart");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("</bdi><b>Nour</b>");
    const message = screen.getByText("Back on <Monday>");
    expect(message.tagName).toBe("BDI");
    expect(message.closest("p")).toHaveAttribute("dir", "auto");
    expect(screen.getByLabelText(en.password.label)).toHaveAttribute("type", "password");
    expect(document.querySelector('input[name="return_to"]')).toHaveValue("/cart");
    expect(screen.getByRole("link", { name: en.password.ownerLink })).toHaveAttribute(
      "href",
      "https://admin.example",
    );
  });

  it("falls back to 'Opening soon' and the platform brand; no owner link without an admin origin", async () => {
    vi.stubEnv("ADMIN_ORIGIN", "");
    request.shell = FALLBACK_SHELL;
    request.access = null;
    await page();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en.brand);
    expect(screen.getByText(en.password.defaultMessage)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: en.password.ownerLink })).toBeNull();
  });

  it("shows the logo inside the heading, named after the store", async () => {
    request.shell = {
      ...FALLBACK_SHELL,
      storeName: "Nour",
      brand: {
        ...FALLBACK_SHELL.brand,
        logo: {
          image: { url: "https://cdn.test/logo.png", alt: null, width: 400, height: 100 },
          widthPx: 160,
        },
      },
    };
    request.access = null;
    await page();
    const logo = screen.getByRole("img", { name: "Nour" });
    expect(logo).toHaveAttribute("src", "https://cdn.test/logo.png");
    expect(logo.closest("h1")).not.toBeNull();
  });

  it("never redirects by itself (middleware does, from the same access cache: preflight 21)", async () => {
    request.shell = FALLBACK_SHELL;
    request.access = { locked: false, accessVersion: 1, message: {} };
    await page("/cart");
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByLabelText(en.password.label)).toBeInTheDocument();
  });

  it("a hostile return_to is never echoed into the form", async () => {
    request.shell = FALLBACK_SHELL;
    request.access = null;
    await page("/\t/evil.example");
    expect(document.querySelector('input[name="return_to"]')).toHaveValue("/");
  });

  it("a dot-segment return_to is never echoed either (review C-1)", async () => {
    request.shell = FALLBACK_SHELL;
    request.access = null;
    await page("/.//evil.example");
    expect(document.querySelector('input[name="return_to"]')).toHaveValue("/");
  });

  it("its link preview shows the store name and 'Opening soon' only (preflight 18)", async () => {
    request.shell = {
      ...FALLBACK_SHELL,
      storeName: "Nour",
      locked: true,
      preferences: {
        homeTitle: { en: "Secret launch" },
        homeMetaDescription: { en: "Unreleased lamps" },
        shareImage: { url: "https://cdn.test/og.jpg", alt: null, width: 1200, height: 630 },
      },
    };
    const meta = await generateMetadata();
    const text = JSON.stringify(meta);
    expect(text).not.toContain("Secret launch");
    expect(text).not.toContain("Unreleased lamps");
    expect(text).not.toContain("og.jpg");
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.description).toBe(en.password.defaultMessage);
  });
});
