import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { TemplateForm } from "./template-form";

const mocks = vi.hoisted(() => ({
  createTemplateAction: vi.fn(),
  push: vi.fn(),
  uuid: vi.fn(),
}));
vi.mock("@/app/settings/whatsapp/templates/actions", () => ({
  createTemplateAction: mocks.createTemplateAction,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const copy = en.whatsappTemplates.form;
const issues = en.whatsappTemplates.issues;

let uuidCounter = 0;
function renderForm(t: Dictionary = en, locale = "en") {
  return render(<TemplateForm t={t} locale={locale} />);
}
function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function submitButton() {
  return screen.getByRole("button", { name: new RegExp(`^(${copy.submit}|${copy.retry})$`) });
}
/** Clicks submit once the previous submission has settled (the button is back and enabled). */
async function clickSubmit() {
  await waitFor(() => expect(submitButton()).toBeEnabled());
  fireEvent.click(submitButton());
}
/** Fills a valid UTILITY template. */
function fillValid() {
  type(copy.name, "order_update");
  type(copy.body, "Hi {{1}}, your order is on its way today.");
  type("Example for variable 1", "Sara");
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  uuidCounter = 0;
  mocks.uuid.mockImplementation(
    () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`,
  );
  vi.stubGlobal("crypto", {
    randomUUID: mocks.uuid,
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
  mocks.createTemplateAction.mockReset().mockResolvedValue({ status: "success" });
});

describe("name: auto-slug from a label", () => {
  it("lowercases, turns spaces into underscores, strips the rest and shows the final name", () => {
    expect.hasAssertions();
    renderForm();
    type(copy.label, "Order Shipped!");
    expect(screen.getByLabelText(copy.name)).toHaveValue("order_shipped");
    expect(screen.getByText("order_shipped", { selector: "bdi" })).toHaveAttribute("dir", "ltr");
    expect(document.body).toHaveTextContent(`${copy.finalName} order_shipped`);
  });

  it("stops following the label once the name was edited by hand", () => {
    expect.hasAssertions();
    renderForm();
    type(copy.label, "Order Shipped");
    type(copy.name, "my_name");
    type(copy.label, "Something Else");
    expect(screen.getByLabelText(copy.name)).toHaveValue("my_name");
  });

  it("an Arabic label gives an empty name and the name_format message (the merchant types a name)", () => {
    expect.hasAssertions();
    renderForm(ar, "ar");
    type(ar.whatsappTemplates.form.label, "طلبك اتشحن");
    expect(screen.getByLabelText(ar.whatsappTemplates.form.name)).toHaveValue("");
    expect(document.body).toHaveTextContent(ar.whatsappTemplates.issues.name_format);
  });
});

describe("validation messages (client mirror of the Task 2 rules)", () => {
  it("name_format: shows the message for an invalid name and clears it for a valid one", () => {
    expect.hasAssertions();
    renderForm();
    type(copy.name, "Order Shipped");
    const input = screen.getByLabelText(copy.name);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.body).toHaveTextContent(issues.name_format);
    type(copy.name, "order_shipped");
    expect(screen.getByLabelText(copy.name)).toHaveAttribute("aria-invalid", "false");
    expect(document.body).not.toHaveTextContent(issues.name_format);
  });

  it("examples_mismatch: a server 422 on body.examples shows its localized message next to the body", async () => {
    expect.hasAssertions();
    mocks.createTemplateAction.mockResolvedValue({
      status: "invalid",
      message: en.formErrors.invalid,
      fieldErrors: { "body.examples": issues.examples_mismatch },
    });
    renderForm();
    fillValid();
    fireEvent.click(submitButton());
    expect(await screen.findByText(issues.examples_mismatch)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(copy.fixIssues);
    // Editing the body clears the server message for that group.
    type(copy.body, "Hi {{1}}, your order is on its way now.");
    expect(screen.queryByText(issues.examples_mismatch)).toBeNull();
  });

  it("one example input per distinct variable keeps the example count in step with the body", () => {
    expect.hasAssertions();
    renderForm();
    type(copy.body, "A {{1}} b {{2}} c {{1}} d");
    expect(screen.getAllByLabelText(/^Example for variable \d$/)).toHaveLength(2);
    type(copy.body, "A {{1}} b");
    expect(screen.getAllByLabelText(/^Example for variable \d$/)).toHaveLength(1);
    type(copy.body, "no variables here at all");
    expect(screen.queryByLabelText(/^Example for variable/)).toBeNull();
  });

  it("example_empty: an unfilled example is reported once the body was touched", () => {
    expect.hasAssertions();
    renderForm();
    type(copy.body, "Hi {{1}}, your order is on its way.");
    expect(document.body).toHaveTextContent(issues.example_empty);
    type("Example for variable 1", "Sara");
    expect(document.body).not.toHaveTextContent(issues.example_empty);
  });

  it("button_text_length: a quick reply over 25 characters shows the message", () => {
    expect.hasAssertions();
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: copy.addQuickReply }));
    type("Quick reply 1", "x".repeat(26));
    expect(document.body).toHaveTextContent(issues.button_text_length);
    type("Quick reply 1", "x".repeat(25));
    expect(document.body).not.toHaveTextContent(issues.button_text_length);
  });

  it.each([
    ["body_length", () => type(copy.body, "   ")],
    ["variable_malformed", () => type(copy.body, "Hi {{ 1 }} there friend")],
    ["variables_not_sequential", () => type(copy.body, "A {{1}} b {{3}} c")],
    ["variables_adjacent", () => type(copy.body, "A {{1}}{{2}} b")],
    ["variable_at_edge", () => type(copy.body, "{{1}} shipped today")],
    ["footer_variables", () => type(copy.footer, "Order {{1}}")],
    ["footer_length", () => type(copy.footer, "f".repeat(61))],
    ["header_length", () => type(copy.header, "h".repeat(61))],
    ["header_variables", () => type(copy.header, "A {{1}} b {{2}}")],
  ] as const)("shows the %s message", (code, act) => {
    expect.hasAssertions();
    renderForm();
    act();
    expect(document.body).toHaveTextContent(issues[code]);
  });

  it("header example (B12): a header with {{1}} shows a required example input and the header_example_missing message", () => {
    expect.hasAssertions();
    renderForm();
    expect(screen.queryByLabelText(copy.headerExample)).toBeNull();
    type(copy.header, "Order {{1}}");
    const example = screen.getByLabelText(copy.headerExample);
    expect(example).toHaveAttribute("aria-required", "true");
    expect(document.body).toHaveTextContent(issues.header_example_missing);
    type(copy.headerExample, "1001");
    expect(document.body).not.toHaveTextContent(issues.header_example_missing);
  });

  it("URL buttons: a variable at the end asks for an example link (url_example_missing), then accepts it", () => {
    expect.hasAssertions();
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: copy.addUrlButton }));
    type("Link button 1 label", "Track");
    type(/^Link 1 \(https/, "https://shop.example.com/o/{{1}}");
    expect(document.body).toHaveTextContent(issues.url_example_missing);
    type("Example link 1", "https://shop.example.com/o/1001");
    expect(document.body).not.toHaveTextContent(issues.url_example_missing);
    type(/^Link 1 \(https/, "http://shop.example.com");
    expect(document.body).toHaveTextContent(issues.url_invalid);
  });

  it("limits the UI to 3 quick replies and 2 link buttons", () => {
    expect.hasAssertions();
    renderForm();
    for (let i = 0; i < 4; i++)
      fireEvent.click(screen.getByRole("button", { name: copy.addQuickReply }));
    expect(screen.getAllByLabelText(/^Quick reply \d$/)).toHaveLength(3);
    expect(screen.getByRole("button", { name: copy.addQuickReply })).toBeDisabled();
    for (let i = 0; i < 3; i++)
      fireEvent.click(screen.getByRole("button", { name: copy.addUrlButton }));
    expect(screen.getAllByLabelText(/^Link button \d label$/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: copy.addUrlButton })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Remove: Quick reply 1$/ }));
    expect(screen.getAllByLabelText(/^Quick reply \d$/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: copy.addQuickReply })).toBeEnabled();
  });
});

describe("Add variable", () => {
  it("inserts the next {{n}} at the caret and is repeatable", () => {
    expect.hasAssertions();
    renderForm();
    const body = screen.getByLabelText(copy.body) as HTMLTextAreaElement;
    type(copy.body, "Hi , your order");
    body.setSelectionRange(3, 3);
    fireEvent.click(screen.getByRole("button", { name: copy.addVariable }));
    expect(body.value).toBe("Hi {{1}}, your order");
    body.setSelectionRange(body.value.length, body.value.length);
    fireEvent.click(screen.getByRole("button", { name: copy.addVariable }));
    expect(body.value).toBe("Hi {{1}}, your order{{2}}");
    expect(screen.getAllByLabelText(/^Example for variable \d$/)).toHaveLength(2);
  });
});

describe("language, category and the preview", () => {
  it("lists the four languages and the two categories, Arabic first when the admin is Arabic", () => {
    expect.hasAssertions();
    renderForm();
    const options = within(screen.getByLabelText(copy.language)).getAllByRole("option");
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "ar",
      "en",
      "en_US",
      "en_GB",
    ]);
    expect(screen.getByLabelText(/Utility/)).toBeChecked();
    expect(screen.getByText(copy.categoryUtilityHint)).toBeInTheDocument();
    expect(screen.getByText(copy.categoryMarketingHint)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Marketing/));
    expect(screen.getByLabelText(/Marketing/)).toBeChecked();
    cleanup();
    renderForm(ar, "ar");
    expect(screen.getByLabelText(ar.whatsappTemplates.form.language)).toHaveValue("ar");
  });

  it("the live preview substitutes the examples and renders Arabic text in a dir=auto element", () => {
    expect.hasAssertions();
    renderForm(ar, "ar");
    type(ar.whatsappTemplates.form.body, "أهلاً {{1}}، طلبك اتشحن النهارده ومعاه هدية.");
    type(/^مثال للمتغيّر 1$/, "سارة");
    const body = screen.getByTestId("preview-body");
    expect(body).toHaveAttribute("dir", "auto");
    expect(body).toHaveTextContent("أهلاً سارة، طلبك اتشحن النهارده ومعاه هدية.");
    fireEvent.click(screen.getByRole("button", { name: ar.whatsappTemplates.form.addQuickReply }));
    type(/^الرد السريع 1$/, "تمام");
    expect(screen.getByTestId("preview-button")).toHaveTextContent("تمام");
  });

  it("text inputs that hold free text carry dir=auto and start alignment", () => {
    expect.hasAssertions();
    renderForm();
    for (const label of [copy.label, copy.header, copy.body, copy.footer]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("dir", "auto");
      expect(screen.getByLabelText(label).className).toContain("text-start");
    }
    expect(screen.getByLabelText(copy.name)).toHaveAttribute("dir", "ltr");
  });
});

describe("submitting", () => {
  it("does not call the API while the draft has issues, and says so", () => {
    expect.hasAssertions();
    renderForm();
    fireEvent.click(submitButton());
    expect(mocks.createTemplateAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(copy.fixIssues);
    expect(document.body).toHaveTextContent(issues.name_format);
    expect(document.body).toHaveTextContent(issues.body_length);
  });

  it("submits the draft with one key, then navigates back to the list", async () => {
    expect.hasAssertions();
    renderForm();
    fillValid();
    type(copy.footer, "Reply STOP to opt out");
    fireEvent.click(screen.getByRole("button", { name: copy.addQuickReply }));
    type("Quick reply 1", "Thanks");
    fireEvent.click(screen.getByRole("button", { name: copy.addUrlButton }));
    type("Link button 1 label", "Track");
    type(/^Link 1 \(https/, "https://shop.example.com/o/{{1}}");
    type("Example link 1", "https://shop.example.com/o/1001");
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.createTemplateAction).toHaveBeenCalledTimes(1));
    expect(mocks.createTemplateAction).toHaveBeenCalledWith({
      draft: {
        name: "order_update",
        language: "en",
        category: "UTILITY",
        body: { text: "Hi {{1}}, your order is on its way today.", examples: ["Sara"] },
        footer: { text: "Reply STOP to opt out" },
        buttons: [
          { type: "QUICK_REPLY", text: "Thanks" },
          {
            type: "URL",
            text: "Track",
            url: "https://shop.example.com/o/{{1}}",
            example: "https://shop.example.com/o/1001",
          },
        ],
      },
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/settings/whatsapp/templates"));
    expect(await screen.findByRole("status")).toHaveTextContent(copy.submitted);
    await waitFor(() => expect(submitButton()).toBeDisabled());
  });

  it("includes the header and its example only when the header has a variable", async () => {
    expect.hasAssertions();
    renderForm();
    fillValid();
    type(copy.header, "Order {{1}}");
    type(copy.headerExample, "1001");
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.createTemplateAction).toHaveBeenCalledTimes(1));
    expect(mocks.createTemplateAction.mock.calls[0]?.[0].draft.header).toEqual({
      format: "TEXT",
      text: "Order {{1}}",
      example: "1001",
    });
  });

  it("a double submit while pending makes one call", async () => {
    expect.hasAssertions();
    let release!: (value: { status: "success" }) => void;
    mocks.createTemplateAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderForm();
    fillValid();
    const form = submitButton().closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.createTemplateAction).toHaveBeenCalledTimes(1);
    release({ status: "success" });
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
  });

  it("a 422 shows each field's localized message beside its input and releases the form (new key next time)", async () => {
    expect.hasAssertions();
    mocks.createTemplateAction
      .mockResolvedValueOnce({
        status: "invalid",
        message: en.formErrors.invalid,
        fieldErrors: { name: issues.name_format, "footer.text": issues.footer_length },
      })
      .mockResolvedValueOnce({ status: "success" });
    renderForm();
    fillValid();
    fireEvent.click(submitButton());
    expect(await screen.findAllByText(issues.name_format)).toHaveLength(1);
    expect(screen.getByText(issues.footer_length)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(copy.name)).toBeEnabled());
    type(copy.name, "order_update_2");
    expect(screen.queryByText(issues.name_format)).toBeNull();
    await clickSubmit();
    await waitFor(() => expect(mocks.createTemplateAction).toHaveBeenCalledTimes(2));
    const keys = mocks.createTemplateAction.mock.calls.map((c) => c[0].idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("a definitive refusal (409) shows the mapped message and releases the form with a new key", async () => {
    expect.hasAssertions();
    mocks.createTemplateAction
      .mockResolvedValueOnce({
        status: "refused",
        message: en.whatsappTemplates.errors.TEMPLATE_ALREADY_EXISTS,
      })
      .mockResolvedValueOnce({ status: "success" });
    renderForm();
    fillValid();
    fireEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.whatsappTemplates.errors.TEMPLATE_ALREADY_EXISTS,
    );
    await waitFor(() => expect(screen.getByLabelText(copy.name)).toBeEnabled());
    await clickSubmit();
    await waitFor(() => expect(mocks.createTemplateAction).toHaveBeenCalledTimes(2));
    expect(mocks.createTemplateAction.mock.calls[0]?.[0].idempotencyKey).not.toBe(
      mocks.createTemplateAction.mock.calls[1]?.[0].idempotencyKey,
    );
  });
});

describe("unresolved submission (lost response)", () => {
  async function loseResponse() {
    mocks.createTemplateAction.mockResolvedValueOnce({
      status: "error",
      message: en.whatsappTemplates.errors.generic,
    });
    renderForm();
    fillValid();
    fireEvent.click(submitButton());
    expect(await screen.findByText(copy.lostResponse)).toBeInTheDocument();
    await waitFor(() => expect(submitButton()).toBeEnabled());
  }

  it("locks every field, keeps the payload and key, and 'Submit again' sends the exact same request", async () => {
    expect.hasAssertions();
    await loseResponse();
    for (const label of [
      copy.label,
      copy.name,
      copy.language,
      copy.header,
      copy.body,
      copy.footer,
    ]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(screen.getByLabelText("Example for variable 1")).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.addVariable })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.addQuickReply })).toBeDisabled();
    expect(submitButton()).toHaveTextContent(copy.retry);
    expect(submitButton()).toBeEnabled();
    expect(uuidCounter).toBe(1);
    await clickSubmit();
    await waitFor(() => expect(mocks.createTemplateAction).toHaveBeenCalledTimes(2));
    expect(mocks.createTemplateAction.mock.calls[1]?.[0]).toEqual(
      mocks.createTemplateAction.mock.calls[0]?.[0],
    );
    // One key for the whole submission; the only other key made is the one the NEXT submission would use.
    expect(uuidCounter).toBe(2);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
  });

  it("a thrown call is also unresolved (same payload, same key on retry)", async () => {
    expect.hasAssertions();
    mocks.createTemplateAction.mockRejectedValueOnce(new Error("socket hang up"));
    renderForm();
    fillValid();
    fireEvent.click(submitButton());
    expect(await screen.findByText(copy.lostResponse)).toBeInTheDocument();
    await clickSubmit();
    await waitFor(() => expect(mocks.createTemplateAction).toHaveBeenCalledTimes(2));
    expect(mocks.createTemplateAction.mock.calls[1]?.[0]).toEqual(
      mocks.createTemplateAction.mock.calls[0]?.[0],
    );
  });

  it("after the retry is definitive the next submission gets a new key", async () => {
    expect.hasAssertions();
    await loseResponse();
    mocks.createTemplateAction.mockResolvedValueOnce({
      status: "refused",
      message: en.whatsappTemplates.errors.TEMPLATE_ALREADY_EXISTS,
    });
    await clickSubmit();
    await screen.findByText(en.whatsappTemplates.errors.TEMPLATE_ALREADY_EXISTS);
    await waitFor(() => expect(screen.getByLabelText(copy.name)).toBeEnabled());
    await clickSubmit();
    await waitFor(() => expect(mocks.createTemplateAction).toHaveBeenCalledTimes(3));
    expect(mocks.createTemplateAction.mock.calls[2]?.[0].idempotencyKey).not.toBe(
      mocks.createTemplateAction.mock.calls[0]?.[0].idempotencyKey,
    );
  });
});

describe("Arabic / RTL", () => {
  it("renders the Arabic labels and keeps the machine-readable fields LTR", () => {
    expect.hasAssertions();
    renderForm(ar, "ar");
    expect(screen.getByLabelText(ar.whatsappTemplates.form.name)).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText(ar.whatsappTemplates.form.body)).toHaveAttribute("dir", "auto");
    expect(
      screen.getByRole("button", { name: ar.whatsappTemplates.form.submit }),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(en.whatsappTemplates.form.submit);
  });
});
