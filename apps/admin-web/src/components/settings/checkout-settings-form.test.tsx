import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import type { CheckoutSettingsDto } from "@/lib/api/checkout-settings";
import type { CheckoutSettingsSaveState } from "@/lib/checkout-settings-save";
import { CheckoutSettingsForm } from "./checkout-settings-form";

const saveAction =
  vi.fn<
    (previous: CheckoutSettingsSaveState, formData: FormData) => Promise<CheckoutSettingsSaveState>
  >();
vi.mock("@/app/settings/checkout/actions", () => ({
  saveCheckoutSettingsAction: (previous: CheckoutSettingsSaveState, formData: FormData) =>
    saveAction(previous, formData),
}));

const DEFAULTS: CheckoutSettingsDto = {
  nameMode: "required",
  phoneMode: "required",
  line2Mode: "optional",
  marketingEmailPrompt: "hidden",
  cartLineLimit: null,
  requireLogin: false,
  accountsMode: "optional",
  showAccountLink: true,
  version: null,
};

const t = en.checkoutSettings;

beforeEach(() => {
  saveAction.mockReset().mockResolvedValue({ status: "success", version: 1 });
});

function renderForm(overrides: Partial<CheckoutSettingsDto> = {}, dictionary: Dictionary = en) {
  return render(<CheckoutSettingsForm t={dictionary} settings={{ ...DEFAULTS, ...overrides }} />);
}

function group(name: string): HTMLElement {
  return screen.getByRole("group", { name });
}

function chosen(legend: string): string | undefined {
  return (
    within(group(legend))
      .getAllByRole("radio")
      .find((radio) => (radio as HTMLInputElement).checked)
      ?.getAttribute("value") ?? undefined
  );
}

function pick(legend: string, label: string): void {
  fireEvent.click(within(group(legend)).getByRole("radio", { name: label }));
}

function save(): HTMLElement {
  return screen.getByRole("button", { name: t.save });
}

async function submitted(): Promise<FormData> {
  fireEvent.click(save());
  await vi.waitFor(() => expect(saveAction).toHaveBeenCalled());
  const call = saveAction.mock.calls.at(-1);
  if (call === undefined) throw new Error("the action was not called");
  return call[1];
}

describe("CheckoutSettingsForm (Wave 2a)", () => {
  it("renders today's defaults: name and phone required, line 2 optional, nothing else on", () => {
    expect.hasAssertions();
    renderForm();

    expect(chosen(t.nameLegend)).toBe("required");
    expect(chosen(t.phoneLegend)).toBe("required");
    expect(chosen(t.line2Legend)).toBe("optional");
    expect(chosen(t.marketingLegend)).toBe("hidden");
    expect(screen.getByRole("switch", { name: t.requireLoginLabel })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: t.limitLabel })).not.toBeChecked();
    expect(screen.queryByLabelText(t.limitInputLabel)).toBeNull();
    expect(save()).toBeDisabled();
  });

  it("groups the page like Shopify: customer information, marketing, accounts, advanced", () => {
    expect.hasAssertions();
    renderForm();

    for (const title of [t.customerInfoTitle, t.marketingTitle, t.accountsTitle, t.advancedTitle]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText(t.notAvailableYet)).toBeInTheDocument();
  });

  it("offers no way to hide the phone number and says why", () => {
    expect.hasAssertions();
    renderForm();

    expect(within(group(t.phoneLegend)).getAllByRole("radio")).toHaveLength(2);
    expect(within(group(t.phoneLegend)).getByText(t.phoneNoHide)).toBeInTheDocument();
  });

  it("offers hidden / optional / required for line 2 and three marketing choices", () => {
    expect.hasAssertions();
    renderForm();

    expect(within(group(t.line2Legend)).getAllByRole("radio")).toHaveLength(3);
    expect(
      within(group(t.marketingLegend))
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value")),
    ).toEqual(["hidden", "show", "preselect"]);
  });

  it("shows the legal warning under Preselect, and no pre-ticked choice by default", () => {
    expect.hasAssertions();
    renderForm();

    const preselect = within(group(t.marketingLegend)).getByRole("radio", {
      name: t.marketingPreselect,
    });
    expect(preselect).not.toBeChecked();
    expect(preselect).toHaveAccessibleDescription(
      expect.stringContaining(t.marketingPreselectWarning),
    );
    expect(screen.getByRole("note")).toHaveTextContent(t.marketingPreselectWarning);
  });

  it("sends the version the page loaded as a hidden field ('' while no row exists)", () => {
    expect.hasAssertions();
    const { container, unmount } = renderForm();
    expect(container.querySelector<HTMLInputElement>("input[name=expectedVersion]")?.value).toBe(
      "",
    );
    unmount();

    const second = renderForm({ version: 5 });
    expect(
      second.container.querySelector<HTMLInputElement>("input[name=expectedVersion]")?.value,
    ).toBe("5");
  });

  it("keeps Save off until something changes, and off again when it is undone", () => {
    expect.hasAssertions();
    renderForm();

    pick(t.nameLegend, t.nameOptional);
    expect(save()).toBeEnabled();
    expect(screen.getByText(t.unsaved)).toBeInTheDocument();

    pick(t.nameLegend, t.nameRequired);
    expect(save()).toBeDisabled();
  });

  it("posts every choice, the limit and the switches when saved", async () => {
    expect.hasAssertions();
    renderForm({ version: 3 });

    pick(t.nameLegend, t.nameOptional);
    pick(t.phoneLegend, t.phoneOptional);
    pick(t.line2Legend, t.line2Required);
    pick(t.marketingLegend, t.marketingShow);
    fireEvent.click(screen.getByRole("switch", { name: t.requireLoginLabel }));
    fireEvent.click(screen.getByRole("switch", { name: t.limitLabel }));
    fireEvent.change(screen.getByLabelText(t.limitInputLabel), { target: { value: "12" } });

    const data = await submitted();

    expect(Object.fromEntries(data.entries())).toEqual({
      expectedVersion: "3",
      nameMode: "optional",
      phoneMode: "optional",
      line2Mode: "required",
      marketingEmailPrompt: "show",
      requireLogin: "on",
      cartLimitOn: "on",
      cartLineLimit: "12",
    });
  });

  it("an existing limit shows its number, and turning the limit off posts no number box", async () => {
    expect.hasAssertions();
    renderForm({ cartLineLimit: 8, version: 2 });
    expect(screen.getByLabelText(t.limitInputLabel)).toHaveValue(8);
    expect(screen.getByRole("switch", { name: t.limitLabel })).toBeChecked();

    fireEvent.click(screen.getByRole("switch", { name: t.limitLabel }));
    expect(screen.queryByLabelText(t.limitInputLabel)).toBeNull();

    const data = await submitted();
    expect(data.get("cartLimitOn")).toBeNull();
    expect(data.get("cartLineLimit")).toBeNull();
  });

  it("explains the limit applies per item", () => {
    expect.hasAssertions();
    renderForm();

    expect(screen.getByText(t.limitHint)).toBeInTheDocument();
  });

  it("while accounts are off, require sign-in is off and disabled, with the reason and a link", async () => {
    expect.hasAssertions();
    renderForm({ accountsMode: "disabled", version: 4 });

    const toggle = screen.getByRole("switch", { name: t.requireLoginLabel });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(t.requireLoginOffReason)).toBeInTheDocument();
    expect(toggle).toHaveAccessibleDescription(t.requireLoginOffReason);
    expect(screen.getByRole("link", { name: t.accountsLink })).toHaveAttribute(
      "href",
      "/settings/customer-accounts",
    );
    pick(t.nameLegend, t.nameOptional);
    expect((await submitted()).get("requireLogin")).toBeNull();
  });

  it("with accounts on, require sign-in can be turned on and explains itself", () => {
    expect.hasAssertions();
    renderForm();

    const toggle = screen.getByRole("switch", { name: t.requireLoginLabel });
    expect(toggle).toBeEnabled();
    expect(screen.getByText(t.requireLoginHint)).toBeInTheDocument();
    expect(screen.queryByText(t.requireLoginOffReason)).toBeNull();
  });

  it("shows Saved after a successful save and posts the NEW version next time", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({ status: "success", version: 8 });
    renderForm({ version: 7 });

    pick(t.nameLegend, t.nameOptional);
    expect((await submitted()).get("expectedVersion")).toBe("7");

    expect(await screen.findByText(t.saved)).toBeInTheDocument();
    expect(save()).toBeDisabled();

    pick(t.nameLegend, t.nameRequired);
    expect((await submitted()).get("expectedVersion")).toBe("8");
  });

  it("shows a 409 and replaces the form with the newer settings", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({ status: "error", message: t.conflict, fieldErrors: {} });
    const settings = { ...DEFAULTS, version: 2 };
    const { rerender } = render(<CheckoutSettingsForm t={en} settings={settings} />);
    pick(t.nameLegend, t.nameOptional);

    await submitted();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "These settings were changed by someone else. Reload to see the latest version.",
    );

    // The action revalidated both pages: the page re-renders with what the other person saved.
    await act(async () => {
      rerender(
        <CheckoutSettingsForm
          t={en}
          settings={{ ...settings, version: 3, phoneMode: "optional", line2Mode: "hidden" }}
        />,
      );
    });
    expect(chosen(t.phoneLegend)).toBe("optional");
    expect(chosen(t.line2Legend)).toBe("hidden");
    expect(chosen(t.nameLegend)).toBe("required");
    expect(save()).toBeDisabled();
  });

  it("keeps what was typed when the page re-renders at the SAME version (a refused save)", async () => {
    expect.hasAssertions();
    const settings = { ...DEFAULTS, version: 2 };
    const { rerender } = render(<CheckoutSettingsForm t={en} settings={settings} />);
    pick(t.nameLegend, t.nameOptional);

    await act(async () => {
      rerender(<CheckoutSettingsForm t={en} settings={{ ...settings }} />);
    });

    expect(chosen(t.nameLegend)).toBe("optional");
    expect(save()).toBeEnabled();
  });

  it("shows the server's 422 messages next to the fields", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({
      status: "error",
      message: "Invalid checkout settings",
      fieldErrors: {
        cartLineLimit: "Enter a whole number from 1 to 999.",
        requireLogin: "Customer accounts must be on to require login",
      },
    });
    renderForm({ cartLineLimit: 5, version: 1 });
    fireEvent.change(screen.getByLabelText(t.limitInputLabel), { target: { value: "5000" } });

    await submitted();

    expect(await screen.findByText("Enter a whole number from 1 to 999.")).toBeInTheDocument();
    expect(screen.getByText("Customer accounts must be on to require login")).toBeInTheDocument();
    expect(screen.getByLabelText(t.limitInputLabel)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Invalid checkout settings")).toBeInTheDocument();
  });

  it("renders in Arabic with no physical-side classes", () => {
    expect.hasAssertions();
    const { container } = renderForm({ version: 1 }, ar);

    expect(group(ar.checkoutSettings.nameLegend)).toBeInTheDocument();
    expect(screen.getByText(ar.checkoutSettings.marketingPreselectWarning)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.checkoutSettings.save })).toBeInTheDocument();
    const classes = Array.from(container.querySelectorAll("[class]"))
      .map((element) => element.getAttribute("class") ?? "")
      .join(" ")
      .split(/\s+/);
    expect(
      classes.filter((cls) => /(^|:)(ml|mr|pl|pr|left|right|text-left|text-right)(-|$)/.test(cls)),
    ).toEqual([]);
  });
});
