import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@platform/ui";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";

const current = vi.hoisted(() => ({ shell: null as StorefrontShell | null }));
vi.mock("@/lib/request-locale", () => ({
  getRequestShell: async () => current.shell,
  getRequestLocale: async () => "ar",
}));
vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "geist" } }));
const { default: RootLayout } = await import("./layout");

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
