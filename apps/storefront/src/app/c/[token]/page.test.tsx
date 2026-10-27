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
  draftNumber: null,
  completed: false,
  shopName: "Sara Shop",
  itemCount: 3,
  items: [
    { title: "T-shirt", variantTitle: "L", quantity: 2, imageUrl: null },
    { title: null, variantTitle: null, quantity: 1, imageUrl: null },
  ],
  totalMinor: 59000,
  taxPending: false,
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

  it.each([
    ["the API is unreachable", 0],
    ["the API failed", 503],
    ["the API is rate limited", 429],
  ])("%s: a 'try again' state, never the expired-link view", async (_case, status) => {
    getCheckoutLinkPreview.mockResolvedValue({ status, body: null });
    await renderPage();
    expect(screen.getByRole("heading", { name: en.recovery.loadFailedTitle })).toBeInTheDocument();
    expect(screen.getByText(en.recovery.loadFailedBody)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.recovery.tryAgain })).toHaveAttribute(
      "href",
      `/c/${TOKEN}`,
    );
    expect(screen.queryByRole("heading", { name: en.recovery.invalidTitle })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says it could not load in Modern Standard Arabic too", async () => {
    jar.set("morbeh-storefront-locale", "ar");
    getCheckoutLinkPreview.mockResolvedValue({ status: 502, body: null });
    await renderPage();
    expect(screen.getByRole("heading", { name: "تعذّر تحميل هذا الرابط" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ar.recovery.tryAgain })).toBeInTheDocument();
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

describe("invoice links (order operations Part 4)", () => {
  const invoice: CheckoutLinkPreview = {
    purpose: "invoice",
    draftNumber: "D3",
    completed: false,
    shopName: "Nile Shop",
    itemCount: 2,
    items: [{ title: "Tee", variantTitle: "M", quantity: 2, imageUrl: null }],
    totalMinor: 49000,
    taxPending: false,
    currency: "EGP",
  };

  it("shows 'Invoice #D3', the shop, the total and ONE 'Pay now' button — claiming nothing on render", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: invoice });
    await renderPage();
    expect(screen.getByRole("heading", { name: "Invoice #D3" })).toBeInTheDocument();
    expect(screen.getByText("Nile Shop").tagName).toBe("BDI");
    expect(screen.getByText(en.invoice.totalNote)).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Pay now" })).toBeInTheDocument();
    expect(claimApi).not.toHaveBeenCalled();
    expect(claimAction).not.toHaveBeenCalled();
  });

  it("a total Finance could not tax yet is 'Total before tax', never a lower 'Total' (M-4)", async () => {
    getCheckoutLinkPreview.mockResolvedValue({
      status: 200,
      body: { ...invoice, taxPending: true },
    });
    await renderPage();
    expect(screen.getByText(en.invoice.totalBeforeTax)).toBeInTheDocument();
    expect(screen.queryByText(en.recovery.total)).toBeNull();
    expect(screen.getByText(en.invoice.taxPendingNote)).toBeInTheDocument();
    const total = formatCurrency("en", 49000, "EGP").replace(/\s+/g, " ");
    expect(screen.getByText(total)).toBeInTheDocument();
  });

  it("says 'Total before tax' in Modern Standard Arabic", async () => {
    jar.set("morbeh-storefront-locale", "ar");
    getCheckoutLinkPreview.mockResolvedValue({
      status: 200,
      body: { ...invoice, taxPending: true },
    });
    await renderPage();
    expect(screen.getByText("الإجمالي قبل الضريبة")).toBeInTheDocument();
    expect(screen.queryByText(ar.recovery.total)).toBeNull();
  });

  it("a taxed total keeps the plain 'Total' label", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: invoice });
    await renderPage();
    expect(screen.getByText(en.recovery.total)).toBeInTheDocument();
    expect(screen.queryByText(en.invoice.totalBeforeTax)).toBeNull();
  });

  it("a completed invoice says the order was already placed, with no button", async () => {
    getCheckoutLinkPreview.mockResolvedValue({
      status: 200,
      body: { ...invoice, completed: true },
    });
    await renderPage();
    expect(screen.getByText("This order has already been placed")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: en.recovery.backToShop })).toHaveAttribute("href", "/");
  });

  it("a claim that finds the order placed meanwhile shows the already-placed page, not the card", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: invoice });
    await renderPage(TOKEN, "completed");
    expect(screen.getByText(en.invoice.completedTitle)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["notReady", en.recovery.errors.notReady],
    ["busy", en.recovery.errors.busy],
    ["tooLarge", en.recovery.errors.tooLarge],
    ["outOfStock", en.recovery.errors.outOfStock],
    ["unavailable", en.recovery.errors.unavailable],
    ["network", en.recovery.errors.network],
  ])("explains a failed claim (%s) calmly and keeps the button", async (error, copy) => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: invoice });
    await renderPage(TOKEN, error);
    expect(screen.getByRole("alert")).toHaveTextContent(copy);
    expect(screen.getByRole("button", { name: "Pay now" })).toBeInTheDocument();
  });

  it("a revoked link or deleted draft (LINK_INVALID) shows the invalid view", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 404, body: null });
    await renderPage();
    expect(screen.getByRole("heading", { name: en.recovery.invalidTitle })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("speaks Modern Standard Arabic, with the draft number isolated inside the sentence", async () => {
    jar.set("morbeh-storefront-locale", "ar");
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: invoice });
    await renderPage();
    expect(screen.getByRole("button", { name: "ادفع الآن" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "فاتورة #D3" })).toBeInTheDocument();
    expect(screen.getByText("#D3").tagName).toBe("BDI");
    expect(screen.getByText("Nile Shop").tagName).toBe("BDI");
  });

  it("the preview title is generic: the shop and 'invoice', no draft number or personal data", async () => {
    getCheckoutLinkPreview.mockResolvedValue({ status: 200, body: invoice });
    const metadata = await generateMetadata({ params: Promise.resolve({ token: TOKEN }) });
    expect(metadata.title).toBe(`Nile Shop — ${en.invoice.metaTitle}`);
    expect(metadata.openGraph?.title).toBe(`Nile Shop — ${en.invoice.metaTitle}`);
    expect(JSON.stringify(metadata)).not.toContain("D3");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
    expect(claimApi).not.toHaveBeenCalled();
  });
});
