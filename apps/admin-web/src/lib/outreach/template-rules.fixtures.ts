import type { TemplateButtonDraft, TemplateDraftInput, TemplateIssueCode } from "./template-rules";

/**
 * The pass/fail fixtures of the Task 2 validator tests (`services/outreach/src/domain/message-template.test.ts`),
 * copied verbatim. The browser mirror and the real domain validator both run them
 * (`template-rules.test.ts`, `template-rules.parity.test.ts`).
 */

/** A valid E.164 number, built from pieces so no literal number sits in the source. */
const VALID_PHONE = `+${"20"}${"1012345678"}`;

const utility: TemplateDraftInput = {
  name: "order_shipped",
  language: "en",
  category: "UTILITY",
  body: { text: "Hi {{1}}, your order {{2}} has shipped.", examples: ["Sara", "1001"] },
};

const marketing: TemplateDraftInput = {
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

function withBody(text: string, examples: string[]): TemplateDraftInput {
  return { ...utility, body: { text, examples } };
}
function withButtons(buttons: TemplateButtonDraft[]): TemplateDraftInput {
  return { ...utility, buttons };
}
const qr = (text = "Yes"): TemplateButtonDraft => ({ type: "QUICK_REPLY", text });
const url = (
  u = "https://shop.example.com/orders",
  extra: Partial<TemplateButtonDraft> = {},
): TemplateButtonDraft => ({ type: "URL", text: "Track", url: u, ...extra });
const phone = (p = VALID_PHONE): TemplateButtonDraft => ({
  type: "PHONE_NUMBER",
  text: "Call us",
  phoneNumber: p,
});

export interface TemplateFixture {
  readonly name: string;
  readonly draft: TemplateDraftInput;
  readonly issues: readonly TemplateIssueCode[];
}

/** Drafts the validator accepts (no issues). */
export const PASSING_FIXTURES: readonly TemplateFixture[] = [
  { name: "a UTILITY draft", draft: utility, issues: [] },
  { name: "a MARKETING draft with header, footer and quick replies", draft: marketing, issues: [] },
  ...["ar", "en", "en_US", "en_GB"].map((language) => ({
    name: `language ${language}`,
    draft: { ...utility, language },
    issues: [],
  })),
  { name: "a zero-variable body", draft: withBody("Thanks for your order.", []), issues: [] },
  {
    name: "a repeated body parameter with one example",
    draft: withBody("Hi {{1}}, your code {{1}} is ready now.", ["Sara"]),
    issues: [],
  },
  { name: "a body of exactly 1024 characters", draft: withBody("a".repeat(1024), []), issues: [] },
  {
    name: "a URL variable button and a phone button",
    draft: withButtons([
      url("https://shop.example.com/o/{{1}}", { example: "https://shop.example.com/o/1001" }),
      phone(),
    ]),
    issues: [],
  },
  {
    name: "grouped quick replies and a static URL",
    draft: withButtons([qr("A"), qr("B"), url()]),
    issues: [],
  },
  {
    name: "CTA buttons then quick replies",
    draft: withButtons([url(), phone(), qr("A"), qr("B")]),
    issues: [],
  },
  {
    name: "a 10-button template",
    draft: withButtons(Array.from({ length: 10 }, (_, i) => qr(`b${i}`))),
    issues: [],
  },
  { name: "25-char button labels", draft: withButtons([qr("x".repeat(25))]), issues: [] },
  {
    name: "a 60-char header and a 60-char footer",
    draft: {
      ...utility,
      header: { format: "TEXT", text: "h".repeat(60) },
      footer: { text: "f".repeat(60) },
    },
    issues: [],
  },
];

const bodyIssue = (code: string): TemplateIssueCode[] => [{ field: "body.text", code }];
const buttonIssue = (field: string, code: string): TemplateIssueCode[] => [{ field, code }];

/** Drafts the validator rejects, with the exact `{field, code}` issues (and their order). */
export const FAILING_FIXTURES: readonly TemplateFixture[] = [
  {
    name: "name uppercase",
    draft: { ...utility, name: "Order" },
    issues: [{ field: "name", code: "name_format" }],
  },
  {
    name: "name with space",
    draft: { ...utility, name: "order shipped" },
    issues: [{ field: "name", code: "name_format" }],
  },
  {
    name: "name empty",
    draft: { ...utility, name: "" },
    issues: [{ field: "name", code: "name_format" }],
  },
  {
    name: "name too long",
    draft: { ...utility, name: "a".repeat(513) },
    issues: [{ field: "name", code: "name_format" }],
  },
  {
    name: "language fr",
    draft: { ...utility, language: "fr" },
    issues: [{ field: "language", code: "language_unsupported" }],
  },
  {
    name: "language en_us",
    draft: { ...utility, language: "en_us" },
    issues: [{ field: "language", code: "language_unsupported" }],
  },
  {
    name: "AUTHENTICATION category",
    draft: { ...utility, category: "AUTHENTICATION" },
    issues: [{ field: "category", code: "category_unsupported" }],
  },
  { name: "body empty", draft: withBody("", []), issues: bodyIssue("body_length") },
  { name: "body whitespace only", draft: withBody("   ", []), issues: bodyIssue("body_length") },
  {
    name: "body too long",
    draft: withBody("a".repeat(1025), []),
    issues: bodyIssue("body_length"),
  },
  {
    name: "variable gap",
    draft: withBody("A {{1}} b {{3}} c", ["a", "b"]),
    issues: bodyIssue("variables_not_sequential"),
  },
  {
    name: "variables not starting at 1",
    draft: withBody("A {{2}} b", ["a"]),
    issues: bodyIssue("variables_not_sequential"),
  },
  {
    name: "examples fewer than variables",
    draft: withBody("A {{1}} b {{2}} c", ["a"]),
    issues: [{ field: "body.examples", code: "examples_mismatch" }],
  },
  {
    name: "examples more than variables",
    draft: withBody("A {{1}} b", ["a", "b"]),
    issues: [{ field: "body.examples", code: "examples_mismatch" }],
  },
  {
    name: "repeated variable needs exactly one example",
    draft: withBody("A {{1}} b {{1}} c", ["a", "b"]),
    issues: [{ field: "body.examples", code: "examples_mismatch" }],
  },
  {
    name: "example empty",
    draft: withBody("A {{1}} b", [""]),
    issues: [{ field: "body.examples", code: "example_empty" }],
  },
  {
    name: "example whitespace",
    draft: withBody("A {{1}} b", ["  "]),
    issues: [{ field: "body.examples", code: "example_empty" }],
  },
  {
    name: "variable at start",
    draft: withBody("{{1}} shipped today", ["a"]),
    issues: bodyIssue("variable_at_edge"),
  },
  {
    name: "variable at end",
    draft: withBody("Shipped today to {{1}}", ["a"]),
    issues: bodyIssue("variable_at_edge"),
  },
  {
    name: "variable at end with trailing space",
    draft: withBody("Shipped to {{1}} ", ["a"]),
    issues: bodyIssue("variable_at_edge"),
  },
  {
    name: "adjacent variables",
    draft: withBody("A {{1}}{{2}} b", ["a", "b"]),
    issues: bodyIssue("variables_adjacent"),
  },
  {
    name: "adjacent repeated variables",
    draft: withBody("A {{1}}{{1}} b", ["a"]),
    issues: bodyIssue("variables_adjacent"),
  },
  {
    name: "spaces inside braces",
    draft: withBody("A {{ 1 }} b", ["a"]),
    issues: bodyIssue("variable_malformed"),
  },
  {
    name: "named variable",
    draft: withBody("A {{name}} b", ["a"]),
    issues: bodyIssue("variable_malformed"),
  },
  {
    name: "zero variable",
    draft: withBody("A {{0}} b", ["a"]),
    issues: bodyIssue("variable_malformed"),
  },
  {
    name: "negative variable",
    draft: withBody("A {{-1}} b", ["a"]),
    issues: bodyIssue("variable_malformed"),
  },
  {
    name: "leading-zero variable",
    draft: withBody("A {{01}} b", ["a"]),
    issues: bodyIssue("variable_malformed"),
  },
  {
    name: "unclosed open braces",
    draft: withBody("A {{1 b", []),
    issues: bodyIssue("variable_malformed"),
  },
  {
    name: "unmatched close braces",
    draft: withBody("A 1}} b", []),
    issues: bodyIssue("variable_malformed"),
  },
  {
    name: "triple braces",
    draft: withBody("A {{{1}}} b", ["a"]),
    issues: bodyIssue("variable_malformed"),
  },
  {
    name: "empty braces",
    draft: withBody("A {{}} b", []),
    issues: bodyIssue("variable_malformed"),
  },
  {
    name: "header too long",
    draft: { ...utility, header: { format: "TEXT", text: "h".repeat(61) } },
    issues: [{ field: "header.text", code: "header_length" }],
  },
  {
    name: "header empty",
    draft: { ...utility, header: { format: "TEXT", text: "" } },
    issues: [{ field: "header.text", code: "header_length" }],
  },
  {
    name: "header with two variables",
    draft: { ...utility, header: { format: "TEXT", text: "A {{1}} b {{2}}", example: "x" } },
    issues: [{ field: "header.text", code: "header_variables" }],
  },
  {
    name: "header with a repeated variable",
    draft: { ...utility, header: { format: "TEXT", text: "A {{1}} b {{1}}", example: "x" } },
    issues: [{ field: "header.text", code: "header_variables" }],
  },
  {
    name: "header variable not {{1}}",
    draft: { ...utility, header: { format: "TEXT", text: "A {{2}}", example: "x" } },
    issues: [{ field: "header.text", code: "header_variables" }],
  },
  {
    name: "header variable without example",
    draft: { ...utility, header: { format: "TEXT", text: "Hello {{1}}" } },
    issues: [{ field: "header.example", code: "header_example_missing" }],
  },
  {
    name: "header variable with blank example",
    draft: { ...utility, header: { format: "TEXT", text: "Hello {{1}}", example: "  " } },
    issues: [{ field: "header.example", code: "header_example_missing" }],
  },
  {
    name: "header malformed",
    draft: { ...utility, header: { format: "TEXT", text: "Hello {{ 1 }}", example: "x" } },
    issues: [{ field: "header.text", code: "variable_malformed" }],
  },
  {
    name: "footer too long",
    draft: { ...utility, footer: { text: "f".repeat(61) } },
    issues: [{ field: "footer.text", code: "footer_length" }],
  },
  {
    name: "footer empty",
    draft: { ...utility, footer: { text: "" } },
    issues: [{ field: "footer.text", code: "footer_length" }],
  },
  {
    name: "footer with variable",
    draft: { ...utility, footer: { text: "Order {{1}}" } },
    issues: [{ field: "footer.text", code: "footer_variables" }],
  },
  {
    name: "footer with malformed braces",
    draft: { ...utility, footer: { text: "Order {{" } },
    issues: [{ field: "footer.text", code: "footer_variables" }],
  },
  {
    name: "11 buttons",
    draft: withButtons(Array.from({ length: 11 }, (_, i) => qr(`b${i}`))),
    issues: buttonIssue("buttons", "buttons_count"),
  },
  {
    name: "quick reply text too long",
    draft: withButtons([qr("x".repeat(26))]),
    issues: buttonIssue("buttons[0].text", "button_text_length"),
  },
  {
    name: "quick reply text empty",
    draft: withButtons([qr("")]),
    issues: buttonIssue("buttons[0].text", "button_text_empty"),
  },
  {
    name: "quick reply text blank",
    draft: withButtons([qr("   ")]),
    issues: buttonIssue("buttons[0].text", "button_text_empty"),
  },
  {
    name: "URL button text too long",
    draft: withButtons([url("https://a.example.com", { text: "t".repeat(26) })]),
    issues: buttonIssue("buttons[0].text", "button_text_length"),
  },
  {
    name: "phone button text empty",
    draft: withButtons([{ type: "PHONE_NUMBER", text: "", phoneNumber: VALID_PHONE }]),
    issues: buttonIssue("buttons[0].text", "button_text_empty"),
  },
  {
    name: "three URL buttons",
    draft: withButtons([
      url("https://a.example.com"),
      url("https://b.example.com"),
      url("https://c.example.com"),
    ]),
    issues: buttonIssue("buttons", "url_buttons_count"),
  },
  {
    name: "URL not https",
    draft: withButtons([url("http://shop.example.com")]),
    issues: buttonIssue("buttons[0].url", "url_invalid"),
  },
  {
    name: "URL missing",
    draft: withButtons([{ type: "URL", text: "Track" }]),
    issues: buttonIssue("buttons[0].url", "url_invalid"),
  },
  {
    name: "URL garbage",
    draft: withButtons([url("https://")]),
    issues: buttonIssue("buttons[0].url", "url_invalid"),
  },
  {
    name: "URL with whitespace",
    draft: withButtons([url("https://shop.example.com/a b")]),
    issues: buttonIssue("buttons[0].url", "url_invalid"),
  },
  {
    name: "URL variable not at the end",
    draft: withButtons([
      url("https://shop.example.com/{{1}}/x", { example: "https://shop.example.com/1/x" }),
    ]),
    issues: buttonIssue("buttons[0].url", "url_invalid"),
  },
  {
    name: "URL variable is {{2}}",
    draft: withButtons([
      url("https://shop.example.com/{{2}}", { example: "https://shop.example.com/1" }),
    ]),
    issues: buttonIssue("buttons[0].url", "url_invalid"),
  },
  {
    name: "URL two variables",
    draft: withButtons([
      url("https://shop.example.com/{{1}}{{1}}", { example: "https://shop.example.com/1" }),
    ]),
    issues: buttonIssue("buttons[0].url", "url_invalid"),
  },
  {
    name: "URL variable without example",
    draft: withButtons([url("https://shop.example.com/o/{{1}}")]),
    issues: buttonIssue("buttons[0].example", "url_example_missing"),
  },
  {
    name: "URL variable with blank example",
    draft: withButtons([url("https://shop.example.com/o/{{1}}", { example: " " })]),
    issues: buttonIssue("buttons[0].example", "url_example_missing"),
  },
  {
    name: "URL too long",
    draft: withButtons([url(`https://shop.example.com/${"a".repeat(2000)}`)]),
    issues: buttonIssue("buttons[0].url", "url_too_long"),
  },
  {
    name: "URL example too long",
    draft: withButtons([
      url("https://shop.example.com/o/{{1}}", {
        example: `https://shop.example.com/${"a".repeat(2000)}`,
      }),
    ]),
    issues: buttonIssue("buttons[0].example", "url_too_long"),
  },
  {
    name: "two phone buttons",
    draft: withButtons([phone(), phone(VALID_PHONE)]),
    issues: buttonIssue("buttons", "phone_buttons_count"),
  },
  {
    name: "phone not E.164 (national)",
    draft: withButtons([phone("01012345678")]),
    issues: buttonIssue("buttons[0].phoneNumber", "phone_invalid"),
  },
  {
    name: "phone with spaces",
    draft: withButtons([phone("+20 101 234 5678")]),
    issues: buttonIssue("buttons[0].phoneNumber", "phone_invalid"),
  },
  {
    name: "phone missing",
    draft: withButtons([{ type: "PHONE_NUMBER", text: "Call" }]),
    issues: buttonIssue("buttons[0].phoneNumber", "phone_invalid"),
  },
  {
    name: "quick replies interleaved with CTA",
    draft: withButtons([qr("A"), url(), qr("B")]),
    issues: buttonIssue("buttons", "buttons_mixed_order"),
  },
  {
    name: "CTA interleaved with quick replies",
    draft: withButtons([phone(), qr("A"), url()]),
    issues: buttonIssue("buttons", "buttons_mixed_order"),
  },
  {
    name: "several independent problems together",
    draft: {
      name: "Bad Name",
      language: "fr",
      category: "AUTHENTICATION",
      body: { text: "", examples: [] },
    },
    issues: [
      { field: "name", code: "name_format" },
      { field: "language", code: "language_unsupported" },
      { field: "category", code: "category_unsupported" },
      { field: "body.text", code: "body_length" },
    ],
  },
];

export const ALL_FIXTURES: readonly TemplateFixture[] = [...PASSING_FIXTURES, ...FAILING_FIXTURES];
