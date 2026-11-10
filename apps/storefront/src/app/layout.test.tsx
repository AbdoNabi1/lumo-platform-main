import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@platform/ui";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";

const current = vi.hoisted(() => ({ shell: null as StorefrontShell | null, lockedView: false }));
vi.mock("@/lib/request-locale", () => ({
  getRequestShell: async () => current.shell,
  getRequestLocale: async () => "ar",
  getLockedView: async () => current.lockedView,
}));
vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "geist" } }));
const { default: RootLayout, generateMetadata } = await import("./layout");

type Props = { readonly children?: ReactNode; readonly [key: string]: unknown };

/** Every element in a rendered tree (no React runtime needed: the layout returns plain elements). */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}

async function renderLayout(shell: StorefrontShell) {
  current.shell = shell;
  return elements(await RootLayout({ children: <p>page</p> }));
}

describe("RootLayout (Ruling 6)", () => {
  it("leaves an unbranded shop exactly as today: no brand sheet, theme not forced", async () => {
    const tree = await renderLayout(FALLBACK_SHELL);
    expect(tree.find((el) => el.type === "style")).toBeUndefined();
    const provider = tree.find((el) => el.type === ThemeProvider);
    expect(provider).toBeDefined();
    expect(provider?.props).not.toHaveProperty("forcedTheme");
    const html = tree.find((el) => el.type === "html");
    expect(html?.props).toMatchObject({ lang: "ar", dir: "rtl" });
  });

  it("gives a branded shop its validated sheet and the light theme only", async () => {
    const tree = await renderLayout({ ...FALLBACK_SHELL, branded: true });
    const style = tree.find((el) => el.type === "style");
    expect(style?.props["id"]).toBe("brand");
    expect(String(style?.props.children)).toMatch(/^:root:root:root\{--background:#/);
    const provider = tree.find((el) => el.type === ThemeProvider);
    expect(provider?.props).toHaveProperty("forcedTheme", "light");
  });
});

describe("RootLayout metadata (preflight 18)", () => {
  const secret: StorefrontShell = {
    ...FALLBACK_SHELL,
    storeName: "Nour",
    preferences: {
      homeTitle: { ar: "إطلاق سري" },
      homeMetaDescription: { ar: "مصابيح لم تصدر بعد" },
      shareImage: { url: "https://cdn.test/og.jpg", alt: null, width: 1200, height: 630 },
    },
  };

  it("an open store shows its home title, description and share image", async () => {
    current.shell = secret;
    const text = JSON.stringify(await generateMetadata());
    expect(text).toContain("إطلاق سري");
    expect(text).toContain("og.jpg");
  });

  it("a locked store leaks none of them on any page reachable while locked (404, policies)", async () => {
    current.shell = { ...secret, locked: true };
    const meta = await generateMetadata();
    const text = JSON.stringify(meta);
    expect(text).not.toContain("إطلاق سري");
    expect(text).not.toContain("مصابيح لم تصدر بعد");
    expect(text).not.toContain("og.jpg");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("the owner's preview of a locked store keeps the full metadata (it is private anyway)", async () => {
    current.shell = { ...secret, locked: true, mode: "preview" };
    const meta = await generateMetadata();
    expect(JSON.stringify(meta)).toContain("إطلاق سري");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("the locked view closes it even when the shell is stale-unlocked or the fallback (review minor 2)", async () => {
    current.lockedView = true;
    for (const shell of [secret, FALLBACK_SHELL]) {
      current.shell = shell;
      const meta = await generateMetadata();
      const text = JSON.stringify(meta);
      expect(text).not.toContain("إطلاق سري");
      expect(text).not.toContain("مصابيح لم تصدر بعد");
      expect(text).not.toContain("og.jpg");
      expect(meta.robots).toEqual({ index: false, follow: false });
    }
    current.lockedView = false;
  });

  it("an unlocked store's preview is not indexed either (final review M-1)", async () => {
    current.shell = { ...secret, mode: "preview" };
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: false });
  });
});
