import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PolicyTemplateInputsDto } from "@/lib/api/online-store";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  generatePolicyTemplateAction: vi.fn(),
  savePolicyAction: vi.fn(),
}));
vi.mock("@/app/settings/policies/actions", () => actions);
const { PolicyTemplateDialog } = await import("./policy-template-dialog");

const defaults: PolicyTemplateInputsDto = {
  storeName: "Nour",
  contactEmail: "hi@nour.example",
  contactPhone: "",
  businessAddress: "",
  returnWindowDays: 14,
  returnShippingPaidBy: "customer",
  refundMethod: "original",
  cashOnDelivery: true,
  deliveryDays: { min: 2, max: 5 },
  shipsInternationally: false,
};
const p = en.policies;

afterEach(() => {
  cleanup();
  for (const fn of Object.values(actions)) fn.mockReset();
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

describe("PolicyTemplateDialog (spec 2.3)", () => {
  it("generates into the chosen locale, shows the reminder, and never saves", async () => {
    actions.generatePolicyTemplateAction.mockResolvedValue({ status: "ok", body: "## Returns\n…" });
    const onGenerated = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <PolicyTemplateDialog
        t={en}
        locale="en"
        type="refund"
        defaults={defaults}
        open
        onOpenChange={onOpenChange}
        onGenerated={onGenerated}
      />,
    );
    expect(screen.getByLabelText(p.returnWindow)).toHaveValue(14);
    expect(screen.getByText(p.reminder)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(p.templateLocale), { target: { value: "ar" } });
    fireEvent.click(screen.getByRole("button", { name: p.generate }));
    await flush();
    expect(actions.generatePolicyTemplateAction).toHaveBeenCalledWith(
      "refund",
      "ar",
      expect.objectContaining({ returnWindowDays: 14, storeName: "Nour" }),
    );
    expect(onGenerated).toHaveBeenCalledWith("ar", "## Returns\n…");
    expect(actions.savePolicyAction).not.toHaveBeenCalled();
  });

  it("starts every answer from the defaults and sends what the merchant changed", async () => {
    actions.generatePolicyTemplateAction.mockResolvedValue({ status: "ok", body: "x" });
    render(
      <PolicyTemplateDialog
        t={en}
        locale="en"
        type="shipping"
        defaults={defaults}
        open
        onOpenChange={vi.fn()}
        onGenerated={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(p.storeName)).toHaveValue("Nour");
    expect(screen.getByLabelText(p.email)).toHaveValue("hi@nour.example");
    expect(screen.getByLabelText(p.deliveryMin)).toHaveValue(2);
    expect(screen.getByLabelText(p.deliveryMax)).toHaveValue(5);
    expect(screen.getByLabelText(p.cod)).toBeChecked();
    expect(screen.getByLabelText(p.international)).not.toBeChecked();
    expect(screen.getByLabelText(p.templateLocale)).toHaveValue("en");
    fireEvent.change(screen.getByLabelText(p.phone), { target: { value: "01001234567" } });
    fireEvent.change(screen.getByLabelText(p.returnShipping), { target: { value: "store" } });
    fireEvent.change(screen.getByLabelText(p.refundMethod), { target: { value: "cash" } });
    fireEvent.change(screen.getByLabelText(p.deliveryMax), { target: { value: "7" } });
    fireEvent.click(screen.getByLabelText(p.international));
    fireEvent.click(screen.getByLabelText(p.cod));
    fireEvent.click(screen.getByRole("button", { name: p.generate }));
    await flush();
    expect(actions.generatePolicyTemplateAction).toHaveBeenCalledWith("shipping", "en", {
      ...defaults,
      contactPhone: "01001234567",
      returnShippingPaidBy: "store",
      refundMethod: "cash",
      cashOnDelivery: false,
      deliveryDays: { min: 2, max: 7 },
      shipsInternationally: true,
    });
  });

  it("an error answer shows its message and keeps the dialog open", async () => {
    actions.generatePolicyTemplateAction.mockResolvedValue({
      status: "error",
      message: ar.policies.templateInvalid,
    });
    const onGenerated = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <PolicyTemplateDialog
        t={ar}
        locale="ar"
        type="refund"
        defaults={defaults}
        open
        onOpenChange={onOpenChange}
        onGenerated={onGenerated}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: ar.policies.generate }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(ar.policies.templateInvalid);
    expect(onGenerated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("a crashed action shows our own copy and lets the merchant try again", async () => {
    actions.generatePolicyTemplateAction.mockRejectedValue(new Error("offline"));
    render(
      <PolicyTemplateDialog
        t={en}
        locale="en"
        type="refund"
        defaults={defaults}
        open
        onOpenChange={vi.fn()}
        onGenerated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: p.generate }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(en.formErrors.unexpected);
    expect(screen.getByRole("button", { name: p.generate })).toBeEnabled();
  });

  it("a day count that is not a whole number is refused here, without a call", async () => {
    render(
      <PolicyTemplateDialog
        t={en}
        locale="en"
        type="refund"
        defaults={defaults}
        open
        onOpenChange={vi.fn()}
        onGenerated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(p.returnWindow), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: p.generate }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(p.templateInvalid);
    expect(actions.generatePolicyTemplateAction).not.toHaveBeenCalled();
  });
});
