import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  cookieLocale: { value: undefined as string | undefined },
}));

vi.mock("@/lib/auth/session", () => ({
  readSession: mocks.readSession,
  highestRole: (roles: readonly string[]) =>
    (["admin", "operator", "viewer"] as const).find((role) => roles.includes(role)),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => null }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, activeNavId }: { children: ReactNode; activeNavId: string }) => (
    <div data-testid="shell" data-active={activeNavId}>
      {children}
    </div>
  ),
}));
// The results are an async server component with its own tests; here they are a probe of the props
// the page hands down.
vi.mock("@/components/content/files/files-results", () => ({
  FilesResults: (props: Record<string, unknown>) => (
    <div data-testid="results" data-props={JSON.stringify({ ...props, t: undefined })} />
  ),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () =>
      mocks.cookieLocale.value === undefined ? undefined : { value: mocks.cookieLocale.value },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/content/files",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/content/files/actions", () => ({ uploadFileAction: vi.fn() }));
vi.mock("@/lib/media/prepare-image", () => ({ prepareImage: vi.fn() }));

const { default: FilesPage } = await import("./page");

async function renderPage(params: Record<string, string> = {}) {
  render(await FilesPage({ searchParams: Promise.resolve(params) }));
  const probe = await screen.findByTestId("results");
  return JSON.parse(probe.getAttribute("data-props") ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
  expect.hasAssertions();
  mocks.readSession.mockReset();
  mocks.cookieLocale.value = undefined;
});

describe("FilesPage", () => {
  it("is titled Files, marks the Files nav item current, and defaults to newest and grid", async () => {
    mocks.readSession.mockResolvedValue({ roles: ["operator"] });

    const props = await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Files" })).toBeInTheDocument();
    expect(screen.getByTestId("shell")).toHaveAttribute("data-active", "content-files");
    expect(props).toMatchObject({ q: "", sort: "newest", view: "grid", canEdit: true });
    expect(props["after"]).toBeUndefined();
  });

  it("passes q, sort, view and the cursor through, and clamps q to 100 characters", async () => {
    mocks.readSession.mockResolvedValue({ roles: ["admin"] });

    const props = await renderPage({
      q: ` ${"x".repeat(150)} `,
      sort: "oldest",
      view: "list",
      after: "c9",
      stack: "c1,c2",
    });

    expect(props).toMatchObject({ q: "x".repeat(100), sort: "oldest", view: "list", after: "c9" });
  });

  it("falls back to newest and grid for unknown sort or view values", async () => {
    mocks.readSession.mockResolvedValue({ roles: ["admin"] });

    const props = await renderPage({ sort: "size", view: "cards", after: "" });

    expect(props).toMatchObject({ sort: "newest", view: "grid" });
    expect(props["after"]).toBeUndefined();
  });

  it("speaks Arabic from the locale cookie", async () => {
    mocks.readSession.mockResolvedValue({ roles: ["operator"] });
    mocks.cookieLocale.value = "ar";

    const props = await renderPage();

    expect(props["locale"]).toBe("ar");
    expect(screen.getByRole("heading", { level: 1, name: "الملفات" })).toBeInTheDocument();
  });

  it.each([
    ["an operator", { roles: ["operator"] }, true],
    ["an admin", { roles: ["viewer", "admin"] }, true],
    ["a viewer", { roles: ["viewer"] }, false],
    ["an unknown role", { roles: ["intern"] }, false],
    ["no roles", { roles: [] }, false],
    ["no session", null, false],
  ])("%s: canEdit is %s for the results and the toolbar", async (_label, session, canEdit) => {
    mocks.readSession.mockResolvedValue(session);

    const props = await renderPage();

    expect(props["canEdit"]).toBe(canEdit);
    const upload = screen.queryByRole("button", { name: "Upload files" });
    expect(upload !== null).toBe(canEdit);
    expect(document.body.querySelector('input[type="file"]') !== null).toBe(canEdit);
  });
});
