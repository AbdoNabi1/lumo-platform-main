import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DiscountDto } from "@/lib/discounts/model";
import { emptyFormValues, formValuesFromDto } from "@/lib/discounts/form";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { DiscountEditor } from "./discount-editor";

const actions = vi.hoisted(() => ({
  saveDiscountAction: vi.fn(),
  deleteDiscountAction: vi.fn(),
  setDiscountActiveAction: vi.fn(),
  searchDiscountTargetsAction: vi.fn(),
}));
vi.mock("@/app/discounts/actions", () => actions);

const NOW = new Date("2026-10-16T10:30:00.000Z");

const saved: DiscountDto = {
  id: "promo-1",
  type: "amount_off_products",
  method: "code",
  title: "SHOES",
  code: "SHOES",
  status: "active",
  value: { kind: "percentage", amount: 15 },
  appliesTo: { kind: "products", refs: ["p-1"] },
  appliesOncePerOrder: false,
  buys: null,
  gets: null,
  maxUsesPerOrder: null,
  countries: null,
  maxShippingRateMinor: null,
  minimumRequirement: { kind: "none" },
  customerEligibility: { kind: "all" },
  usageLimit: null,
  oncePerCustomer: false,
  combinesWith: { product: false, order: false, shipping: false },
  startsAt: "2026-10-16T10:30:00.000Z",
  endsAt: null,
  usageCount: 7,
};

function renderCreate(
  type: DiscountDto["type"] = "amount_off_order",
  t: Dictionary = en,
  locale: "en" | "ar" = "en",
) {
  return render(
    <DiscountEditor
      mode="create"
      discount={null}
      initialValues={emptyFormValues(type, NOW, "UTC")}
      currency="EGP"
      timeZone="UTC"
      zone="UTC"
      t={t}
      locale={locale}
    />,
  );
}

function renderEdit(dto: DiscountDto = saved) {
  return render(
    <DiscountEditor
      mode="edit"
      discount={dto}
      initialValues={formValuesFromDto(
        dto,
        { products: { "p-1": "Sneaker" }, categories: {}, customers: {}, countries: {} },
        "EGP",
        "UTC",
      )}
      currency="EGP"
      timeZone="UTC"
      zone="UTC"
      t={en}
      locale="en"
    />,
  );
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.saveDiscountAction.mockResolvedValue({ status: "idle" });
});

describe("DiscountEditor — create", () => {
  it("lays out Shopify's cards for amount off order, with the method switch", () => {
    renderCreate();

    expect(
      screen.getByRole("heading", { name: en.discounts.types.amount_off_order }),
    ).toBeInTheDocument();
    for (const title of [
      en.discounts.form.value,
      en.discounts.form.minimumRequirements,
      en.discounts.form.eligibility,
      en.discounts.form.maxUses,
      en.discounts.form.combinations,
      en.discounts.form.activeDates,
      en.discounts.summary.title,
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("radio", { name: en.discounts.form.methodAutomatic }));
    expect(screen.getByLabelText(en.discounts.form.title)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: en.discounts.form.maxUses })).toBeNull();
  });

  it("generates a code and follows the form in the Summary", () => {
    renderCreate();

    fireEvent.click(screen.getByRole("button", { name: en.discounts.form.generate }));
    const code = (screen.getByRole("textbox", { name: en.discounts.form.code }) as HTMLInputElement)
      .value;
    expect(code).toMatch(/^[A-Z0-9]{12}$/);

    fireEvent.change(screen.getByLabelText(en.discounts.form.value), { target: { value: "10" } });
    const summary = screen.getByRole("region", { name: en.discounts.summary.title });
    expect(within(summary).getByText(code)).toBeInTheDocument();
    expect(within(summary).getByText("10% off entire order")).toBeInTheDocument();
    expect(within(summary).getByText(en.discounts.summary.noMinimum)).toBeInTheDocument();
  });

  it("shows the type-specific cards", () => {
    renderCreate("buy_x_get_y");
    expect(
      screen.getByRole("heading", { name: en.discounts.form.customerBuys }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: en.discounts.form.customerGets }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: en.discounts.form.minimumRequirements }),
    ).toBeNull();
  });

  it("posts the whole form as one payload", () => {
    const { container } = renderCreate("free_shipping");
    fireEvent.change(screen.getByRole("textbox", { name: en.discounts.form.code }), {
      target: { value: "SHIPFREE" },
    });

    const payload = container.querySelector<HTMLInputElement>('input[name="payload"]');
    expect(JSON.parse(payload!.value)).toMatchObject({ type: "free_shipping", code: "SHIPFREE" });
    expect(container.querySelector('input[name="discountId"]')).toBeNull();
  });

  it("types codes left to right in capitals, and caps the code and title at 255", () => {
    renderCreate("free_shipping", ar, "ar");
    const code = screen.getByRole("textbox", { name: ar.discounts.form.code });
    expect(code).toHaveAttribute("dir", "ltr");
    expect(code).toHaveAttribute("autocapitalize", "characters");
    expect(code).toHaveAttribute("spellcheck", "false");
    expect(code).toHaveAttribute("maxlength", "255");

    fireEvent.click(screen.getByRole("radio", { name: ar.discounts.form.methodAutomatic }));
    expect(screen.getByLabelText(ar.discounts.form.title)).toHaveAttribute("maxlength", "255");
  });

  it("speaks Arabic", () => {
    renderCreate("free_shipping", ar, "ar");
    expect(
      screen.getByRole("heading", { name: ar.discounts.types.free_shipping }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.discounts.form.save })).toBeInTheDocument();
  });
});

describe("DiscountEditor — edit", () => {
  it("shows the picked products, the Performance card and the lifecycle actions", () => {
    renderEdit();

    expect(screen.getByText("Sneaker")).toBeInTheDocument();
    expect(screen.getByText("Used 7 times")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.discounts.form.deactivate })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.discounts.form.delete })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: en.discounts.form.methodAutomatic })).toBeDisabled();
  });

  it("offers Activate for a deactivated discount, nothing for an ended one", () => {
    const { unmount } = renderEdit({ ...saved, status: "expired" });
    expect(screen.getByRole("button", { name: en.discounts.form.activate })).toBeInTheDocument();
    unmount();

    renderEdit({ ...saved, status: "expired", endsAt: "2026-10-01T00:00:00.000Z" });
    expect(screen.queryByRole("button", { name: en.discounts.form.activate })).toBeNull();
    expect(screen.queryByRole("button", { name: en.discounts.form.deactivate })).toBeNull();
  });

  it("shows Unsaved changes only after a change, and Discard restores every field", () => {
    const { container } = renderEdit();
    const save = screen.getByRole("button", { name: en.discounts.form.save });
    expect(save).toBeDisabled();
    expect(screen.queryByText(en.discounts.form.unsaved)).toBeNull();

    fireEvent.change(screen.getByLabelText(en.discounts.form.value), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Sneaker" }));
    expect(screen.getByText(en.discounts.form.unsaved)).toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: en.discounts.form.discard }));
    expect(screen.queryByText(en.discounts.form.unsaved)).toBeNull();
    expect((screen.getByLabelText(en.discounts.form.value) as HTMLInputElement).value).toBe("15");
    expect(screen.getByText("Sneaker")).toBeInTheDocument();
    expect(container.querySelector<HTMLInputElement>('input[name="discountId"]')?.value).toBe(
      "promo-1",
    );
  });

  it("takes what was saved as the new starting point when the saved discount reads back the same", async () => {
    // "15" → "15.00" saves the same DTO, so the page keeps this editor mounted (same `key`).
    actions.saveDiscountAction.mockResolvedValue({ status: "success" });
    renderEdit();
    const save = screen.getByRole("button", { name: en.discounts.form.save });

    fireEvent.change(screen.getByLabelText(en.discounts.form.value), {
      target: { value: "15.00" },
    });
    expect(screen.getByText(en.discounts.form.unsaved)).toBeInTheDocument();
    fireEvent.click(save);

    await waitFor(() => expect(actions.saveDiscountAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(en.discounts.form.unsaved)).toBeNull());
    expect(screen.getByRole("button", { name: en.discounts.form.save })).toBeDisabled();
    expect((screen.getByLabelText(en.discounts.form.value) as HTMLInputElement).value).toBe(
      "15.00",
    );
  });

  it("keeps the earlier starting point when the save fails", async () => {
    actions.saveDiscountAction.mockResolvedValue({
      status: "error",
      message: "Nope",
      fieldErrors: {},
    });
    renderEdit();

    fireEvent.change(screen.getByLabelText(en.discounts.form.value), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: en.discounts.form.save }));

    expect(await screen.findByText("Nope")).toBeInTheDocument();
    expect(screen.getByText(en.discounts.form.unsaved)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.discounts.form.save })).toBeEnabled();
  });

  it("hides Deactivate and Delete while there are unsaved changes, so they cannot drop them", () => {
    renderEdit();
    expect(screen.getByRole("button", { name: en.discounts.form.deactivate })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(en.discounts.form.value), { target: { value: "20" } });
    expect(screen.queryByRole("button", { name: en.discounts.form.deactivate })).toBeNull();
    expect(screen.queryByRole("button", { name: en.discounts.form.delete })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: en.discounts.form.discard }));
    expect(screen.getByRole("button", { name: en.discounts.form.deactivate })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.discounts.form.delete })).toBeInTheDocument();
  });
});
