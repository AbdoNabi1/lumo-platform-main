import { describe, expect, it } from "vitest";
import { toMetaComponents, type TemplateDraft } from "./message-template";
import {
  buildTemplateSendComponents,
  shapeOfStoredTemplate,
  validateSessionInput,
  type StoredTemplateShape,
} from "./template-send";

const payloadFor = (i: number): string => `qr:${i}`;

const fullComponents = [
  { type: "HEADER", format: "TEXT", text: "Hi {{1}}", example: { header_text: ["Sara"] } },
  {
    type: "BODY",
    text: "Order {{1}} ships on {{2}} (ref {{1}}).",
    example: { body_text: [["1001", "Monday"]] },
  },
  { type: "FOOTER", text: "Thanks" },
  {
    type: "BUTTONS",
    buttons: [
      {
        type: "URL",
        text: "Track",
        url: "https://shop.example.com/o/{{1}}",
        example: ["https://shop.example.com/o/1"],
      },
      { type: "QUICK_REPLY", text: "Yes" },
      { type: "QUICK_REPLY", text: "No" },
    ],
  },
];

describe("shapeOfStoredTemplate", () => {
  it("derives the send shape from full Meta components", () => {
    expect.hasAssertions();
    expect(shapeOfStoredTemplate(fullComponents)).toEqual({
      bodyVariableCount: 2,
      headerHasVariable: true,
      buttons: [
        { index: 0, type: "URL", urlHasVariable: true },
        { index: 1, type: "QUICK_REPLY", urlHasVariable: false },
        { index: 2, type: "QUICK_REPLY", urlHasVariable: false },
      ],
      supported: true,
    });
  });

  it("derives a shape for a body-only template", () => {
    expect.hasAssertions();
    expect(shapeOfStoredTemplate([{ type: "BODY", text: "Thanks for your order." }])).toEqual({
      bodyVariableCount: 0,
      headerHasVariable: false,
      buttons: [],
      supported: true,
    });
  });

  it("reads static URL and phone buttons as having no variable", () => {
    expect.hasAssertions();
    const shape = shapeOfStoredTemplate([
      { type: "BODY", text: "Hello there." },
      {
        type: "BUTTONS",
        buttons: [
          { type: "URL", text: "Store", url: "https://shop.example.com" },
          { type: "PHONE_NUMBER", text: "Call", phone_number: "+201012345678" },
        ],
      },
    ]);
    expect(shape.supported).toBe(true);
    expect(shape.buttons).toEqual([
      { index: 0, type: "URL", urlHasVariable: false },
      { index: 1, type: "PHONE_NUMBER", urlHasVariable: false },
    ]);
  });

  it("round-trips toMetaComponents output", () => {
    expect.hasAssertions();
    const draft: TemplateDraft = {
      name: "promo",
      language: "en",
      category: "MARKETING",
      header: { format: "TEXT", text: "Hi {{1}}", example: "Sara" },
      body: { text: "Your code {{1}} saves {{2}} today.", examples: ["A", "B"] },
      buttons: [{ type: "QUICK_REPLY", text: "More" }],
    };
    expect(shapeOfStoredTemplate(toMetaComponents(draft))).toEqual({
      bodyVariableCount: 2,
      headerHasVariable: true,
      buttons: [{ index: 0, type: "QUICK_REPLY", urlHasVariable: false }],
      supported: true,
    });
  });

  const unsupported: Array<[string, unknown]> = [
    ["not an array", { type: "BODY", text: "x" }],
    ["null", null],
    ["undefined", undefined],
    ["string", "BODY"],
    ["empty array", []],
    ["no body", [{ type: "FOOTER", text: "x" }]],
    [
      "two bodies",
      [
        { type: "BODY", text: "a" },
        { type: "BODY", text: "b" },
      ],
    ],
    [
      "image header",
      [
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "x" },
      ],
    ],
    [
      "location header",
      [
        { type: "HEADER", format: "LOCATION" },
        { type: "BODY", text: "x" },
      ],
    ],
    [
      "carousel",
      [
        { type: "BODY", text: "x" },
        { type: "CAROUSEL", cards: [] },
      ],
    ],
    ["limited time offer", [{ type: "BODY", text: "x" }, { type: "LIMITED_TIME_OFFER" }]],
    [
      "OTP button",
      [
        { type: "BODY", text: "x" },
        { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] },
      ],
    ],
    [
      "flow button",
      [
        { type: "BODY", text: "x" },
        { type: "BUTTONS", buttons: [{ type: "FLOW", text: "Go" }] },
      ],
    ],
    [
      "copy code button",
      [
        { type: "BODY", text: "x" },
        { type: "BUTTONS", buttons: [{ type: "COPY_CODE", example: "A" }] },
      ],
    ],
    [
      "buttons not an array",
      [
        { type: "BODY", text: "x" },
        { type: "BUTTONS", buttons: "no" },
      ],
    ],
    ["named parameters", [{ type: "BODY", text: "Hi {{name}} there." }]],
    ["sparse parameters", [{ type: "BODY", text: "Hi {{1}} and {{3}} there." }]],
    [
      "header with two variables",
      [
        { type: "HEADER", format: "TEXT", text: "{{1}} {{2}}" },
        { type: "BODY", text: "x" },
      ],
    ],
    ["component without type", [{ type: "BODY", text: "x" }, { text: "orphan" }]],
    ["non-object component", [{ type: "BODY", text: "x" }, 7]],
  ];

  it.each(unsupported)("marks %s as unsupported", (_name, components) => {
    expect.hasAssertions();
    expect(shapeOfStoredTemplate(components)).toEqual({
      bodyVariableCount: 0,
      headerHasVariable: false,
      buttons: [],
      supported: false,
    });
  });
});

describe("buildTemplateSendComponents", () => {
  const shape = shapeOfStoredTemplate(fullComponents);

  it("builds the exact payload for header + body + URL + 2 quick replies", () => {
    expect.hasAssertions();
    const r = buildTemplateSendComponents(
      shape,
      { body: ["1001", "Monday"], header: "Sara", urlSuffixes: { 0: "1001" } },
      payloadFor,
    );
    expect(r).toEqual({
      ok: true,
      components: [
        { type: "header", parameters: [{ type: "text", text: "Sara" }] },
        {
          type: "body",
          parameters: [
            { type: "text", text: "1001" },
            { type: "text", text: "Monday" },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: "1001" }],
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "1",
          parameters: [{ type: "payload", payload: "qr:1" }],
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "2",
          parameters: [{ type: "payload", payload: "qr:2" }],
        },
      ],
    });
  });

  it("emits no components for a template with no parameters and no quick replies", () => {
    expect.hasAssertions();
    const bare = shapeOfStoredTemplate([{ type: "BODY", text: "Thanks." }]);
    expect(buildTemplateSendComponents(bare, { body: [] }, payloadFor)).toEqual({
      ok: true,
      components: [],
    });
  });

  it("skips static URL buttons and phone buttons but keeps quick replies", () => {
    expect.hasAssertions();
    const s: StoredTemplateShape = {
      bodyVariableCount: 0,
      headerHasVariable: false,
      buttons: [
        { index: 0, type: "URL", urlHasVariable: false },
        { index: 1, type: "PHONE_NUMBER", urlHasVariable: false },
        { index: 2, type: "QUICK_REPLY", urlHasVariable: false },
      ],
      supported: true,
    };
    expect(buildTemplateSendComponents(s, { body: [] }, payloadFor)).toEqual({
      ok: true,
      components: [
        {
          type: "button",
          sub_type: "quick_reply",
          index: "2",
          parameters: [{ type: "payload", payload: "qr:2" }],
        },
      ],
    });
  });

  it("reports an unsupported shape", () => {
    expect.hasAssertions();
    const r = buildTemplateSendComponents(
      { bodyVariableCount: 0, headerHasVariable: false, buttons: [], supported: false },
      { body: [] },
      payloadFor,
    );
    expect(r).toEqual({ ok: false, issues: [{ field: "template", code: "template_unsupported" }] });
  });

  it.each([
    [
      "too few body values",
      { body: ["1001"], header: "Sara", urlSuffixes: { 0: "x" } },
      [{ field: "body", code: "send_values_mismatch" }],
    ],
    [
      "too many body values",
      { body: ["1", "2", "3"], header: "Sara", urlSuffixes: { 0: "x" } },
      [{ field: "body", code: "send_values_mismatch" }],
    ],
    [
      "blank body value",
      { body: ["1001", "  "], header: "Sara", urlSuffixes: { 0: "x" } },
      [{ field: "body", code: "send_values_mismatch" }],
    ],
    [
      "missing header value",
      { body: ["1", "2"], urlSuffixes: { 0: "x" } },
      [{ field: "header", code: "header_value_missing" }],
    ],
    [
      "blank header value",
      { body: ["1", "2"], header: " ", urlSuffixes: { 0: "x" } },
      [{ field: "header", code: "header_value_missing" }],
    ],
    [
      "missing URL suffix",
      { body: ["1", "2"], header: "Sara" },
      [{ field: "urlSuffixes[0]", code: "url_suffix_missing" }],
    ],
    [
      "blank URL suffix",
      { body: ["1", "2"], header: "Sara", urlSuffixes: { 0: "" } },
      [{ field: "urlSuffixes[0]", code: "url_suffix_missing" }],
    ],
    [
      "suffix for a button that cannot take one",
      { body: ["1", "2"], header: "Sara", urlSuffixes: { 0: "x", 1: "y" } },
      [{ field: "urlSuffixes[1]", code: "send_values_mismatch" }],
    ],
  ] as const)("%s", (_name, values, issues) => {
    expect.hasAssertions();
    const r = buildTemplateSendComponents(
      shape,
      {
        ...values,
        body: [...values.body],
        ...("urlSuffixes" in values ? { urlSuffixes: { ...values.urlSuffixes } } : {}),
      },
      payloadFor,
    );
    expect(r).toEqual({ ok: false, issues });
  });

  it("rejects a header value when the approved header has no variable", () => {
    expect.hasAssertions();
    const s = shapeOfStoredTemplate([
      { type: "HEADER", format: "TEXT", text: "Static" },
      { type: "BODY", text: "Hello there." },
    ]);
    expect(buildTemplateSendComponents(s, { body: [], header: "x" }, payloadFor)).toEqual({
      ok: false,
      issues: [{ field: "header", code: "send_values_mismatch" }],
    });
  });

  it("collects every issue in one pass", () => {
    expect.hasAssertions();
    const r = buildTemplateSendComponents(shape, { body: [] }, payloadFor);
    expect(r).toEqual({
      ok: false,
      issues: [
        { field: "body", code: "send_values_mismatch" },
        { field: "header", code: "header_value_missing" },
        { field: "urlSuffixes[0]", code: "url_suffix_missing" },
      ],
    });
  });
});

describe("validateSessionInput", () => {
  const buttons = (n: number): { id: string; title: string }[] =>
    Array.from({ length: n }, (_, i) => ({ id: `id${i}`, title: `Title ${i}` }));

  it.each([
    ["plain text", { text: "hello" }],
    ["text of 4096 chars", { text: "a".repeat(4096) }],
    ["empty buttons array behaves like no buttons", { text: "hello", buttons: [] }],
    ["one button", { text: "Pick one", buttons: buttons(1) }],
    ["three buttons", { text: "Pick one", buttons: buttons(3) }],
    ["1024-char body with buttons", { text: "a".repeat(1024), buttons: buttons(2) }],
    [
      "20-char title and 256-char id",
      { text: "Pick", buttons: [{ id: "i".repeat(256), title: "t".repeat(20) }] },
    ],
  ])("accepts %s", (_name, input) => {
    expect.hasAssertions();
    expect(validateSessionInput(input)).toEqual([]);
  });

  it.each([
    ["empty text", { text: "" }, [{ field: "text", code: "text_required" }]],
    ["blank text", { text: "   " }, [{ field: "text", code: "text_required" }]],
    ["text over 4096", { text: "a".repeat(4097) }, [{ field: "text", code: "text_length" }]],
    [
      "body over 1024 with buttons",
      { text: "a".repeat(1025), buttons: buttons(1) },
      [{ field: "text", code: "text_length" }],
    ],
    [
      "4 buttons",
      { text: "Pick", buttons: buttons(4) },
      [{ field: "buttons", code: "buttons_count" }],
    ],
    [
      "empty button id",
      { text: "Pick", buttons: [{ id: "", title: "Yes" }] },
      [{ field: "buttons[0].id", code: "button_id_invalid" }],
    ],
    [
      "button id over 256",
      { text: "Pick", buttons: [{ id: "i".repeat(257), title: "Yes" }] },
      [{ field: "buttons[0].id", code: "button_id_invalid" }],
    ],
    [
      "duplicate ids",
      {
        text: "Pick",
        buttons: [
          { id: "a", title: "Yes" },
          { id: "a", title: "No" },
        ],
      },
      [{ field: "buttons[1].id", code: "button_id_duplicate" }],
    ],
    [
      "empty title",
      { text: "Pick", buttons: [{ id: "a", title: "" }] },
      [{ field: "buttons[0].title", code: "button_title_length" }],
    ],
    [
      "title over 20",
      { text: "Pick", buttons: [{ id: "a", title: "t".repeat(21) }] },
      [{ field: "buttons[0].title", code: "button_title_length" }],
    ],
    [
      "duplicate titles",
      {
        text: "Pick",
        buttons: [
          { id: "a", title: "Yes" },
          { id: "b", title: "Yes" },
        ],
      },
      [{ field: "buttons[1].title", code: "button_title_duplicate" }],
    ],
  ])("rejects %s", (_name, input, issues) => {
    expect.hasAssertions();
    expect(validateSessionInput(input)).toEqual(issues);
  });

  it("returns issues for a non-string text without throwing", () => {
    expect.hasAssertions();
    expect(validateSessionInput({ text: undefined as unknown as string })).toEqual([
      { field: "text", code: "text_required" },
    ]);
  });
});
