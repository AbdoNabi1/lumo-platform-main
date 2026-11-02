import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
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
const { default: StoreLayout } = await import("./layout");

async function chromeProps(mode: StorefrontShell["mode"], token: string | null) {
  request.shell = { ...FALLBACK_SHELL, mode };
  request.token = token;
  const element = await StoreLayout({ children: <p>page</p> });
  expect(isValidElement(element) && element.type === StoreChrome).toBe(true);
  return (element as { props: { previewToken: string | null; locale: string } }).props;
}

describe("StoreLayout preview gate", () => {
  it("passes the token on only when the shell really is a preview", async () => {
    expect((await chromeProps("preview", "tok")).previewToken).toBe("tok");
  });

  it("drops a token the shell did not honour (invalid, expired, or a failed read)", async () => {
    expect((await chromeProps("live", "tok")).previewToken).toBeNull();
  });

  it("has no token for an ordinary visit", async () => {
    const props = await chromeProps("live", null);
    expect(props.previewToken).toBeNull();
    expect(props.locale).toBe("en");
  });
});
