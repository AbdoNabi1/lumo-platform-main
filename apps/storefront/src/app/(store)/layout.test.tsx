import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LockedFrame } from "@/components/locked-frame";
import { StoreChrome } from "@/components/store-chrome";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";

const request = vi.hoisted(() => ({
  shell: null as StorefrontShell | null,
  token: null as string | null,
  returnPath: null as string | null,
  lockedView: false,
}));
vi.mock("@/lib/request-locale", () => ({
  getRequestShell: async () => request.shell,
  getRequestLocale: async () => "en",
  getPreviewToken: async () => request.token,
  getReturnPath: async () => request.returnPath,
  getLockedView: async () => request.lockedView,
}));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));
const { default: StoreLayout } = await import("./layout");

beforeEach(() => {
  redirect.mockClear();
  request.lockedView = false;
  request.token = null;
});

type ChromeProps = { previewToken: string | null; previewExpired: boolean; locale: string };

async function chromeProps(shell: Partial<StorefrontShell>, token: string | null) {
  request.shell = { ...FALLBACK_SHELL, ...shell };
  request.token = token;
  const element = await StoreLayout({ children: <p>page</p> });
  expect(isValidElement(element) && element.type === StoreChrome).toBe(true);
  return (element as { props: ChromeProps }).props;
}

describe("StoreLayout preview gate", () => {
  it("passes the token on only when the shell really is a preview", async () => {
    const props = await chromeProps({ mode: "preview" }, "tok");
    expect(props.previewToken).toBe("tok");
    expect(props.previewExpired).toBe(false);
  });

  it("drops a token the shell did not honour (invalid, expired, or a failed read)", async () => {
    expect((await chromeProps({ mode: "live" }, "tok")).previewToken).toBeNull();
  });

  it("an expired token on an open store shows the expired banner over the live shell", async () => {
    const props = await chromeProps({ mode: "live", previewExpired: true }, "tok");
    expect(props.previewToken).toBeNull();
    expect(props.previewExpired).toBe(true);
  });

  it("has no token for an ordinary visit", async () => {
    const props = await chromeProps({ mode: "live" }, null);
    expect(props.previewToken).toBeNull();
    expect(props.previewExpired).toBe(false);
    expect(props.locale).toBe("en");
  });

  it("second layer (Ruling 36): a token the shell did not honour on a locked store goes to the gate", async () => {
    request.returnPath = null;
    await expect(chromeProps({ mode: "live", locked: true }, "tok")).rejects.toThrow(
      /^REDIRECT:\/password\?return_to=%2F$/,
    );
    await expect(
      chromeProps({ mode: "live", locked: true, previewExpired: true }, "tok"),
    ).rejects.toThrow(/^REDIRECT:\/password\?/);
  });

  it("the second layer keeps where the visitor was (review M-4), never somewhere else", async () => {
    request.returnPath = "/products/lamp?c=1";
    await expect(chromeProps({ mode: "live", locked: true }, "tok")).rejects.toThrow(
      /^REDIRECT:\/password\?return_to=%2Fproducts%2Flamp%3Fc%3D1$/,
    );
    request.returnPath = "/.//evil.example";
    await expect(chromeProps({ mode: "live", locked: true }, "tok")).rejects.toThrow(
      /^REDIRECT:\/password\?return_to=%2F$/,
    );
    request.returnPath = null;
  });

  it("a real preview of a locked store renders, and so does a cookie holder without a token", async () => {
    expect((await chromeProps({ mode: "preview", locked: true }, "tok")).previewToken).toBe("tok");
    expect((await chromeProps({ mode: "live", locked: true }, null)).previewToken).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("StoreLayout locked view (Ruling 5)", () => {
  it("a locked view renders LockedFrame, never StoreChrome (Review Focus 1)", async () => {
    request.lockedView = true;
    request.shell = { ...FALLBACK_SHELL, locked: true, storeName: "Nour" };
    const element = await StoreLayout({ children: <p>policy</p> });
    expect(isValidElement(element) && element.type === LockedFrame).toBe(true);
    const props = (element as { props: { locale: string; shell: StorefrontShell } }).props;
    expect(props.locale).toBe("en");
    expect(props.shell.storeName).toBe("Nour");
  });

  it("a locked view never renders the announcement bar (Ruling 25)", async () => {
    request.lockedView = true;
    request.shell = {
      ...FALLBACK_SHELL,
      locked: true,
      storeName: "Nour",
      header: {
        sticky: false,
        menu: [],
        announcement: {
          id: "00000000-0000-4000-8000-0000000000a1",
          type: "announcement_bar",
          settings: { text: { en: "Secret sale" }, link: null, style: "dark" },
        },
      },
    };
    const element = await StoreLayout({ children: <p>policy</p> });
    expect(isValidElement(element) && element.type === LockedFrame).toBe(true);
    render(element);
    expect(screen.getByText("policy")).toBeInTheDocument();
    expect(screen.queryByText("Secret sale")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("a locked view with a failed shell read (FALLBACK_SHELL, unlocked) still gets no chrome", async () => {
    request.lockedView = true;
    request.shell = FALLBACK_SHELL;
    const element = await StoreLayout({ children: <p>policy</p> });
    expect(isValidElement(element) && element.type === LockedFrame).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
  });
});
