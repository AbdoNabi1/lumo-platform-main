import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { default: SignupPage } = await import("./page");

async function renderPage(error?: string) {
  const ui = await SignupPage({ searchParams: Promise.resolve(error ? { error } : {}) });
  return render(ui);
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("AUTH_MODE", "native");
  vi.stubEnv("ADMIN_SIGNUP_ENABLED", "1");
});

describe("/signup", () => {
  it("is a 404 when sign-up is not enabled", async () => {
    vi.stubEnv("ADMIN_SIGNUP_ENABLED", "");
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is a 404 when sign-in is not native", async () => {
    vi.stubEnv("AUTH_MODE", "oidc");
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the form posting to /auth/signup with the three countries, Egypt first", async () => {
    const { container } = await renderPage();
    const form = container.querySelector("form");
    expect(form?.getAttribute("action")).toBe("/auth/signup");
    expect(form?.getAttribute("method")).toBe("post");
    expect(container.querySelector("input[name=storeName]")).not.toBeNull();
    expect(container.querySelector("input[name=email][type=email]")).not.toBeNull();
    const password = container.querySelector("input[name=password]");
    expect(password?.getAttribute("type")).toBe("password");
    expect(password?.getAttribute("minlength")).toBe("8");
    const options = [...container.querySelectorAll("select[name=country] option")];
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["EG", "SA", "AE"]);
    expect(screen.getByRole("button", { name: /Create store/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /Already have a store/ }).getAttribute("href")).toBe(
      "/login",
    );
  });

  it("asks what the merchant is building, before the country, with neither option chosen", async () => {
    const { container } = await renderPage();
    const group = screen.getByRole("group", { name: "What are you building? / بتعمل إيه؟" });
    expect(group.tagName).toBe("FIELDSET");
    const country = container.querySelector("select[name=country]")!;
    expect(group.compareDocumentPosition(country) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const radios = [...group.querySelectorAll<HTMLInputElement>("input[type=radio]")];
    expect(radios.map((r) => [r.name, r.value, r.checked])).toEqual([
      ["siteType", "store", false],
      ["siteType", "lead_site", false],
    ]);
    expect(radios.map((r) => r.required)).toEqual([true, false]);
    expect(screen.getByRole("radio", { name: "Online store / متجر إلكتروني" })).toBe(radios[0]);
    expect(screen.getByRole("radio", { name: "Lead website / موقع لجمع العملاء" })).toBe(radios[1]);
    expect(
      screen.getByText(
        "Sell products with a cart and cash on delivery / بيع منتجات بسلة ودفع عند الاستلام",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Collect enquiries through a form, WhatsApp and calls / استقبل طلبات العملاء من فورم وواتساب واتصال",
      ),
    ).toBeDefined();
    expect(
      screen.getByText("You can't change this later / مش هتقدر تغيّر النوع بعد كده"),
    ).toBeDefined();
  });

  it("makes the whole card the label of its radio", async () => {
    await renderPage();
    for (const name of ["Online store / متجر إلكتروني", "Lead website / موقع لجمع العملاء"]) {
      const radio = screen.getByRole("radio", { name });
      expect(radio.closest("label")?.tagName).toBe("LABEL");
    }
  });

  it("shows the site-type error", async () => {
    await renderPage("site-type");
    expect(screen.getByRole("alert").textContent).toBe(
      "Choose what you're building / اختار نوع موقعك",
    );
  });

  it.each([
    ["taken", /already has a store/],
    ["limited", /Too many attempts/],
    ["invalid", /Check your details/],
    ["unavailable", /isn't available right now/],
  ])("shows the %s error", async (error, text) => {
    await renderPage(error);
    expect(screen.getByRole("alert").textContent).toMatch(text);
  });

  it("locks the Create store button once the form submits (no double sign-up)", async () => {
    const { container } = await renderPage();
    act(() => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(screen.getByRole("button", { name: /Creating your store/ })).toBeDisabled();
  });

  it("shows no alert for an unknown error code", async () => {
    await renderPage("bogus");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
