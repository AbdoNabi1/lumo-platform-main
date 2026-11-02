import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoreChrome } from "@/components/store-chrome";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";

const request = vi.hoisted(() => ({
  shell: null as StorefrontShell | null,
  token: null as string | null,
}));
vi.mock("@/lib/request-locale", () => ({
  getRequestShell: async () => request.shell,
  getRequestLocale: async () => "en",
  getPreviewToken: async () => request.token,
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
    await expect(chromeProps({ mode: "live", locked: true }, "tok")).rejects.toThrow(
      "REDIRECT:/password",
    );
    await expect(
      chromeProps({ mode: "live", locked: true, previewExpired: true }, "tok"),
    ).rejects.toThrow("REDIRECT:/password");
  });

  it("a real preview of a locked store renders, and so does a cookie holder without a token", async () => {
    expect((await chromeProps({ mode: "preview", locked: true }, "tok")).previewToken).toBe("tok");
    expect((await chromeProps({ mode: "live", locked: true }, null)).previewToken).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });
});
