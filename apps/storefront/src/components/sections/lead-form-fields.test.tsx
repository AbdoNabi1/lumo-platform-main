import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LeadFormInput, LeadSubmissionResult } from "@/app/(store)/lead-actions";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const action = vi.hoisted(() => ({ submitLead: vi.fn() }));
vi.mock("@/app/(store)/lead-actions", () => action);

const { LeadFormFields } = await import("./lead-form-fields");

const FORM_ID = "00000000-0000-4000-8000-000000000001";

type Props = Parameters<typeof LeadFormFields>[0];

function show(over: Partial<Props> = {}, locale: "ar" | "en" = "en") {
  const props: Props = {
    formId: FORM_ID,
    locale,
    copy: locale === "ar" ? ar.leadForm : en.leadForm,
    submitLabel: "Send",
    successMessage: "Thanks, we will call you",
    showEmail: true,
    showMessage: true,
    ...over,
  };
  return render(<LeadFormFields {...props} />);
}

function fill(name = "Mona", phone = "01001234567") {
  fireEvent.change(screen.getByLabelText(en.leadForm.name), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(en.leadForm.phone), { target: { value: phone } });
}

const submit = () =>
  fireEvent.submit(screen.getByRole("button", { name: /Send/ }).closest("form")!);

function lastInput(): LeadFormInput {
  const calls = action.submitLead.mock.calls;
  return calls[calls.length - 1]![0] as LeadFormInput;
}

beforeEach(() => {
  expect.hasAssertions();
  action.submitLead.mockReset().mockResolvedValue({ ok: true } satisfies LeadSubmissionResult);
});

describe("LeadFormFields — fields", () => {
  it("renders name, phone, email and message with labels and the right attributes", () => {
    show();
    const name = screen.getByLabelText(en.leadForm.name);
    expect(name).toBeRequired();
    expect(name).toHaveAttribute("dir", "auto");
    expect(name).toHaveAttribute("autocomplete", "name");
    const phone = screen.getByLabelText(en.leadForm.phone);
    expect(phone).toBeRequired();
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("dir", "ltr");
    expect(phone).toHaveAttribute("inputmode", "tel");
    expect(phone).toHaveAttribute("autocomplete", "tel");
    const email = screen.getByLabelText(en.leadForm.email);
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("dir", "ltr");
    expect(email).toHaveAttribute("autocomplete", "email");
    const message = screen.getByLabelText(en.leadForm.message);
    expect(message.tagName).toBe("TEXTAREA");
    expect(message).toHaveAttribute("dir", "auto");
    expect(message).toHaveAttribute("maxlength", "2000");
  });

  it("renders only the configured fields", () => {
    show({ showEmail: false, showMessage: false });
    expect(screen.getByLabelText(en.leadForm.name)).toBeInTheDocument();
    expect(screen.getByLabelText(en.leadForm.phone)).toBeInTheDocument();
    expect(screen.queryByLabelText(en.leadForm.email)).toBeNull();
    expect(screen.queryByLabelText(en.leadForm.message)).toBeNull();
  });

  it("uses the Arabic copy in Arabic", () => {
    show({ submitLabel: "ابعت" }, "ar");
    expect(screen.getByLabelText("الاسم")).toBeInTheDocument();
    expect(screen.getByLabelText("رقم التليفون")).toBeInTheDocument();
    expect(screen.getByLabelText("الإيميل (اختياري)")).toBeInTheDocument();
    expect(screen.getByLabelText("رسالتك (اختياري)")).toBeInTheDocument();
  });

  it("hides the honeypot from assistive tech and the keyboard", () => {
    const { container } = show();
    const trap = container.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap).toHaveAttribute("autocomplete", "off");
    expect(trap).toHaveValue("");
    const wrapper = trap.closest('[aria-hidden="true"]')!;
    expect(wrapper).toHaveClass("sr-only");
    // It has a label of its own (amendment, finding 14).
    expect(wrapper.querySelector(`label[for="${trap.id}"]`)).toHaveTextContent(
      en.leadForm.honeypotLabel,
    );
    // Hidden from the accessibility tree, so no role query finds it.
    expect(screen.queryByRole("textbox", { name: en.leadForm.honeypotLabel })).toBeNull();
  });

  it("names the form by the heading when it has one", () => {
    const { container } = show({ labelledBy: "h-1" });
    expect(container.querySelector("form")).toHaveAttribute("aria-labelledby", "h-1");
  });

  it("puts the submit label in a bdi with dir auto", () => {
    show({ submitLabel: "ابعت" });
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("type", "submit");
    expect(button.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(button).toHaveTextContent("ابعت");
  });
});

describe("LeadFormFields — submit", () => {
  it("sends the form id, the typed values, the honeypot and a non-negative elapsedMs", async () => {
    show();
    fill("  Mona  ", "01001234567");
    fireEvent.change(screen.getByLabelText(en.leadForm.email), {
      target: { value: "m@example.com" },
    });
    fireEvent.change(screen.getByLabelText(en.leadForm.message), { target: { value: "hi" } });
    submit();
    await waitFor(() => {
      expect(action.submitLead).toHaveBeenCalledTimes(1);
    });
    const input = lastInput();
    expect(input).toMatchObject({
      formId: FORM_ID,
      name: "  Mona  ",
      phone: "01001234567",
      email: "m@example.com",
      message: "hi",
      honeypot: "",
    });
    expect(input.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(input.elapsedMs)).toBe(true);
    expect(input.submissionKey).toMatch(/^[A-Za-z0-9-]{8,128}$/);
  });

  it("leaves email and message out when those fields are not shown", async () => {
    show({ showEmail: false, showMessage: false });
    fill();
    submit();
    await waitFor(() => {
      expect(action.submitLead).toHaveBeenCalledTimes(1);
    });
    expect(lastInput()).not.toHaveProperty("email");
    expect(lastInput()).not.toHaveProperty("message");
  });

  it("forwards what a bot typed into the honeypot", async () => {
    const { container } = show();
    fill();
    fireEvent.change(container.querySelector('input[name="website"]')!, {
      target: { value: "http://spam.example" },
    });
    submit();
    await waitFor(() => {
      expect(action.submitLead).toHaveBeenCalledTimes(1);
    });
    expect(lastInput().honeypot).toBe("http://spam.example");
  });

  it("measures elapsedMs from the time the form appeared", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(10_000);
    show();
    fill();
    now.mockReturnValue(14_500);
    submit();
    await waitFor(() => {
      expect(action.submitLead).toHaveBeenCalledTimes(1);
    });
    expect(lastInput().elapsedMs).toBe(4_500);
    now.mockRestore();
  });

  it("disables the button while the submit is pending", async () => {
    let finish: (value: LeadSubmissionResult) => void = () => undefined;
    action.submitLead.mockReturnValue(
      new Promise<LeadSubmissionResult>((resolve) => {
        finish = resolve;
      }),
    );
    show();
    fill();
    submit();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send/ })).toBeDisabled();
    });
    finish({ ok: true });
    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  it("success replaces the form with a status message and moves focus to it", async () => {
    show();
    fill();
    submit();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Thanks, we will call you");
    expect(status).toHaveAttribute("tabindex", "-1");
    expect(status).toHaveFocus();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText(en.leadForm.name)).toBeNull();
  });
});

describe("LeadFormFields — submission key", () => {
  it("mints one key per attempt and reuses it for a retry after a failure", async () => {
    action.submitLead
      .mockResolvedValueOnce({ ok: false, reason: "network" } satisfies LeadSubmissionResult)
      .mockResolvedValueOnce({ ok: true } satisfies LeadSubmissionResult);
    show();
    fill();
    submit();
    await screen.findByRole("alert");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send/ })).toBeEnabled();
    });
    submit();
    await screen.findByRole("status");
    const [first, second] = action.submitLead.mock.calls.map((c) => c[0] as LeadFormInput);
    expect(first!.submissionKey).toBe(second!.submissionKey);
  });

  it("a second form instance gets its own key", async () => {
    const view = show();
    fill();
    submit();
    await screen.findByRole("status");
    const firstKey = lastInput().submissionKey;
    view.unmount();
    show();
    fill();
    submit();
    await screen.findByRole("status");
    expect(lastInput().submissionKey).not.toBe(firstKey);
  });
});

describe("LeadFormFields — failures", () => {
  it("validation lists the invalid field labels and marks them aria-invalid", async () => {
    action.submitLead.mockResolvedValue({
      ok: false,
      reason: "validation",
      fields: ["phone"],
    } satisfies LeadSubmissionResult);
    show();
    fill();
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`Check these details: ${en.leadForm.phone}`);
    const phone = screen.getByLabelText(en.leadForm.phone);
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveAttribute("aria-describedby", alert.id);
    const name = screen.getByLabelText(en.leadForm.name);
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(name).not.toHaveAttribute("aria-describedby");
    // The visitor's typing is kept for the retry.
    expect(phone).toHaveValue("01001234567");
  });

  it("validation joins several labels in the locale's list format", async () => {
    action.submitLead.mockResolvedValue({
      ok: false,
      reason: "validation",
      fields: ["name", "email"],
    } satisfies LeadSubmissionResult);
    show();
    fill();
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(en.leadForm.name);
    expect(alert).toHaveTextContent(en.leadForm.email);
    expect(screen.getByLabelText(en.leadForm.email)).toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    ["rate_limited", en.leadForm.errors.rateLimited],
    ["unavailable", en.leadForm.errors.unavailable],
    ["network", en.leadForm.errors.network],
  ] as const)("%s shows its message and marks no field", async (reason, text) => {
    action.submitLead.mockResolvedValue({ ok: false, reason } satisfies LeadSubmissionResult);
    show();
    fill();
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(text);
    expect(screen.getByLabelText(en.leadForm.phone)).not.toHaveAttribute("aria-invalid");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send/ })).toBeEnabled();
    });
  });

  it("a later success clears the earlier error state", async () => {
    action.submitLead
      .mockResolvedValueOnce({
        ok: false,
        reason: "validation",
        fields: ["phone"],
      } satisfies LeadSubmissionResult)
      .mockResolvedValueOnce({ ok: true } satisfies LeadSubmissionResult);
    show();
    fill();
    submit();
    await screen.findByRole("alert");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send/ })).toBeEnabled();
    });
    submit();
    await screen.findByRole("status");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
