import { describe, expect, it } from "vitest";
import { chooseLocale, TEMPLATE_CATALOGUE } from "./template-catalogue";
import { escapeHtml, formatMoney, renderTemplate, type OrderBlockData } from "./template-renderer";

const order: OrderBlockData = {
  currency: "EGP",
  lines: [
    {
      name: "<script>alert(1)</script> Shirt",
      variantTitle: "M & L",
      quantity: 2,
      unitAmountMinor: 45000,
    },
  ],
  subtotalMinor: 90000,
  shippingMinor: 5000,
  totalMinor: 95000,
};

function render(overrides: Partial<Parameters<typeof renderTemplate>[0]> = {}) {
  const definition = TEMPLATE_CATALOGUE.order_confirmation;
  return renderTemplate({
    subject: definition.defaults.en.subject,
    body: definition.defaults.en.body,
    locale: "en",
    storeName: "Nusuj",
    variables: { order_number: "#1", customer_name: "Sara", store_name: "Nusuj" },
    catalogueVariables: definition.variables,
    order,
    ...overrides,
  });
}

describe("renderTemplate", () => {
  it("escapes a <script> in a product name inside the line-items block", () => {
    expect.hasAssertions();
    const rendered = render();
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Shirt");
    expect(rendered.html).toContain("M &amp; L");
  });

  it("escapes every variable value, and the store name, in the HTML part", () => {
    expect.hasAssertions();
    const rendered = render({
      storeName: "<img src=x onerror=1>",
      variables: { order_number: "#1", customer_name: '"><b>x</b>', store_name: "a&b" },
    });
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).not.toContain("<b>x</b>");
    expect(rendered.html).toContain("&quot;&gt;&lt;b&gt;x&lt;/b&gt;");
    expect(rendered.html).toContain("a&amp;b");
  });

  it("treats the merchant's own body as plain text, never HTML", () => {
    expect.hasAssertions();
    const rendered = render({ body: "<h1>Hi</h1> {{customer_name}}\nline two" });
    expect(rendered.html).not.toContain("<h1>");
    expect(rendered.html).toContain("&lt;h1&gt;Hi&lt;/h1&gt; Sara<br>line two");
  });

  it("renders an unknown variable as nothing and reports it", () => {
    expect.hasAssertions();
    const rendered = render({ body: "A {{nope}} B {{order_number}}", subject: "S {{also_nope}}" });
    expect(rendered.html).toContain("A  B #1");
    expect(rendered.text).toBe("A  B #1");
    expect(rendered.subject).toBe("S");
    expect([...rendered.unknownVariables].sort()).toEqual(["also_nope", "nope"]);
  });

  it("renders a known variable with no value as nothing without reporting it", () => {
    expect.hasAssertions();
    const rendered = render({ body: "x{{customer_name}}y", variables: {} });
    expect(rendered.text).toBe("xy");
    expect(rendered.unknownVariables).toEqual([]);
  });

  it("keeps a CR/LF out of the subject so it cannot start a new header", () => {
    expect.hasAssertions();
    const rendered = render({
      subject: "Order {{customer_name}}",
      variables: { customer_name: "Sara\r\nBcc: attacker@example.com" },
    });
    expect(rendered.subject).not.toMatch(/[\r\n]/);
    expect(rendered.subject).toBe("Order Sara Bcc: attacker@example.com");
  });

  it("leaves a block out of the subject", () => {
    expect.hasAssertions();
    expect(render({ subject: "x {{line_items}} y" }).subject).toBe("x y");
  });

  it("links an http(s) url variable and keeps anything else inert", () => {
    expect.hasAssertions();
    const definition = TEMPLATE_CATALOGUE.shipping_confirmation;
    const run = (url: string) =>
      renderTemplate({
        subject: "s",
        body: "{{tracking_url}}",
        locale: "en",
        storeName: "S",
        variables: { tracking_url: url },
        catalogueVariables: definition.variables,
      });
    expect(run("https://example.com/t?a=1&b=2").html).toContain(
      '<a href="https://example.com/t?a=1&amp;b=2">https://example.com/t?a=1&amp;b=2</a>',
    );
    expect(run("javascript:alert(1)").html).not.toContain("<a ");
    expect(run('https://x.com/"onmouseover="x').html).not.toContain('"onmouseover');
  });

  it("writes Arabic mail right-to-left with Arabic default copy", () => {
    expect.hasAssertions();
    const definition = TEMPLATE_CATALOGUE.order_confirmation;
    const rendered = render({
      locale: "ar",
      subject: definition.defaults.ar.subject,
      body: definition.defaults.ar.body,
    });
    expect(rendered.html).toContain('lang="ar" dir="rtl"');
    expect(rendered.subject).toBe("تم تأكيد طلبك #1");
  });

  it("builds the order totals block with a store-currency amount", () => {
    expect.hasAssertions();
    const rendered = render({ body: "{{order_totals}}" });
    expect(rendered.text).toContain("Total:");
    expect(rendered.text).toContain("950");
  });
});

describe("chooseLocale", () => {
  it("prefers the customer's language, then the store default, then English", () => {
    expect.hasAssertions();
    expect(chooseLocale("ar", "en")).toBe("ar");
    expect(chooseLocale("en-GB", "ar")).toBe("en");
    expect(chooseLocale(null, "ar")).toBe("ar");
    expect(chooseLocale("fr", "de")).toBe("en");
    expect(chooseLocale(undefined, undefined)).toBe("en");
  });
});

describe("formatMoney / escapeHtml", () => {
  it("formats minor units with the currency's own digits", () => {
    expect.hasAssertions();
    expect(formatMoney(125000, "EGP", "en")).toMatch(/1,250\.00/);
    expect(formatMoney(500, "JPY", "en")).toMatch(/500/);
  });

  it("escapes the five HTML-significant characters", () => {
    expect.hasAssertions();
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
