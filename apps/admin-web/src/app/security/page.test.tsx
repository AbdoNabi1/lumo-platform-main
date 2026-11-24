import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

/**
 * Wave 1d, O6: an invited admin (not the owner) gets 403 from every `security:*` route. The console
 * must say who may open it instead of "sign in" or a generic failure. Represented here by the
 * overview page, whose three cards load independently.
 */
const mocks = vi.hoisted(() => ({
  fetchSecurityDashboard: vi.fn(),
  fetchTrustCenter: vi.fn(),
  fetchSecurityAnalytics: vi.fn(),
  locale: { value: undefined as string | undefined },
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (mocks.locale.value === undefined ? undefined : { value: mocks.locale.value }),
    }),
}));
vi.mock("@/lib/api/security", () => ({
  fetchSecurityDashboard: mocks.fetchSecurityDashboard,
  fetchTrustCenter: mocks.fetchTrustCenter,
  fetchSecurityAnalytics: mocks.fetchSecurityAnalytics,
}));

const { default: SecurityOverviewPage } = await import("./page");

/**
 * The page is a Server Component whose cards are async components inside `Suspense`. A client test
 * renderer cannot await those, so this walks the tree and awaits every async component, leaving
 * everything else (host elements, `Suspense`, the design-system components) as it is.
 */
async function settle(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(settle));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
    const result = await (element.type as (props: unknown) => Promise<ReactNode>)(element.props);
    return settle(result);
  }
  if (element.props.children === undefined) return element;
  const children = await Promise.all(Children.toArray(element.props.children).map(settle));
  return cloneElement(element, undefined, ...children);
}

async function renderPage() {
  const tree = await SecurityOverviewPage({ searchParams: Promise.resolve({}) });
  render(<>{await settle(tree)}</>);
}

function allRead(result: unknown): void {
  mocks.fetchSecurityDashboard.mockResolvedValue(result);
  mocks.fetchTrustCenter.mockResolvedValue(result);
  mocks.fetchSecurityAnalytics.mockResolvedValue(result);
}

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
  for (const mock of Object.values(mocks)) {
    if (typeof mock === "function") mock.mockReset();
  }
  mocks.locale.value = undefined;
});

describe("/security overview on a 403", () => {
  it("every card says only the store owner can open the page, not 'sign in'", async () => {
    allRead({ outcome: "unauthorized", status: 403 });
    await renderPage();

    expect(screen.getAllByText("Only the store owner can open this page.")).toHaveLength(3);
    expect(screen.queryByText(en.securityOverviewPage.unauthorized)).toBeNull();
    expect(screen.queryByText(en.securityOverviewPage.error)).toBeNull();
  });

  it("says it in Arabic when the locale is Arabic", async () => {
    mocks.locale.value = "ar";
    allRead({ outcome: "unauthorized", status: 403 });
    await renderPage();

    expect(screen.getAllByText("يمكن لمالك المتجر فقط فتح هذه الصفحة.")).toHaveLength(3);
    expect(screen.queryByText(en.securityOwnerOnly.message)).toBeNull();
    expect(screen.queryByText(ar.securityOverviewPage.unauthorized)).toBeNull();
  });

  it("an expired session (a 401, no status) still asks to sign in", async () => {
    allRead({ outcome: "unauthorized" });
    await renderPage();

    expect(screen.getAllByText(en.securityOverviewPage.unauthorized)).toHaveLength(3);
    expect(screen.queryByText(en.securityOwnerOnly.message)).toBeNull();
  });

  it("a failed read keeps the generic error and never claims owner-only", async () => {
    allRead({ outcome: "error", message: "boom", status: 500 });
    await renderPage();

    expect(screen.getAllByText(en.securityOverviewPage.error)).toHaveLength(3);
    expect(screen.queryByText(en.securityOwnerOnly.message)).toBeNull();
    expect(screen.queryByText("boom")).toBeNull();
  });

  it("each card decides for itself: one 403 beside two good reads", async () => {
    mocks.fetchSecurityDashboard.mockResolvedValue({ outcome: "unauthorized", status: 403 });
    mocks.fetchTrustCenter.mockResolvedValue({
      outcome: "ok",
      data: {
        postureScore: 91,
        openIncidents: 0,
        criticalIncidents: 0,
        complianceControls: 4,
        auditChainValid: true,
        frameworks: [],
      },
    });
    mocks.fetchSecurityAnalytics.mockResolvedValue({ outcome: "error", message: "x" });
    await renderPage();

    expect(screen.getAllByText(en.securityOwnerOnly.message)).toHaveLength(1);
    expect(screen.getByText("91")).toBeInTheDocument();
    expect(screen.getAllByText(en.securityOverviewPage.error)).toHaveLength(1);
  });
});
