import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { PaymentSettingsDto } from "@/lib/api/payments";
import type { FormState } from "@/lib/api/mutation";
import { PaymentMethodsForm } from "./payment-methods-form";

const savePaymentMethodsAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
vi.mock("@/app/settings/payments/actions", () => ({
  savePaymentMethodsAction: (previous: FormState, formData: FormData) =>
    savePaymentMethodsAction(previous, formData),
}));

beforeEach(() => {
  savePaymentMethodsAction.mockReset().mockResolvedValue({ status: "success" });
});

const settings: PaymentSettingsDto = {
  enabledMethods: ["stripe"],
  methods: {
    stripe: { available: true, configured: true },
    cod: { available: true },
    paymob: { available: false, configured: false },
  },
};

const t = en.paymentSettings;

function renderForm(overrides: Partial<PaymentSettingsDto> = {}) {
  return render(<PaymentMethodsForm t={en} settings={{ ...settings, ...overrides }} />);
}

function switches(): HTMLInputElement[] {
  return screen.getAllByRole("switch") as HTMLInputElement[];
}

function switchFor(value: string): HTMLInputElement {
  const found = switches().find((item) => item.value === value);
  if (found === undefined) throw new Error(`no switch for ${value}`);
  return found;
}

describe("PaymentMethodsForm (Plan 3A)", () => {
  it("lists cash on delivery first, then paymob, then stripe", () => {
    renderForm();

    expect(switches().map((item) => item.value)).toEqual(["cod", "paymob", "stripe"]);
  });

  it("orders any other key alphabetically after the known three", () => {
    renderForm({
      methods: { ...settings.methods, zeta: { available: true }, alpha: { available: true } },
    });

    expect(switches().map((item) => item.value)).toEqual([
      "cod",
      "paymob",
      "stripe",
      "alpha",
      "zeta",
    ]);
  });

  it("names each known method, and shows an unknown key as the key itself", () => {
    renderForm({ methods: { ...settings.methods, zeta: { available: true } } });

    expect(screen.getByText(t.methodCod)).toBeInTheDocument();
    expect(screen.getByText(t.methodStripe)).toBeInTheDocument();
    expect(screen.getByText(t.methodPaymob)).toBeInTheDocument();
    expect(screen.getByText("zeta")).toBeInTheDocument();
  });

  it("shows the enabled methods as on", () => {
    renderForm();

    expect(switchFor("stripe").checked).toBe(true);
    expect(switchFor("cod").checked).toBe(false);
    expect(switchFor("stripe").name).toBe("method");
  });

  it("keeps Save off until a switch changes, and off again when the change is undone", () => {
    renderForm();
    const save = screen.getByRole("button", { name: t.save });
    expect(save).toBeDisabled();

    fireEvent.click(switchFor("cod"));
    expect(save).toBeEnabled();

    fireEvent.click(switchFor("cod"));
    expect(save).toBeDisabled();
  });

  it("will not turn the last method off, and says why", () => {
    renderForm();

    fireEvent.click(switchFor("stripe"));

    expect(switchFor("stripe").checked).toBe(true);
    expect(screen.getByText(t.keepOne)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.save })).toBeDisabled();
  });

  it("lets a method go off once another one is on", () => {
    renderForm();
    fireEvent.click(switchFor("cod"));
    fireEvent.click(switchFor("stripe"));

    expect(switchFor("stripe").checked).toBe(false);
    expect(screen.queryByText(t.keepOne)).toBeNull();
  });

  it("disables a method that is not available and says so", () => {
    renderForm();

    expect(switchFor("paymob")).toBeDisabled();
    expect(screen.getByText(t.notAvailable)).toBeInTheDocument();
  });

  it("disables a method that needs setup and says so", () => {
    renderForm({
      methods: { ...settings.methods, paymob: { available: true, configured: false } },
    });

    expect(switchFor("paymob")).toBeDisabled();
    expect(screen.getByText(t.needsSetup)).toBeInTheDocument();
  });

  it("still submits a disabled method that is currently enabled, so saving never drops it", () => {
    renderForm({
      enabledMethods: ["stripe", "paymob"],
      methods: { ...settings.methods, paymob: { available: true, configured: false } },
    });

    const paymob = switchFor("paymob");
    expect(paymob).toBeDisabled();
    expect(paymob.checked).toBe(true);
    const form = paymob.closest("form");
    if (form === null) throw new Error("switch is outside a form");
    expect(new FormData(form).getAll("method").sort()).toEqual(["paymob", "stripe"]);
  });

  it("submits the ticked methods through the action", async () => {
    renderForm();
    fireEvent.click(switchFor("cod"));

    fireEvent.click(screen.getByRole("button", { name: t.save }));

    await vi.waitFor(() => expect(savePaymentMethodsAction).toHaveBeenCalledTimes(1));
    const call = savePaymentMethodsAction.mock.calls[0];
    expect(call?.[1].getAll("method").sort()).toEqual(["cod", "stripe"]);
  });
});
