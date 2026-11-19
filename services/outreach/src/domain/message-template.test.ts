import { describe, expect, it } from "vitest";
import {
  bodyVariableCount,
  toMetaComponents,
  validateTemplateDraft,
  type TemplateButton,
  type TemplateDraft,
  type TemplateIssue,
} from "./message-template";

const utility: TemplateDraft = {
  name: "order_shipped",
  language: "en",
  category: "UTILITY",
  body: { text: "Hi {{1}}, your order {{2}} has shipped.", examples: ["Sara", "1001"] },
};

const marketing: TemplateDraft = {
  name: "summer_sale",
  language: "ar",
  category: "MARKETING",
  header: { format: "TEXT", text: "Sale for {{1}}", example: "Sara" },
  body: { text: "Get 20% off with code {{1}} this week only.", examples: ["SUMMER20"] },
  footer: { text: "Reply STOP to opt out" },
  buttons: [
    { type: "QUICK_REPLY", text: "Tell me more" },
    { type: "QUICK_REPLY", text: "No thanks" },
  ],
};

function withBody(text: string, examples: string[]): TemplateDraft {
  return { ...utility, body: { text, examples } };
}
function withButtons(buttons: TemplateButton[]): TemplateDraft {
  return { ...utility, buttons };
}
const qr = (text = "Yes"): TemplateButton => ({ type: "QUICK_REPLY", text });
const url = (
  u = "https://shop.example.com/orders",
  extra: Partial<TemplateButton> = {},
): TemplateButton => ({
  type: "URL",
  text: "Track",
  url: u,
  ...extra,
});
const phone = (p = "+201012345678"): TemplateButton => ({
  type: "PHONE_NUMBER",
  text: "Call us",
  phoneNumber: p,
});

describe("validateTemplateDraft - passing drafts", () => {
  it("accepts a UTILITY draft", () => {
    expect.hasAssertions();
    expect(validateTemplateDraft(utility)).toEqual([]);
  });

  it("accepts a MARKETING draft with header, footer and quick replies", () => {
    expect.hasAssertions();
    expect(validateTemplateDraft(marketing)).toEqual([]);
  });

  it("accepts every supported language", () => {
    expect.hasAssertions();
    for (const language of ["ar", "en", "en_US", "en_GB"]) {
      expect(validateTemplateDraft({ ...utility, language })).toEqual([]);
    }
  });

  it("accepts a zero-variable body", () => {
    expect.hasAssertions();
    expect(validateTemplateDraft(withBody("Thanks for your order.", []))).toEqual([]);
  });

  it("accepts a repeated body parameter with one example", () => {
    expect.hasAssertions();
    expect(
      validateTemplateDraft(withBody("Hi {{1}}, your code {{1}} is ready now.", ["Sara"])),
    ).toEqual([]);
  });

  it("accepts a body of exactly 1024 characters", () => {
    expect.hasAssertions();
    expect(validateTemplateDraft(withBody("a".repeat(1024), []))).toEqual([]);
  });

  it("accepts buttons: URL with variable, phone, static URL, grouped quick replies", () => {
    expect.hasAssertions();
    expect(
      validateTemplateDraft(
        withButtons([
          url("https://shop.example.com/o/{{1}}", { example: "https://shop.example.com/o/1001" }),
          phone(),
        ]),
      ),
    ).toEqual([]);
    expect(validateTemplateDraft(withButtons([qr("A"), qr("B"), url()]))).toEqual([]);
    expect(validateTemplateDraft(withButtons([url(), phone(), qr("A"), qr("B")]))).toEqual([]);
  });

  it("accepts a 10-button template and 25-char labels", () => {
    expect.hasAssertions();
    expect(
      validateTemplateDraft(withButtons(Array.from({ length: 10 }, (_, i) => qr(`b${i}`)))),
    ).toEqual([]);
    expect(validateTemplateDraft(withButtons([qr("x".repeat(25))]))).toEqual([]);
  });

  it("accepts a 60-char header and a 60-char footer", () => {
    expect.hasAssertions();
    expect(
      validateTemplateDraft({
        ...utility,
        header: { format: "TEXT", text: "h".repeat(60) },
        footer: { text: "f".repeat(60) },
      }),
    ).toEqual([]);
  });
});

describe("validateTemplateDraft - failing cases (exact issues)", () => {
  const cases: Array<[string, TemplateDraft, TemplateIssue[]]> = [
    ["name uppercase", { ...utility, name: "Order" }, [{ field: "name", code: "name_format" }]],
    [
      "name with space",
      { ...utility, name: "order shipped" },
      [{ field: "name", code: "name_format" }],
    ],
    ["name empty", { ...utility, name: "" }, [{ field: "name", code: "name_format" }]],
    [
      "name too long",
      { ...utility, name: "a".repeat(513) },
      [{ field: "name", code: "name_format" }],
    ],
    [
      "language fr",
      { ...utility, language: "fr" },
      [{ field: "language", code: "language_unsupported" }],
    ],
    [
      "language en_us",
      { ...utility, language: "en_us" },
      [{ field: "language", code: "language_unsupported" }],
    ],
    [
      "AUTHENTICATION category",
      { ...utility, category: "AUTHENTICATION" },
      [{ field: "category", code: "category_unsupported" }],
    ],
    ["body empty", withBody("", []), [{ field: "body.text", code: "body_length" }]],
    ["body whitespace only", withBody("   ", []), [{ field: "body.text", code: "body_length" }]],
    [
      "body too long",
      withBody("a".repeat(1025), []),
      [{ field: "body.text", code: "body_length" }],
    ],
    [
      "variable gap",
      withBody("A {{1}} b {{3}} c", ["a", "b"]),
      [{ field: "body.text", code: "variables_not_sequential" }],
    ],
    [
      "variables not starting at 1",
      withBody("A {{2}} b", ["a"]),
      [{ field: "body.text", code: "variables_not_sequential" }],
    ],
    [
      "examples fewer than variables",
      withBody("A {{1}} b {{2}} c", ["a"]),
      [{ field: "body.examples", code: "examples_mismatch" }],
    ],
    [
      "examples more than variables",
      withBody("A {{1}} b", ["a", "b"]),
      [{ field: "body.examples", code: "examples_mismatch" }],
    ],
    [
      "repeated variable needs exactly one example",
      withBody("A {{1}} b {{1}} c", ["a", "b"]),
      [{ field: "body.examples", code: "examples_mismatch" }],
    ],
    [
      "example empty",
      withBody("A {{1}} b", [""]),
      [{ field: "body.examples", code: "example_empty" }],
    ],
    [
      "example whitespace",
      withBody("A {{1}} b", ["  "]),
      [{ field: "body.examples", code: "example_empty" }],
    ],
    [
      "variable at start",
      withBody("{{1}} shipped today", ["a"]),
      [{ field: "body.text", code: "variable_at_edge" }],
    ],
    [
      "variable at end",
      withBody("Shipped today to {{1}}", ["a"]),
      [{ field: "body.text", code: "variable_at_edge" }],
    ],
    [
      "variable at end with trailing space",
      withBody("Shipped to {{1}} ", ["a"]),
      [{ field: "body.text", code: "variable_at_edge" }],
    ],
    [
      "adjacent variables",
      withBody("A {{1}}{{2}} b", ["a", "b"]),
      [{ field: "body.text", code: "variables_adjacent" }],
    ],
    [
      "adjacent repeated variables",
      withBody("A {{1}}{{1}} b", ["a"]),
      [{ field: "body.text", code: "variables_adjacent" }],
    ],
    [
      "spaces inside braces",
      withBody("A {{ 1 }} b", ["a"]),
      [{ field: "body.text", code: "variable_malformed" }],
    ],
    [
      "named variable",
      withBody("A {{name}} b", ["a"]),
      [{ field: "body.text", code: "variable_malformed" }],
    ],
    [
      "zero variable",
      withBody("A {{0}} b", ["a"]),
      [{ field: "body.text", code: "variable_malformed" }],
    ],
    [
      "negative variable",
      withBody("A {{-1}} b", ["a"]),
      [{ field: "body.text", code: "variable_malformed" }],
    ],
    [
      "leading-zero variable",
      withBody("A {{01}} b", ["a"]),
      [{ field: "body.text", code: "variable_malformed" }],
    ],
    [
      "unclosed open braces",
      withBody("A {{1 b", []),
      [{ field: "body.text", code: "variable_malformed" }],
    ],
    [
      "unmatched close braces",
      withBody("A 1}} b", []),
      [{ field: "body.text", code: "variable_malformed" }],
    ],
    [
      "triple braces",
      withBody("A {{{1}}} b", ["a"]),
      [{ field: "body.text", code: "variable_malformed" }],
    ],
    [
      "empty braces",
      withBody("A {{}} b", []),
      [{ field: "body.text", code: "variable_malformed" }],
    ],
    [
      "header too long",
      { ...utility, header: { format: "TEXT", text: "h".repeat(61) } },
      [{ field: "header.text", code: "header_length" }],
    ],
    [
      "header empty",
      { ...utility, header: { format: "TEXT", text: "" } },
      [{ field: "header.text", code: "header_length" }],
    ],
    [
      "header with two variables",
      { ...utility, header: { format: "TEXT", text: "A {{1}} b {{2}}", example: "x" } },
      [{ field: "header.text", code: "header_variables" }],
    ],
    [
      "header with a repeated variable",
      { ...utility, header: { format: "TEXT", text: "A {{1}} b {{1}}", example: "x" } },
      [{ field: "header.text", code: "header_variables" }],
    ],
    [
      "header variable not {{1}}",
      { ...utility, header: { format: "TEXT", text: "A {{2}}", example: "x" } },
      [{ field: "header.text", code: "header_variables" }],
    ],
    [
      "header variable without example",
      { ...utility, header: { format: "TEXT", text: "Hello {{1}}" } },
      [{ field: "header.example", code: "header_example_missing" }],
    ],
    [
      "header variable with blank example",
      { ...utility, header: { format: "TEXT", text: "Hello {{1}}", example: "  " } },
      [{ field: "header.example", code: "header_example_missing" }],
    ],
    [
      "header malformed",
      { ...utility, header: { format: "TEXT", text: "Hello {{ 1 }}", example: "x" } },
      [{ field: "header.text", code: "variable_malformed" }],
    ],
    [
      "footer too long",
      { ...utility, footer: { text: "f".repeat(61) } },
      [{ field: "footer.text", code: "footer_length" }],
    ],
    [
      "footer empty",
      { ...utility, footer: { text: "" } },
      [{ field: "footer.text", code: "footer_length" }],
    ],
    [
      "footer with variable",
      { ...utility, footer: { text: "Order {{1}}" } },
      [{ field: "footer.text", code: "footer_variables" }],
    ],
    [
      "footer with malformed braces",
      { ...utility, footer: { text: "Order {{" } },
      [{ field: "footer.text", code: "footer_variables" }],
    ],
    [
      "11 buttons",
      withButtons(Array.from({ length: 11 }, (_, i) => qr(`b${i}`))),
      [{ field: "buttons", code: "buttons_count" }],
    ],
    [
      "quick reply text too long",
      withButtons([qr("x".repeat(26))]),
      [{ field: "buttons[0].text", code: "button_text_length" }],
    ],
    [
      "quick reply text empty",
      withButtons([qr("")]),
      [{ field: "buttons[0].text", code: "button_text_empty" }],
    ],
    [
      "quick reply text blank",
      withButtons([qr("   ")]),
      [{ field: "buttons[0].text", code: "button_text_empty" }],
    ],
    [
      "URL button text too long",
      withButtons([url("https://a.example.com", { text: "t".repeat(26) })]),
      [{ field: "buttons[0].text", code: "button_text_length" }],
    ],
    [
      "phone button text empty",
      withButtons([{ type: "PHONE_NUMBER", text: "", phoneNumber: "+201012345678" }]),
      [{ field: "buttons[0].text", code: "button_text_empty" }],
    ],
    [
      "three URL buttons",
      withButtons([
        url("https://a.example.com"),
        url("https://b.example.com"),
        url("https://c.example.com"),
      ]),
      [{ field: "buttons", code: "url_buttons_count" }],
    ],
    [
      "URL not https",
      withButtons([url("http://shop.example.com")]),
      [{ field: "buttons[0].url", code: "url_invalid" }],
    ],
    [
      "URL missing",
      withButtons([{ type: "URL", text: "Track" }]),
      [{ field: "buttons[0].url", code: "url_invalid" }],
    ],
    [
      "URL garbage",
      withButtons([url("https://")]),
      [{ field: "buttons[0].url", code: "url_invalid" }],
    ],
    [
      "URL with whitespace",
      withButtons([url("https://shop.example.com/a b")]),
      [{ field: "buttons[0].url", code: "url_invalid" }],
    ],
    [
      "URL variable not at the end",
      withButtons([
        url("https://shop.example.com/{{1}}/x", { example: "https://shop.example.com/1/x" }),
      ]),
      [{ field: "buttons[0].url", code: "url_invalid" }],
    ],
    [
      "URL variable is {{2}}",
      withButtons([
        url("https://shop.example.com/{{2}}", { example: "https://shop.example.com/1" }),
      ]),
      [{ field: "buttons[0].url", code: "url_invalid" }],
    ],
    [
      "URL two variables",
      withButtons([
        url("https://shop.example.com/{{1}}{{1}}", { example: "https://shop.example.com/1" }),
      ]),
      [{ field: "buttons[0].url", code: "url_invalid" }],
    ],
    [
      "URL variable without example",
      withButtons([url("https://shop.example.com/o/{{1}}")]),
      [{ field: "buttons[0].example", code: "url_example_missing" }],
    ],
    [
      "URL variable with blank example",
      withButtons([url("https://shop.example.com/o/{{1}}", { example: " " })]),
      [{ field: "buttons[0].example", code: "url_example_missing" }],
    ],
    [
      "URL too long",
      withButtons([url(`https://shop.example.com/${"a".repeat(2000)}`)]),
      [{ field: "buttons[0].url", code: "url_too_long" }],
    ],
    [
      "URL example too long",
      withButtons([
        url("https://shop.example.com/o/{{1}}", {
          example: `https://shop.example.com/${"a".repeat(2000)}`,
        }),
      ]),
      [{ field: "buttons[0].example", code: "url_too_long" }],
    ],
    [
      "two phone buttons",
      withButtons([phone(), phone("+201112345678")]),
      [{ field: "buttons", code: "phone_buttons_count" }],
    ],
    [
      "phone not E.164 (national)",
      withButtons([phone("01012345678")]),
      [{ field: "buttons[0].phoneNumber", code: "phone_invalid" }],
    ],
    [
      "phone with spaces",
      withButtons([phone("+20 101 234 5678")]),
      [{ field: "buttons[0].phoneNumber", code: "phone_invalid" }],
    ],
    [
      "phone missing",
      withButtons([{ type: "PHONE_NUMBER", text: "Call" }]),
      [{ field: "buttons[0].phoneNumber", code: "phone_invalid" }],
    ],
    [
      "quick replies interleaved with CTA",
      withButtons([qr("A"), url(), qr("B")]),
      [{ field: "buttons", code: "buttons_mixed_order" }],
    ],
    [
      "CTA interleaved with quick replies",
      withButtons([phone(), qr("A"), url()]),
      [{ field: "buttons", code: "buttons_mixed_order" }],
    ],
  ];

  it.each(cases)("%s", (_name, draft, issues) => {
    expect.hasAssertions();
    expect(validateTemplateDraft(draft)).toEqual(issues);
  });

  it("reports several independent problems together", () => {
    expect.hasAssertions();
    const issues = validateTemplateDraft({
      name: "Bad Name",
      language: "fr",
      category: "AUTHENTICATION",
      body: { text: "", examples: [] },
    });
    expect(issues.map((i) => i.code)).toEqual([
      "name_format",
      "language_unsupported",
      "category_unsupported",
      "body_length",
    ]);
  });
});

describe("bodyVariableCount", () => {
  it.each([
    ["no variables", 0],
    ["Hi {{1}}", 1],
    ["Hi {{1}} and {{2}} and {{3}}", 3],
    ["Hi {{1}} and {{1}} again", 1],
    ["Hi {{2}} and {{1}}", 2],
  ])("counts %j as %j distinct variables", (text, count) => {
    expect.hasAssertions();
    expect(bodyVariableCount(text)).toBe(count);
  });
});

describe("toMetaComponents", () => {
  it("builds header + 2 variables + footer + 2 quick replies", () => {
    expect.hasAssertions();
    const draft: TemplateDraft = {
      name: "promo",
      language: "en",
      category: "MARKETING",
      header: { format: "TEXT", text: "Hi {{1}}", example: "Sara" },
      body: { text: "Your code {{1}} saves {{2}} today.", examples: ["SAVE10", "10%"] },
      footer: { text: "Reply STOP to opt out" },
      buttons: [
        { type: "QUICK_REPLY", text: "Tell me more" },
        { type: "QUICK_REPLY", text: "No thanks" },
      ],
    };
    expect(validateTemplateDraft(draft)).toEqual([]);
    expect(toMetaComponents(draft)).toEqual([
      { type: "HEADER", format: "TEXT", text: "Hi {{1}}", example: { header_text: ["Sara"] } },
      {
        type: "BODY",
        text: "Your code {{1}} saves {{2}} today.",
        example: { body_text: [["SAVE10", "10%"]] },
      },
      { type: "FOOTER", text: "Reply STOP to opt out" },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Tell me more" },
          { type: "QUICK_REPLY", text: "No thanks" },
        ],
      },
    ]);
  });

  it("omits example for a header without parameters", () => {
    expect.hasAssertions();
    expect(
      toMetaComponents({
        ...utility,
        header: { format: "TEXT", text: "Order update", example: "ignored" },
      })[0],
    ).toEqual({ type: "HEADER", format: "TEXT", text: "Order update" });
  });

  it("omits example for a zero-variable body and omits empty parts", () => {
    expect.hasAssertions();
    expect(toMetaComponents(withBody("Thanks for your order.", []))).toEqual([
      { type: "BODY", text: "Thanks for your order." },
    ]);
    expect(
      toMetaComponents({ ...utility, buttons: [] }).map((c) => (c as { type: string }).type),
    ).toEqual(["BODY"]);
  });

  it("uses one example for a repeated body parameter", () => {
    expect.hasAssertions();
    expect(toMetaComponents(withBody("Hi {{1}}, code {{1}} is ready.", ["Sara"]))).toEqual([
      { type: "BODY", text: "Hi {{1}}, code {{1}} is ready.", example: { body_text: [["Sara"]] } },
    ]);
  });

  it("serializes URL variable, static URL and phone buttons", () => {
    expect.hasAssertions();
    const buttons: TemplateButton[] = [
      {
        type: "URL",
        text: "Track",
        url: "https://shop.example.com/o/{{1}}",
        example: "https://shop.example.com/o/1001",
      },
      { type: "URL", text: "Store", url: "https://shop.example.com" },
      { type: "PHONE_NUMBER", text: "Call us", phoneNumber: "+201012345678" },
    ];
    expect(toMetaComponents(withButtons(buttons))[1]).toEqual({
      type: "BUTTONS",
      buttons: [
        {
          type: "URL",
          text: "Track",
          url: "https://shop.example.com/o/{{1}}",
          example: ["https://shop.example.com/o/1001"],
        },
        { type: "URL", text: "Store", url: "https://shop.example.com" },
        { type: "PHONE_NUMBER", text: "Call us", phone_number: "+201012345678" },
      ],
    });
  });
});
