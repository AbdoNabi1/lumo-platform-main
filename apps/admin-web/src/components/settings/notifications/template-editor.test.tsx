import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import type { TemplateDto } from "@/lib/notification-settings-model";
import { detail, template } from "./test-fixtures";
import { TemplateEditor } from "./template-editor";

const actions = vi.hoisted(() => ({
  saveTemplateAction: vi.fn(),
  revertTemplateAction: vi.fn(),
  previewTemplateAction: vi.fn(),
  sendTestEmailAction: vi.fn(),
}));
vi.mock("@/app/settings/notifications/[key]/actions", () => actions);

const copy = en.notificationSettings.editor;

beforeEach(() => {
  cleanup();
  for (const mock of Object.values(actions)) mock.mockReset();
});

function renderEditor(
  base: TemplateDto = template(),
  locale: "en" | "ar" = "en",
  t: Dictionary = en,
) {
  return render(<TemplateEditor template={base} initialLocale={locale} t={t} />);
}

const customized = (base: TemplateDto): TemplateDto => ({
  ...base,
  locales: {
    en: { ...base.locales.en, customized: true },
    ar: { ...base.locales.ar, customized: false },
  },
});

function subject(): HTMLInputElement {
  return screen.getByLabelText(copy.subjectLabel);
}
function body(): HTMLTextAreaElement {
  return screen.getByLabelText(copy.bodyLabel);
}

describe("TemplateEditor (Wave 2b)", () => {
  it("shows the subject and message for the page's language, and switches language", () => {
    expect.hasAssertions();
    renderEditor();

    expect(subject()).toHaveValue("Order {{order_number}} confirmed");
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Arabic" }));

    expect(subject()).toHaveValue("تم تأكيد الطلب {{order_number}}");
    expect(subject()).toHaveAttribute("dir", "rtl");
    expect(body()).toHaveAttribute("dir", "rtl");
  });

  it("saves the draft for the current language and shows it as saved", async () => {
    expect.hasAssertions();
    actions.saveTemplateAction.mockImplementation(
      async (input: { subject: string; body: string }) => ({
        status: "success",
        template: detail(
          template({
            locales: {
              en: { subject: input.subject, body: input.body, customized: true },
              ar: template().locales.ar,
            },
          }),
          "en",
        ),
      }),
    );
    renderEditor();
    const save = screen.getByRole("button", { name: copy.save });
    expect(save).toBeDisabled();

    fireEvent.change(subject(), { target: { value: "Thanks!" } });
    expect(screen.getByText(copy.unsaved)).toBeInTheDocument();
    fireEvent.click(save);

    expect(await screen.findByText(copy.saved)).toBeInTheDocument();
    expect(actions.saveTemplateAction).toHaveBeenCalledWith({
      key: "order_confirmation",
      locale: "en",
      subject: "Thanks!",
      body: "Hi {{customer_name}}",
    });
    expect(screen.getByText(copy.usingCustom)).toBeInTheDocument();
  });

  it("shows the server's subject and message refusals next to the boxes", async () => {
    expect.hasAssertions();
    actions.saveTemplateAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { subject: copy.subjectInvalid, body: copy.bodyInvalid },
    });
    renderEditor();

    fireEvent.change(subject(), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    expect(await screen.findByText(copy.subjectInvalid)).toBeInTheDocument();
    expect(screen.getByText(copy.bodyInvalid)).toBeInTheDocument();
    expect(subject()).toHaveValue("x");
  });

  it("offers exactly the variables the server listed as chips", () => {
    expect.hasAssertions();
    renderEditor();

    const chips = within(screen.getByRole("region", { name: copy.variablesTitle }))
      .getAllByRole("button")
      .map((chip) => chip.textContent);
    expect(chips).toEqual(["{{customer_name}}", "{{order_number}}", "{{line_items}}"]);
  });

  it("inserts a variable where the caret is in the field that was last used", () => {
    expect.hasAssertions();
    renderEditor();

    fireEvent.focus(subject());
    subject().setSelectionRange(5, 5);
    fireEvent.click(
      screen.getByRole("button", { name: copy.insertVariable.replace("{name}", "customer_name") }),
    );
    expect(subject()).toHaveValue("Order{{customer_name}} {{order_number}} confirmed");
    expect(body()).toHaveValue("Hi {{customer_name}}");

    fireEvent.focus(body());
    body().setSelectionRange(0, 2);
    fireEvent.click(
      screen.getByRole("button", { name: copy.insertVariable.replace("{name}", "order_number") }),
    );
    expect(body()).toHaveValue("{{order_number}} {{customer_name}}");
  });

  it('renders the server\'s preview in an iframe that allows nothing (sandbox="")', async () => {
    expect.hasAssertions();
    actions.previewTemplateAction.mockResolvedValue({
      status: "success",
      preview: {
        subject: "Order #1042 confirmed",
        html: "<p>Hi <b>Sara</b></p><script>alert(1)</script>",
        unknownVariables: ["nope"],
      },
    });
    renderEditor();

    fireEvent.change(body(), { target: { value: "Hi {{nope}}" } });
    fireEvent.click(screen.getByRole("button", { name: copy.preview }));

    const frame = await screen.findByTitle(copy.previewFrameTitle);
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("srcdoc", "<p>Hi <b>Sara</b></p><script>alert(1)</script>");
    expect(screen.getByText("Subject: Order #1042 confirmed")).toBeInTheDocument();
    expect(screen.getByText(/\{\{nope\}\}/, { selector: "p" })).toBeInTheDocument();
    expect(actions.previewTemplateAction).toHaveBeenCalledWith({
      key: "order_confirmation",
      locale: "en",
      subject: "Order {{order_number}} confirmed",
      body: "Hi {{nope}}",
    });
    // The server's HTML is never put into the admin page itself.
    expect(document.querySelector("script")).toBeNull();
  });

  it("clears the preview as soon as the draft changes", async () => {
    expect.hasAssertions();
    actions.previewTemplateAction.mockResolvedValue({
      status: "success",
      preview: { subject: "s", html: "<p>x</p>", unknownVariables: [] },
    });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: copy.preview }));
    await screen.findByTitle(copy.previewFrameTitle);
    fireEvent.change(body(), { target: { value: "changed" } });

    expect(screen.queryByTitle(copy.previewFrameTitle)).toBeNull();
  });

  it("sends a test to the signed-in member only, and says so", async () => {
    expect.hasAssertions();
    actions.sendTestEmailAction.mockResolvedValue({ status: "sent" });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: copy.testButton }));

    expect(await screen.findByRole("status")).toHaveTextContent(copy.testSentOwn);
    expect(actions.sendTestEmailAction).toHaveBeenCalledWith({
      key: "order_confirmation",
      locale: "en",
      subject: "Order {{order_number}} confirmed",
      body: "Hi {{customer_name}}",
    });
    expect(screen.getByText(copy.testHint)).toBeInTheDocument();
  });

  it.each([
    ["unavailable", { status: "unavailable" }, copy.testUnavailable],
    ["rate limited", { status: "rate_limited" }, copy.testRateLimited],
    ["an error", { status: "error", message: "Boom" }, "Boom"],
  ])("explains a test mail that was %s", async (_label, result, text) => {
    expect.hasAssertions();
    actions.sendTestEmailAction.mockResolvedValue(result);
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: copy.testButton }));

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  describe("Revert to default", () => {
    const body$ = () => within(document.body);

    function openDialog() {
      const trigger = screen.getByRole("button", { name: copy.revert });
      fireEvent.click(trigger);
      return trigger;
    }

    it("opens a real dialog with a title and description, focus on Cancel", async () => {
      expect.hasAssertions();
      renderEditor(customized(template()));

      openDialog();

      const dialog = await body$().findByRole("dialog", { name: copy.revertTitle });
      expect(dialog).toHaveAccessibleDescription(copy.revertBody.replace("{language}", "English"));
      await vi.waitFor(() =>
        expect(within(dialog).getByRole("button", { name: copy.cancel })).toHaveFocus(),
      );
      expect(actions.revertTemplateAction).not.toHaveBeenCalled();
    });

    it("Escape closes it without reverting and focus goes back to the trigger", async () => {
      expect.hasAssertions();
      renderEditor(customized(template()));
      const trigger = openDialog();
      const dialog = await body$().findByRole("dialog", { name: copy.revertTitle });

      fireEvent.keyDown(dialog, { key: "Escape" });

      await vi.waitFor(() => expect(body$().queryByRole("dialog")).toBeNull());
      await vi.waitFor(() => expect(trigger).toHaveFocus());
      expect(actions.revertTemplateAction).not.toHaveBeenCalled();
    });

    it("Cancel closes it without reverting", async () => {
      expect.hasAssertions();
      renderEditor(customized(template()));
      const trigger = openDialog();
      await body$().findByRole("dialog", { name: copy.revertTitle });

      fireEvent.click(body$().getByRole("button", { name: copy.cancel }));

      await vi.waitFor(() => expect(body$().queryByRole("dialog")).toBeNull());
      await vi.waitFor(() => expect(trigger).toHaveFocus());
      expect(actions.revertTemplateAction).not.toHaveBeenCalled();
    });

    it("Escape still closes it while the revert is in flight, and the result still lands", async () => {
      expect.hasAssertions();
      let finish: (value: unknown) => void = () => undefined;
      actions.revertTemplateAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      renderEditor(customized(template()));
      openDialog();
      const dialog = await body$().findByRole("dialog", { name: copy.revertTitle });

      fireEvent.click(within(dialog).getByRole("button", { name: copy.revertConfirm }));
      await vi.waitFor(() => expect(actions.revertTemplateAction).toHaveBeenCalled());
      fireEvent.keyDown(dialog, { key: "Escape" });

      await vi.waitFor(() => expect(body$().queryByRole("dialog")).toBeNull());
      finish({ status: "success", template: detail(template(), "en") });
      await vi.waitFor(() => expect(screen.getByText(copy.usingDefault)).toBeInTheDocument());
    });

    it("deletes the copy for that language only, restores the default text and closes", async () => {
      expect.hasAssertions();
      actions.revertTemplateAction.mockResolvedValue({
        status: "success",
        template: detail(
          template({
            locales: {
              en: { subject: "Default subject", body: "Default body", customized: false },
              ar: template().locales.ar,
            },
          }),
          "en",
        ),
      });
      renderEditor(customized(template()));
      fireEvent.change(subject(), { target: { value: "My edit" } });

      openDialog();
      const dialog = await body$().findByRole("dialog", { name: copy.revertTitle });
      fireEvent.click(within(dialog).getByRole("button", { name: copy.revertConfirm }));

      await vi.waitFor(() => expect(body$().queryByRole("dialog")).toBeNull());
      expect(actions.revertTemplateAction).toHaveBeenCalledWith({
        key: "order_confirmation",
        locale: "en",
      });
      expect(subject()).toHaveValue("Default subject");
      expect(body()).toHaveValue("Default body");
      expect(screen.getByText(copy.usingDefault)).toBeInTheDocument();
    });

    it("keeps the dialog open and says why when the revert is refused", async () => {
      expect.hasAssertions();
      actions.revertTemplateAction.mockResolvedValue({
        status: "error",
        message: en.formErrors.forbidden,
        fieldErrors: {},
      });
      renderEditor(customized(template()));

      openDialog();
      const dialog = await body$().findByRole("dialog", { name: copy.revertTitle });
      fireEvent.click(within(dialog).getByRole("button", { name: copy.revertConfirm }));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(en.formErrors.forbidden);
      expect(body$().getByRole("dialog")).toBeInTheDocument();
    });

    it("does not open when there is no saved copy to revert", () => {
      expect.hasAssertions();
      renderEditor();

      const trigger = screen.getByRole("button", { name: copy.revert });
      expect(trigger).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(trigger);

      expect(body$().queryByRole("dialog")).toBeNull();
    });
  });

  it("renders in Arabic", () => {
    expect.hasAssertions();
    renderEditor(template(), "ar", ar);

    const arCopy = ar.notificationSettings.editor;
    expect(screen.getByLabelText(arCopy.subjectLabel)).toHaveValue(
      "تم تأكيد الطلب {{order_number}}",
    );
    expect(screen.getByRole("button", { name: arCopy.preview })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: arCopy.revert })).toBeInTheDocument();
  });
});
