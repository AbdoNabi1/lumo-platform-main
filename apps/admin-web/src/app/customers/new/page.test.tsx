import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";

const mocks = vi.hoisted(() => ({ cookieLocale: { value: undefined as string | undefined } }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => null }));
vi.mock("@/components/app-shell", () => ({ AppShell: () => null }));
vi.mock("@/components/customers/customer-form", () => ({ CustomerForm: () => null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () =>
      mocks.cookieLocale.value === undefined ? undefined : { value: mocks.cookieLocale.value },
  }),
}));

const { default: NewCustomerPage } = await import("./page");
const { CustomerForm } = await import("@/components/customers/customer-form");
const { AppShell } = await import("@/components/app-shell");

function findAll(node: ReactNode, match: (element: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, match));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [...(match(element) ? [element] : []), ...findAll(element.props.children, match)];
}

beforeEach(() => {
  expect.hasAssertions();
  mocks.cookieLocale.value = undefined;
});

describe("NewCustomerPage", () => {
  it("renders the form inside the shell with Customers as the active item, titled New customer", async () => {
    const tree = await NewCustomerPage();

    expect(tree.type).toBe(AppShell);
    expect(tree.props).toMatchObject({ activeNavId: "customers" });
    const heading = findAll(tree, (element) => element.type === "h1")[0];
    expect((heading?.props as { children: unknown }).children).toBe("New customer");
    expect(findAll(tree, (element) => element.type === CustomerForm)).toHaveLength(1);
  });

  it("speaks the shop's language and mirrors the back arrow", async () => {
    mocks.cookieLocale.value = "ar";

    const tree = await NewCustomerPage();

    const heading = findAll(tree, (element) => element.type === "h1")[0];
    expect((heading?.props as { children: unknown }).children).toBe(ar.customerForm.newTitle);
    const arrow = findAll(tree, (element) =>
      String((element.props as { className?: string }).className ?? "").includes("rtl:rotate-180"),
    );
    expect(arrow).toHaveLength(1);
  });
});
