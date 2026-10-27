import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DraftOrderDto } from "@/lib/api/draft-orders";
import { formatCurrency } from "@/lib/format";
import { isolateName } from "@/lib/orders/order-timeline";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  saveDraftOrderAction: vi.fn(),
  sendDraftInvoiceAction: vi.fn(),
  completeDraftOrderAction: vi.fn(),
  deleteDraftOrderAction: vi.fn(),
  draftShippingRatesAction: vi.fn(),
  searchDraftProductsAction: vi.fn(),
  draftProductVariantsAction: vi.fn(),
  searchDraftCustomersAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/draft-orders/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { DraftOrderEditor } = await import("./draft-order-editor");

const { saveDraftOrderAction, sendDraftInvoiceAction, completeDraftOrderAction } = actions;
const p = en.draftOrders.editor.payment;

const DTO: DraftOrderDto = {
  id: "01920000-0000-7000-8000-00000000d003",
  draftNumber: "D3",
  status: "open",
  version: 2,
  currency: "EGP",
  createdAt: "2026-10-25T10:00:00.000Z",
  updatedAt: "2026-10-25T10:00:00.000Z",
  invoiceSentAt: null,
  completedAt: null,
  customer: null,
  email: "sara@example.com",
  phone: "01001234567",
  shippingAddress: {
    name: "Mona Ali",
    phone: "01001234567",
    line1: "5 Nile St",
    line2: null,
    city: "Cairo",
    province: "EG-C",
    postalCode: "",
    country: "EG",
  },
  billingAddress: null,
  lines: [
    {
      productId: "p-1",
      variantId: "v-1",
      sku: "TEE",
      title: "Tee",
      variantTitle: "M",
      quantity: 2,
      unitPriceMinor: 25000,
      lineTotalMinor: 50000,
      imageUrl: null,
    },
  ],
  discount: { valueType: "fixed", value: 5000, reason: "Loyal", amountMinor: 5000 },
  shipping: { kind: "rate", method: "standard", title: "Standard", amountMinor: 500 },
  note: "call first",
  tags: ["vip"],
  totals: {
    subtotalMinor: 50000,
    discountMinor: 5000,
    shippingMinor: 500,
    taxMinor: 0,
    taxIncluded: true,
    totalMinor: 45500,
  },
  order: null,
  links: [],
  missing: { invoice: [], complete: [] },
};

const note = () => screen.getByLabelText("Note");
const typeNote = (value: string) => fireEvent.change(note(), { target: { value } });
const openCollect = async () => {
  fireEvent.keyDown(screen.getByRole("button", { name: p.collectPayment }), { key: "Enter" });
  return screen.findByRole("menu");
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of [...Object.values(actions), ...Object.values(router)]) fn.mockReset();
});

describe("DraftOrderEditor", () => {
  it("a new draft shows 'Create order', no save bar until something changes, and Save sends ids only", async () => {
    saveDraftOrderAction.mockResolvedValue({ ok: true, draft: DTO });
    render(<DraftOrderEditor draft={null} canEdit canMarkPaid={false} t={en} locale="en" />);
    expect(screen.getByRole("heading", { name: "Create order" })).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    typeNote("call first");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/draft-orders/${DTO.id}`));
    const [id, version, input] = saveDraftOrderAction.mock.calls[0] ?? [];
    expect([id, version]).toEqual([null, null]);
    expect(input).toMatchObject({ note: "call first", lines: [] });
    expect(JSON.stringify(input)).not.toMatch(/unitPrice|lineTotal/);
  });

  it("Discard returns to the saved draft", () => {
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("call first!");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(note()).toHaveValue("call first");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("shows the field errors and the message when a save is refused", async () => {
    saveDraftOrderAction.mockResolvedValue({
      ok: false,
      message: en.draftOrders.editor.errors.invalid,
      code: null,
      fields: { "lines.0": "this product can no longer be sold" },
      conflict: false,
    });
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("x");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("this product can no longer be sold")).toBeInTheDocument();
    expect(screen.getByText(en.draftOrders.editor.errors.invalid)).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a version conflict offers Reload, which takes the other person's draft", async () => {
    saveDraftOrderAction.mockResolvedValue({
      ok: false,
      message: en.draftOrders.editor.errors.conflict,
      code: "VERSION_CONFLICT",
      fields: {},
      conflict: true,
    });
    const view = render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("mine");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const reloadButton = await screen.findByRole("button", { name: "Reload" });
    await waitFor(() => expect(reloadButton).toBeEnabled());
    fireEvent.click(reloadButton);
    expect(router.refresh).toHaveBeenCalled();
    view.rerender(
      <DraftOrderEditor
        draft={{ ...DTO, version: 3, note: "theirs" }}
        canEdit
        canMarkPaid
        t={en}
        locale="en"
      />,
    );
    expect(note()).toHaveValue("theirs");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("a newer draft from the server never overwrites unsaved edits on its own", () => {
    const view = render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("mine");
    view.rerender(
      <DraftOrderEditor
        draft={{ ...DTO, version: 3, note: "theirs" }}
        canEdit
        canMarkPaid
        t={en}
        locale="en"
      />,
    );
    expect(note()).toHaveValue("mine");
  });

  it("Mark as paid is disabled for non-admins, with the reason (spec §4.9, Ruling 25)", async () => {
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid={false} t={en} locale="en" />);
    await openCollect();
    const item = screen.getByRole("menuitem", { name: /Mark as paid/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Only admins can mark an order as paid")).toBeInTheDocument();
    fireEvent.click(item);
    expect(completeDraftOrderAction).not.toHaveBeenCalled();
  });

  it("a viewer sees the draft read-only (no Save, no Send invoice)", () => {
    render(<DraftOrderEditor draft={DTO} canEdit={false} canMarkPaid={false} t={en} locale="en" />);
    expect(screen.queryByRole("button", { name: "Send invoice" })).toBeNull();
    expect(screen.queryByRole("button", { name: p.collectPayment })).toBeNull();
    expect(note()).toHaveAttribute("readonly");
  });

  it("a completed draft is read-only with a banner linking its order", () => {
    render(
      <DraftOrderEditor
        draft={{ ...DTO, status: "completed", order: { id: "o-1", orderNumber: "1001" } }}
        canEdit
        canMarkPaid
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText("This draft order was completed.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: `View order ${isolateName("#1001")}` }),
    ).toHaveAttribute("href", "/orders/o-1");
    expect(screen.queryByRole("button", { name: p.collectPayment })).toBeNull();
  });

  it("Send invoice saves first when there are unsaved changes (Pre-flight 10)", async () => {
    saveDraftOrderAction.mockResolvedValue({ ok: true, draft: DTO });
    sendDraftInvoiceAction.mockResolvedValue({ ok: true, url: "https://s/c/x", shopName: "Shop" });
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("call first!");
    fireEvent.click(screen.getByRole("button", { name: "Send invoice" }));
    expect(await screen.findByDisplayValue("https://s/c/x")).toBeInTheDocument();
    expect(saveDraftOrderAction.mock.invocationCallOrder[0]).toBeLessThan(
      sendDraftInvoiceAction.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("Send invoice without changes issues the link without saving", async () => {
    sendDraftInvoiceAction.mockResolvedValue({ ok: true, url: "https://s/c/x", shopName: "Shop" });
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Send invoice" }));
    expect(await screen.findByDisplayValue("https://s/c/x")).toBeInTheDocument();
    expect(saveDraftOrderAction).not.toHaveBeenCalled();
    expect(sendDraftInvoiceAction).toHaveBeenCalledWith(DTO.id);
  });

  it("Send invoice is single-flight: a second press while a link is made mints nothing", async () => {
    let finish: (value: unknown) => void = () => undefined;
    sendDraftInvoiceAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    const button = screen.getByRole("button", { name: "Send invoice" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await act(async () => finish({ ok: true, url: "https://s/c/x", shopName: "Shop" }));
    expect(sendDraftInvoiceAction).toHaveBeenCalledTimes(1);
  });

  it("Mark as paid on a dirty form confirms the total the save produced (Pre-flight 11)", async () => {
    const after = { ...DTO, version: 3, totals: { ...DTO.totals, totalMinor: 99900 } };
    saveDraftOrderAction.mockResolvedValue({ ok: true, draft: after });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("two more");
    await openCollect();
    fireEvent.click(screen.getByRole("menuitem", { name: p.markAsPaid }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith(
      p.confirmMarkAsPaid.replace("{total}", formatCurrency("en", 99900, "EGP")),
    );
    expect(saveDraftOrderAction.mock.invocationCallOrder[0]).toBeLessThan(
      confirm.mock.invocationCallOrder[0] ?? 0,
    );
    expect(completeDraftOrderAction).not.toHaveBeenCalled();
  });

  it("Collect on delivery creates the order and opens it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    completeDraftOrderAction.mockResolvedValue({ ok: true, orderId: "o-1" });
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid={false} t={en} locale="en" />);
    await openCollect();
    fireEvent.click(screen.getByRole("menuitem", { name: p.collectOnDelivery }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/orders/o-1"));
    expect(completeDraftOrderAction).toHaveBeenCalledWith(DTO.id, "collect_on_delivery");
  });

  it("after PAYMENT_NOT_RECORDED, Try again repeats the same payment without asking again", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    completeDraftOrderAction.mockResolvedValueOnce({
      ok: false,
      message: "Order #1001 was created but the payment was not recorded — try again.",
      code: "PAYMENT_NOT_RECORDED",
    });
    completeDraftOrderAction.mockResolvedValueOnce({ ok: true, orderId: "o-1" });
    const view = render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    await openCollect();
    fireEvent.click(screen.getByRole("menuitem", { name: p.markAsPaid }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Order #1001 was created");
    // The draft now reads completed (the order exists): the retry is still offered.
    view.rerender(
      <DraftOrderEditor
        draft={{ ...DTO, status: "completed", order: { id: "o-1", orderNumber: "1001" } }}
        canEdit
        canMarkPaid
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText("This draft order was completed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/orders/o-1"));
    expect(completeDraftOrderAction.mock.calls).toEqual([
      [DTO.id, "paid"],
      [DTO.id, "paid"],
    ]);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("after DRAFT_BUSY the draft is reloaded, and the next confirmation shows its new total", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    completeDraftOrderAction.mockResolvedValue({
      ok: false,
      message: en.draftOrders.editor.errors.busy,
      code: "DRAFT_BUSY",
    });
    const view = render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    await openCollect();
    fireEvent.click(screen.getByRole("menuitem", { name: p.collectOnDelivery }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    view.rerender(
      <DraftOrderEditor
        draft={{ ...DTO, version: 4, totals: { ...DTO.totals, totalMinor: 70000 } }}
        canEdit
        canMarkPaid
        t={en}
        locale="en"
      />,
    );
    confirm.mockReturnValue(false);
    await openCollect();
    fireEvent.click(screen.getByRole("menuitem", { name: p.collectOnDelivery }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(confirm).toHaveBeenLastCalledWith(
      p.confirmCollect.replace("{total}", formatCurrency("en", 70000, "EGP")),
    );
    expect(saveDraftOrderAction).not.toHaveBeenCalled();
  });

  it("a completed draft offers to record its payment again, without saving, for staff who edit (I-1)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    completeDraftOrderAction.mockResolvedValue({ ok: true, orderId: "o-1" });
    const completed = {
      ...DTO,
      status: "completed" as const,
      order: { id: "o-1", orderNumber: "1001" },
    };
    render(<DraftOrderEditor draft={completed} canEdit canMarkPaid t={en} locale="en" />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: en.draftOrders.editor.recordPaymentAgain }),
      { key: "Enter" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: p.markAsPaid }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/orders/o-1"));
    expect(confirm).toHaveBeenCalledWith(
      en.draftOrders.editor.confirmRecordAgain.replace(
        "{total}",
        formatCurrency("en", 45500, "EGP"),
      ),
    );
    expect(completeDraftOrderAction).toHaveBeenCalledWith(DTO.id, "paid");
    expect(saveDraftOrderAction).not.toHaveBeenCalled();
  });

  it("recording again keeps Mark as paid admin-only, and is hidden from viewers", async () => {
    const completed = {
      ...DTO,
      status: "completed" as const,
      order: { id: "o-1", orderNumber: "1001" },
    };
    const view = render(
      <DraftOrderEditor draft={completed} canEdit canMarkPaid={false} t={en} locale="en" />,
    );
    fireEvent.keyDown(
      screen.getByRole("button", { name: en.draftOrders.editor.recordPaymentAgain }),
      { key: "Enter" },
    );
    expect(await screen.findByRole("menuitem", { name: p.markAsPaid })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: p.collectOnDelivery })).toBeInTheDocument();
    view.unmount();
    render(
      <DraftOrderEditor draft={completed} canEdit={false} canMarkPaid={false} t={en} locale="en" />,
    );
    expect(
      screen.queryByRole("button", { name: en.draftOrders.editor.recordPaymentAgain }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: /View order/ })).toHaveAttribute("href", "/orders/o-1");
  });

  it("Delete confirms, then goes back to the Drafts list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    actions.deleteDraftOrderAction.mockResolvedValue({ ok: true });
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    fireEvent.keyDown(screen.getByRole("button", { name: en.draftOrders.editor.moreActions }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: en.draftOrders.editor.deleteDraft }),
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/draft-orders"));
    expect(actions.deleteDraftOrderAction).toHaveBeenCalledWith(DTO.id);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the delete question keeps #D3 in one piece in a right-to-left sentence (M-6)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    fireEvent.keyDown(screen.getByRole("button", { name: en.draftOrders.editor.moreActions }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: en.draftOrders.editor.deleteDraft }),
    );
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0]?.[0]).toContain(isolateName("#D3"));
    expect(actions.deleteDraftOrderAction).not.toHaveBeenCalled();
  });

  it("a saved draft's #D3 heading is isolated left-to-right inside an Arabic page", () => {
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={ar} locale="ar" />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).not.toHaveAttribute("dir");
    const isolate = heading.querySelector("bdi");
    expect(isolate).not.toBeNull();
    expect(isolate).toHaveAttribute("dir", "ltr");
    expect(isolate).toHaveTextContent("#D3");
    expect(heading.textContent).toBe("#D3");
  });

  it("the title isolates only #D3, so an Arabic page keeps its own direction (M-6)", () => {
    render(<DraftOrderEditor draft={null} canEdit canMarkPaid t={en} locale="en" />);
    expect(screen.getByRole("heading", { name: "Create order" })).not.toHaveAttribute("dir");
  });

  it("opening Shipping on an untouched new draft creates no draft, and says what is missing (M-9)", async () => {
    render(<DraftOrderEditor draft={null} canEdit canMarkPaid t={en} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: p.addShipping }));
    expect(
      await screen.findByText(en.draftOrders.editor.shippingDialog.needsAddress),
    ).toBeInTheDocument();
    expect(saveDraftOrderAction).not.toHaveBeenCalled();
  });

  it("on /new, a draft created by Shipping is then updated, and Reload opens its own page (M-2)", async () => {
    actions.searchDraftProductsAction.mockResolvedValue([
      {
        id: "p-1",
        title: "Tee",
        imageUrl: null,
        variantCount: 1,
        priceMinor: 25000,
        currency: "EGP",
      },
    ]);
    actions.draftProductVariantsAction.mockResolvedValue([
      {
        productId: "p-1",
        variantId: "v-1",
        title: "Tee",
        variantTitle: null,
        sku: "TEE",
        priceMinor: 25000,
        currency: "EGP",
        imageUrl: null,
      },
    ]);
    actions.draftShippingRatesAction.mockResolvedValue({ ok: true, rates: [] });
    saveDraftOrderAction.mockResolvedValueOnce({ ok: true, draft: DTO });
    saveDraftOrderAction.mockResolvedValueOnce({
      ok: false,
      message: en.draftOrders.editor.errors.conflict,
      code: "VERSION_CONFLICT",
      fields: {},
      conflict: true,
    });
    const c = en.draftOrders.editor.customer;
    render(<DraftOrderEditor draft={null} canEdit canMarkPaid t={en} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: en.draftOrders.editor.products.browse }));
    fireEvent.click(await screen.findByRole("button", { name: /Tee/ }));
    await screen.findByLabelText("Quantity of Tee");
    fireEvent.click(screen.getByRole("button", { name: c.addAddress }));
    fireEvent.change(screen.getByLabelText(c.address.line1), { target: { value: "5 Nile St" } });
    fireEvent.change(screen.getByLabelText(c.address.city), { target: { value: "Cairo" } });
    fireEvent.click(screen.getByRole("button", { name: p.addShipping }));
    await waitFor(() => expect(actions.draftShippingRatesAction).toHaveBeenCalledWith(DTO.id));
    expect(saveDraftOrderAction.mock.calls[0]?.slice(0, 2)).toEqual([null, null]);
    expect(router.replace).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: en.draftOrders.editor.shippingDialog.cancel }),
    );
    typeNote("later");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const reload = await screen.findByRole("button", { name: "Reload" });
    expect(saveDraftOrderAction.mock.calls[1]?.slice(0, 2)).toEqual([DTO.id, DTO.version]);
    await waitFor(() => expect(reload).toBeEnabled());
    fireEvent.click(reload);
    expect(router.replace).toHaveBeenCalledWith(`/draft-orders/${DTO.id}`);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("an older draft from the server never replaces a newer saved one (M-3)", () => {
    const view = render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    view.rerender(
      <DraftOrderEditor
        draft={{ ...DTO, version: 1, note: "older", updatedAt: "2026-10-24T10:00:00.000Z" }}
        canEdit
        canMarkPaid
        t={en}
        locale="en"
      />,
    );
    expect(note()).toHaveValue("call first");
  });

  it("what is typed while a save runs is kept, and stays unsaved (M-5)", async () => {
    let finish: (value: unknown) => void = () => undefined;
    saveDraftOrderAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("a");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    typeNote("ab");
    await act(async () => finish({ ok: true, draft: { ...DTO, version: 3, note: "a" } }));
    expect(note()).toHaveValue("ab");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });
});
