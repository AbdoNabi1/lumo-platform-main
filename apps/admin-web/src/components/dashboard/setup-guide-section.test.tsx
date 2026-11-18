import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { dictionaryFor } from "@/lib/i18n";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({
  fetchProductsPage: vi.fn(),
  fetchShippingZones: vi.fn(),
  fetchPaymentSettings: vi.fn(),
  fetchMyDomains: vi.fn(),
  fetchRecentOrders: vi.fn(),
  fetchStoreSettings: vi.fn(),
}));

vi.mock("@/lib/api/products", () => ({ fetchProductsPage: api.fetchProductsPage }));
vi.mock("@/lib/api/shipping-zones", () => ({ fetchShippingZones: api.fetchShippingZones }));
vi.mock("@/lib/api/payments", () => ({ fetchPaymentSettings: api.fetchPaymentSettings }));
vi.mock("@/lib/api/store-domains", () => ({ fetchMyDomains: api.fetchMyDomains }));
vi.mock("@/lib/api/orders", () => ({ fetchRecentOrders: api.fetchRecentOrders }));
vi.mock("@/lib/api/store-settings", () => ({ fetchStoreSettings: api.fetchStoreSettings }));
vi.mock("@/app/setup-guide-actions", () => ({ dismissSetupGuideAction: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { SetupGuideSection } = await import("./setup-guide-section");

const failure = { outcome: "error", message: "boom" };
const customDomain = {
  id: "d1",
  shopId: "s1",
  hostname: "shop.example.com",
  kind: "custom",
  status: "verified",
  isPrimary: true,
  verifiedAt: "2026-10-01T00:00:00.000Z",
};
const settings = (dismissedAt?: string | null) => ({
  outcome: "ok",
  settings: {
    storeName: "Shop",
    contactEmail: null,
    currency: "EGP",
    timezone: "Africa/Cairo",
    weightUnit: "kg",
    ...(dismissedAt === undefined ? {} : { setupGuideDismissedAt: dismissedAt }),
  },
});

beforeEach(() => {
  api.fetchProductsPage.mockReset().mockResolvedValue({ outcome: "ok", items: [], pageInfo: {} });
  api.fetchShippingZones.mockReset().mockResolvedValue({ outcome: "ok", zones: [] });
  api.fetchPaymentSettings
    .mockReset()
    .mockResolvedValue({ outcome: "ok", settings: { enabledMethods: [], methods: {} } });
  api.fetchMyDomains.mockReset().mockResolvedValue({ outcome: "ok", domains: [] });
  api.fetchRecentOrders.mockReset().mockResolvedValue({ outcome: "ok", orders: [] });
  api.fetchStoreSettings.mockReset().mockResolvedValue(settings(null));
});
afterEach(cleanup);

async function section(options: { welcome?: boolean; locale?: "en" | "ar" } = {}) {
  const locale = options.locale ?? "en";
  render(
    await SetupGuideSection({
      t: locale === "ar" ? dictionaryFor("ar") : en,
      locale,
      welcome: options.welcome ?? false,
    }),
  );
}

describe("SetupGuideSection", () => {
  it("shows 0 of 5 for a store with nothing set up, asking for one product only", async () => {
    await section();

    expect(screen.getByText("0 of 5 tasks complete")).toBeInTheDocument();
    expect(api.fetchProductsPage).toHaveBeenCalledWith({ first: 1 });
    expect(api.fetchRecentOrders).toHaveBeenCalledWith(1);
  });

  it("derives each step from its own fact", async () => {
    api.fetchProductsPage.mockResolvedValue({
      outcome: "ok",
      items: [{ id: "p1" }],
      pageInfo: {},
    });
    api.fetchShippingZones.mockResolvedValue({ outcome: "ok", zones: [{ id: "z1" }] });
    api.fetchPaymentSettings.mockResolvedValue({
      outcome: "ok",
      settings: { enabledMethods: ["cod"], methods: {} },
    });
    api.fetchMyDomains.mockResolvedValue({ outcome: "ok", domains: [customDomain] });

    await section();

    expect(screen.getByText("4 of 5 tasks complete")).toBeInTheDocument();
  });

  it("does not count a pending custom domain or the platform subdomain", async () => {
    api.fetchMyDomains.mockResolvedValue({
      outcome: "ok",
      domains: [
        { ...customDomain, status: "pending", verifiedAt: null },
        { ...customDomain, id: "d2", kind: "platform", hostname: "shop.morbeh.app" },
      ],
    });

    await section();

    expect(screen.getByText("0 of 5 tasks complete")).toBeInTheDocument();
  });

  it("still renders when every request fails, with every step open", async () => {
    for (const fn of Object.values(api)) fn.mockResolvedValue(failure);

    await section();

    expect(screen.getByText("0 of 5 tasks complete")).toBeInTheDocument();
  });

  it("still renders when a request throws", async () => {
    api.fetchShippingZones.mockRejectedValue(new Error("network"));

    await section();

    expect(screen.getByText("0 of 5 tasks complete")).toBeInTheDocument();
  });

  it("keeps the guide but hides Dismiss when store settings are unauthorized (viewer/operator)", async () => {
    api.fetchStoreSettings.mockResolvedValue({ outcome: "unauthorized" });

    await section();

    expect(screen.getByText("0 of 5 tasks complete")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en.setupGuide.dismiss })).not.toBeInTheDocument();
  });

  it("offers Dismiss when store settings could be read", async () => {
    await section();

    expect(screen.getByRole("button", { name: en.setupGuide.dismiss })).toBeInTheDocument();
  });

  it("renders nothing once dismissed", async () => {
    api.fetchStoreSettings.mockResolvedValue(settings("2026-10-17T10:00:00.000Z"));

    await section();

    expect(screen.queryByText("Set up your store")).toBeNull();
  });

  it("renders nothing when every tracked step is done", async () => {
    api.fetchProductsPage.mockResolvedValue({ outcome: "ok", items: [{}], pageInfo: {} });
    api.fetchShippingZones.mockResolvedValue({ outcome: "ok", zones: [{}] });
    api.fetchPaymentSettings.mockResolvedValue({
      outcome: "ok",
      settings: { enabledMethods: ["cod"], methods: {} },
    });
    api.fetchMyDomains.mockResolvedValue({ outcome: "ok", domains: [customDomain] });
    api.fetchRecentOrders.mockResolvedValue({ outcome: "ok", orders: [{}] });

    await section();

    expect(screen.queryByText("Set up your store")).toBeNull();
  });

  it("greets a new merchant above the guide on ?welcome=1", async () => {
    await section({ welcome: true });

    const welcome = screen.getByText("Welcome to Morbeh — let's set up your store");
    const title = screen.getByRole("heading", { name: "Set up your store" });
    expect(welcome.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not greet without ?welcome=1", async () => {
    await section();

    expect(screen.queryByText(/Welcome to Morbeh/)).toBeNull();
  });

  it("greets in Arabic", async () => {
    await section({ welcome: true, locale: "ar" });

    expect(screen.getByText("أهلاً بيك في Morbeh — يلا نجهّز متجرك")).toBeInTheDocument();
  });
});
