import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { formatCurrency } from "@/lib/format";
import type { CheckoutLinkPreview } from "@/lib/runtime-api";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

// React's per-request `cache`, stood in for by a memo the tests can clear between "requests".
const requestMemo = vi.hoisted(() => new Map<string, unknown>());
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cache:
    <A extends string[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      const key = `${fn.name}:${args.join("|")}`;
      if (!requestMemo.has(key)) requestMemo.set(key, fn(...args));
      return requestMemo.get(key) as R;
    },
}));

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    }),
}));
const getCheckoutLinkPreview = vi.hoisted(() => vi.fn());
const claimApi = vi.hoisted(() => vi.fn());
vi.mock("@/lib/runtime-api", () => ({ getCheckoutLinkPreview, claimCheckoutLink: claimApi }));
const claimAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ claimCheckoutLink: claimAction }));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));

const { default: CheckoutLinkPage, generateMetadata, dynamic } = await import("./page");

const TOKEN = "b".repeat(43);
const PREVIEW: CheckoutLinkPreview = {
  purpose: "recovery",
  shopName: "Sara Shop",
  itemCount: 3,
  items: [
    { title: "T-shirt", variantTitle: "L", quantity: 2, imageUrl: null },
    { title: null, variantTitle: null, quantity: 1, imageUrl: null },
  ],
  totalMinor: 59000,
  currency: "EGP",
};

async function renderPage(token = TOKEN, error?: string) {
  render(
    await CheckoutLinkPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve(error === undefined ? {} : { error }),
    }),
  );
}

beforeEach(() => {
  requestMemo.clear();
  jar.clear();
  getCheckoutLinkPreview.mockReset();
  claimApi.mockReset();
  claimAction.mockReset();
});

describe("/c/[token] (order operations Part 3)", () => {
  it("shows the shop, the items, the total and one Continue button — and claims nothing on render", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: PREVIEW });
    await renderPage();
    expect(getCheckoutLinkPreview).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByRole("heading", { name: en.recovery.title })).toBeInTheDocument();
    expect(screen.getByText("Sara Shop").tagName).toBe("BDI");
    expect(screen.getByText(/Your order from/).textContent).toBe("Your order from Sara Shop");
    expect(screen.getByText("T-shirt")).toBeInTheDocument();
    expect(screen.getByText(en.recovery.itemFallback)).toBeInTheDocument();
    // Intl puts a no-break space after the code; Testing Library collapses it to a plain space.
    const total = formatCurrency("en", 59000, "EGP").replace(/\s+/g, " ");
    expect(screen.getByText(total)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.recovery.continue })).toBeInTheDocument();
    expect(claimApi).not.toHaveBeenCalled();
    expect(claimAction).not.toHaveBeenCalled();
  });

  it("an invalid link shows the friendly panel with a way back to the shop", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 404, body: null });
    await renderPage();
    expect(screen.getByRole("heading", { name: en.recovery.invalidTitle })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.recovery.backToShop })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: en.recovery.continue })).toBeNull();
  });

  it("a malformed token is invalid without asking the API", async () => {
    await renderPage("not-a-token");
    expect(getCheckoutLinkPreview).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: en.recovery.invalidTitle })).toBeInTheDocument();
  });

  it("explains a failed claim", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: PREVIEW });
    await renderPage(TOKEN, "unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent(en.recovery.errors.unavailable);
  });

  it("the shop name stays isolated inside the sentence in Arabic too", async () => {
    jar.set("morbeh-storefront-locale", "ar");
    getCheckoutLinkPreview.mockResolvedValue({
      status: 200,
      body: { ...PREVIEW, shopName: "Nile Store 2" },
    });
    await renderPage();
    expect(screen.getByText("Nile Store 2").tagName).toBe("BDI");
    expect(screen.getByText(/طلبك من/).textContent).toBe("طلبك من Nile Store 2");
  });

  it("the page and its metadata share one preview GET", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: PREVIEW });
    await generateMetadata({ params: Promise.resolve({ token: TOKEN }) });
    await renderPage();
    expect(getCheckoutLinkPreview).toHaveBeenCalledTimes(1);
  });

  it("Continue shows a pending state while the claim runs", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: PREVIEW });
    let finish: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    claimAction.mockImplementation(() => running);
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.recovery.continue }));
    });
    expect(screen.getByRole("button", { name: en.recovery.continuing })).toBeDisabled();
    await act(async () => {
      finish();
      await running;
    });
  });

  it("speaks Arabic", async () => {
    jar.set("morbeh-storefront-locale", "ar");
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: PREVIEW });
    await renderPage();
    expect(screen.getByRole("button", { name: ar.recovery.continue })).toBeInTheDocument();
  });

  it("the preview title names the shop and nothing personal", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: PREVIEW });
    const metadata = await generateMetadata({ params: Promise.resolve({ token: TOKEN }) });
    expect(metadata.title).toBe(`Sara Shop — ${en.recovery.metaTitle}`);
    expect(metadata.openGraph?.title).toBe(`Sara Shop — ${en.recovery.metaTitle}`);
    getCheckoutLinkPreview.mockResolvedValue({ status: 404, body: null });
    requestMemo.clear();
    expect((await generateMetadata({ params: Promise.resolve({ token: TOKEN }) })).title).toBe(
      en.recovery.metaTitle,
    );
  });

  it("is never cached or indexed, and never sends the token on as a Referer", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: PREVIEW });
    const metadata = await generateMetadata({ params: Promise.resolve({ token: TOKEN }) });
    expect(dynamic).toBe("force-dynamic");
    expect(metadata.referrer).toBe("no-referrer");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
