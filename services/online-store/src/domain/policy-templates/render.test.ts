import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOCALES,
  parseRichText,
  POLICY_TYPES,
  RICH_TEXT_MAX,
  validateRichText,
} from "@platform/storefront-content";
import * as ar from "./ar";
import * as en from "./en";
import { renderPolicyTemplate } from "./render";
import {
  DEFAULT_TEMPLATE_INPUTS,
  readTemplateInputs,
  type PolicyTemplateInputs,
} from "./template-inputs";

const inputs = (over: Partial<PolicyTemplateInputs> = {}): PolicyTemplateInputs => ({
  ...DEFAULT_TEMPLATE_INPUTS,
  storeName: "Nour",
  contactEmail: "hello@nour.example",
  contactPhone: "+20 100 123 4567",
  businessAddress: "12 Tahrir St, Cairo",
  ...over,
});

describe("policy templates (spec 2.3)", () => {
  it.each(POLICY_TYPES.flatMap((type) => LOCALES.map((locale) => [type, locale] as const)))(
    "%s/%s renders clean Morbeh text with no placeholder left",
    (type, locale) => {
      const body = renderPolicyTemplate(type, locale, inputs());
      expect(body.length).toBeGreaterThan(80);
      expect(body).not.toMatch(/\{[a-zA-Z]+\}/);
      expect(validateRichText(body, RICH_TEXT_MAX.body)).toEqual([]);
    },
  );

  it("the refund window defaults to 14 days and follows the input", () => {
    expect(renderPolicyTemplate("refund", "en", inputs())).toContain("within 14 days");
    expect(renderPolicyTemplate("refund", "ar", inputs({ returnWindowDays: 30 }))).toContain("30");
  });

  it("a store name with markup and a link stays text (Review Focus 3)", () => {
    for (const locale of LOCALES) {
      const body = renderPolicyTemplate(
        "privacy",
        locale,
        inputs({ storeName: "Evil](javascript:alert(1)) **x** #" }),
      );
      const doc = JSON.stringify(parseRichText(body).document);
      expect(doc).not.toContain('"type":"link"');
      expect(doc).toContain("Evil](javascript:alert(1)) **x** #");
    }
  });

  it("a line with an empty value is dropped; {contact} falls back to the store (Ruling 21)", () => {
    const contact = renderPolicyTemplate(
      "contact",
      "en",
      inputs({ contactEmail: "", businessAddress: "" }),
    );
    expect(contact).not.toContain("Email:");
    expect(contact).not.toContain("Address:");
    expect(contact).toContain("+20 100 123 4567");
    const refund = renderPolicyTemplate(
      "refund",
      "ar",
      inputs({ contactEmail: "", contactPhone: "" }),
    );
    expect(refund).toContain("عبر متجرنا");
  });

  it("an empty store name falls back to the store sentence and drops no line (preflight 18)", () => {
    for (const [type, locale, fallback] of [
      ["privacy", "en", "When you order from our store, we collect"],
      ["terms", "en", "every purchase from our store"],
      ["contact", "en", "## Contact our store"],
      ["privacy", "ar", "عند الطلب من متجرنا نجمع"],
      ["terms", "ar", "كل عملية شراء من متجرنا"],
      ["contact", "ar", "## التواصل مع متجرنا"],
    ] as const) {
      expect(renderPolicyTemplate(type, locale, inputs({ storeName: "" }))).toContain(fallback);
      expect(renderPolicyTemplate(type, locale, inputs({ storeName: " \n " }))).toContain(fallback);
    }
  });

  it("a contact policy with no values says so instead of a bare heading, in both languages", () => {
    const none = inputs({ contactEmail: "", contactPhone: "", businessAddress: "" });
    expect(renderPolicyTemplate("contact", "en", none)).toContain(
      "Contact details are coming soon.",
    );
    expect(renderPolicyTemplate("contact", "ar", none)).toContain("تفاصيل التواصل ستتوفر قريباً.");
    expect(renderPolicyTemplate("contact", "en", inputs())).not.toContain("coming soon");
  });

  it("the English contact fallback reads naturally", () => {
    const body = renderPolicyTemplate(
      "shipping",
      "en",
      inputs({ contactEmail: "", contactPhone: "" }),
    );
    expect(body).toContain("contact us via our store.");
  });

  it("the conditional sentences follow the inputs", () => {
    expect(renderPolicyTemplate("shipping", "en", inputs({ cashOnDelivery: false }))).toContain(
      "Orders are paid online at checkout.",
    );
    expect(
      renderPolicyTemplate("shipping", "en", inputs({ shipsInternationally: true })),
    ).toContain("We also ship outside the country.");
    expect(
      renderPolicyTemplate(
        "refund",
        "en",
        inputs({ refundMethod: "store_credit", returnShippingPaidBy: "store" }),
      ),
    ).toMatch(
      /store credit[\s\S]*We pay the cost of return shipping|We pay the cost of return shipping[\s\S]*store credit/,
    );
  });

  it("no merchant value ever starts a line in the template sources (Ruling 21)", () => {
    for (const file of ["en.ts", "ar.ts"]) {
      const source = readFileSync(join(import.meta.dirname, file), "utf-8");
      for (const line of source.split(/\r?\n/)) {
        expect(line, `${file}: ${line}`).not.toMatch(
          /^\s*\{(?:storeName|email|phone|address|contact)\}/,
        );
      }
    }
  });

  it("no template puts two placeholders side by side at the start of a line (Ruling 1)", () => {
    // Two escaped values next to each other can still form a list marker ("12" + ". x").
    for (const [name, templates] of [
      ["en", en.TEMPLATES],
      ["ar", ar.TEMPLATES],
    ] as const) {
      for (const type of POLICY_TYPES) {
        for (const line of templates[type].split(/\r?\n/)) {
          expect(line, `${name}/${type}: ${line}`).not.toMatch(
            /^\s*(?:[-*]\s+|\d+[.)]\s+)?\{[a-zA-Z]+\}\s*\{[a-zA-Z]+\}/,
          );
          expect(line, `${name}/${type}: ${line}`).not.toMatch(/\}\{/);
        }
      }
    }
  });

  it("list-marker values stay text wherever they land", () => {
    for (const locale of LOCALES) {
      for (const type of POLICY_TYPES) {
        const body = renderPolicyTemplate(
          type,
          locale,
          inputs({
            storeName: "12",
            businessAddress: ". x",
            contactEmail: "- y",
            contactPhone: "---",
          }),
        );
        const shape = (text: string) =>
          parseRichText(text).document.blocks.map((block) => block.type);
        // The same block structure as a benign render: no value introduced a list or a rule.
        expect(shape(body)).toEqual(shape(renderPolicyTemplate(type, locale, inputs())));
      }
    }
  });
});

describe("readTemplateInputs", () => {
  it("absent keys take the defaults", () => {
    expect(readTemplateInputs({})).toEqual({ ok: true, value: DEFAULT_TEMPLATE_INPUTS });
  });
  it("refuses out-of-range numbers, bad enums, long text and unknown keys", () => {
    const out = readTemplateInputs({
      returnWindowDays: 366,
      deliveryDays: { min: 5, max: 2 },
      refundMethod: "bitcoin",
      storeName: "n".repeat(121),
      extra: true,
    });
    expect(out.ok ? [] : out.issues).toEqual(
      expect.arrayContaining([
        { path: "inputs.returnWindowDays", code: "OUT_OF_RANGE" },
        { path: "inputs.deliveryDays.max", code: "OUT_OF_RANGE" },
        { path: "inputs.refundMethod", code: "INVALID_VALUE" },
        { path: "inputs.storeName", code: "TOO_LONG" },
        { path: "inputs.extra", code: "UNKNOWN_KEY" },
      ]),
    );
  });
  it("refuses wrong types and non-objects", () => {
    const out = readTemplateInputs({ cashOnDelivery: "yes", returnWindowDays: "14", storeName: 5 });
    expect(out.ok ? [] : out.issues).toEqual(
      expect.arrayContaining([
        { path: "inputs.cashOnDelivery", code: "INVALID_VALUE" },
        { path: "inputs.returnWindowDays", code: "INVALID_VALUE" },
        { path: "inputs.storeName", code: "INVALID_VALUE" },
      ]),
    );
    expect(readTemplateInputs([]).ok).toBe(false);
    expect(readTemplateInputs(null).ok).toBe(false);
  });
  it("normalises text and keeps valid values", () => {
    const out = readTemplateInputs({
      storeName: "  Nour\n",
      returnWindowDays: 0,
      deliveryDays: { min: 1, max: 90 },
    });
    expect(out).toEqual({
      ok: true,
      value: {
        ...DEFAULT_TEMPLATE_INPUTS,
        storeName: "Nour",
        returnWindowDays: 0,
        deliveryDays: { min: 1, max: 90 },
      },
    });
  });
});
