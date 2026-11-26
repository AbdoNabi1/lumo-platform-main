import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import type { CheckoutSettingsDto } from "@/lib/api/checkout-settings";
import type { CheckoutSettingsSaveState } from "@/lib/checkout-settings-save";
import { CustomerAccountsForm } from "./customer-accounts-form";

const saveAction =
  vi.fn<
    (previous: CheckoutSettingsSaveState, formData: FormData) => Promise<CheckoutSettingsSaveState>
  >();
vi.mock("@/app/settings/customer-accounts/actions", () => ({
  saveCustomerAccountsAction: (previous: CheckoutSettingsSaveState, formData: FormData) =>
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

const t = en.customerAccountSettings;

beforeEach(() => {
  saveAction.mockReset().mockResolvedValue({ status: "success", version: 1 });
});

function renderForm(overrides: Partial<CheckoutSettingsDto> = {}, dictionary: Dictionary = en) {
  return render(<CustomerAccountsForm t={dictionary} settings={{ ...DEFAULTS, ...overrides }} />);
}

function accounts(): HTMLElement {
  return screen.getByRole("group", { name: t.accountsLegend });
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

describe("CustomerAccountsForm (Wave 2a)", () => {
  it("renders today's defaults: accounts on, account link shown", () => {
    expect.hasAssertions();
    renderForm();

    expect(within(accounts()).getByRole("radio", { name: t.accountsOn })).toBeChecked();
    expect(within(accounts()).getByRole("radio", { name: t.accountsOff })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: t.showLinkLabel })).toBeChecked();
    expect(save()).toBeDisabled();
    expect(screen.getByText(t.notAvailableYet)).toBeInTheDocument();
  });

  it("explains what turning accounts off does (guest checkout and signed-in customers)", () => {
    expect.hasAssertions();
    renderForm();

    const off = within(accounts()).getByRole("radio", { name: t.accountsOff });
    expect(off).toHaveAccessibleDescription(
      expect.stringContaining("Guest checkout keeps working"),
    );
    expect(off).toHaveAccessibleDescription(expect.stringContaining("until their session ends"));
  });

  it("posts the accounts choice, the link switch and the loaded version", async () => {
    expect.hasAssertions();
    renderForm({ version: 4 });

    fireEvent.click(within(accounts()).getByRole("radio", { name: t.accountsOff }));
    fireEvent.click(screen.getByRole("switch", { name: t.showLinkLabel }));

    expect(Object.fromEntries((await submitted()).entries())).toEqual({
      expectedVersion: "4",
      accountsMode: "disabled",
    });
    expect(screen.getByText(t.showLinkOffNote, { exact: false })).toBeInTheDocument();
  });

  it("sends '' as the version for a shop with no row yet", async () => {
    expect.hasAssertions();
    renderForm();
    fireEvent.click(screen.getByRole("switch", { name: t.showLinkLabel }));

    expect((await submitted()).get("expectedVersion")).toBe("");
  });

  it("disables 'Off' while sign-in is required at checkout, with the reason and a link", () => {
    expect.hasAssertions();
    renderForm({ requireLogin: true, version: 2 });

    const off = within(accounts()).getByRole("radio", { name: t.accountsOff });
    expect(off).toBeDisabled();
    expect(screen.getByText(t.requireLoginBlocked, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t.checkoutLink })).toHaveAttribute(
      "href",
      "/settings/checkout",
    );
  });

  it("shows the server's 422 on requireLogin under the accounts choice (a stale page)", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({
      status: "error",
      message: "Invalid checkout settings",
      fieldErrors: { requireLogin: "Customer accounts must be on to require login" },
    });
    renderForm({ version: 2 });
    fireEvent.click(within(accounts()).getByRole("radio", { name: t.accountsOff }));

    await submitted();

    expect(
      await within(accounts()).findByText("Customer accounts must be on to require login"),
    ).toBeInTheDocument();
  });

  it("shows a 409 and replaces the form with the newer settings", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({
      status: "error",
      message: en.checkoutSettings.conflict,
      fieldErrors: {},
    });
    const settings = { ...DEFAULTS, version: 2 };
    const { rerender } = render(<CustomerAccountsForm t={en} settings={settings} />);
    fireEvent.click(screen.getByRole("switch", { name: t.showLinkLabel }));

    await submitted();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "These settings were changed by someone else. Reload to see the latest version.",
    );

    await act(async () => {
      rerender(
        <CustomerAccountsForm
          t={en}
          settings={{ ...settings, version: 3, accountsMode: "disabled", showAccountLink: false }}
        />,
      );
    });
    expect(within(accounts()).getByRole("radio", { name: t.accountsOff })).toBeChecked();
    expect(screen.getByRole("switch", { name: t.showLinkLabel })).not.toBeChecked();
    expect(save()).toBeDisabled();
  });

  it("shows Saved and posts the NEW version on the next save", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({ status: "success", version: 6 });
    renderForm({ version: 5 });

    fireEvent.click(screen.getByRole("switch", { name: t.showLinkLabel }));
    expect((await submitted()).get("expectedVersion")).toBe("5");
    expect(await screen.findByText(t.saved)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: t.showLinkLabel }));
    expect((await submitted()).get("expectedVersion")).toBe("6");
  });

  it("renders in Arabic", () => {
    expect.hasAssertions();
    renderForm({}, ar);

    expect(
      screen.getByRole("group", { name: ar.customerAccountSettings.accountsLegend }),
    ).toBeInTheDocument();
    expect(screen.getByText(ar.customerAccountSettings.accountsOffHint)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ar.customerAccountSettings.save }),
    ).toBeInTheDocument();
  });
});
