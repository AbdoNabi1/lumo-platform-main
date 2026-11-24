import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SegmentCondition } from "@/lib/api/customer-segments";
import { formatNumber } from "@/lib/format";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const actions = vi.hoisted(() => ({
  createSegmentAction: vi.fn(),
  updateSegmentAction: vi.fn(),
  previewSegmentAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/app/customers/segments/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { SegmentEditor, PREVIEW_DEBOUNCE_MS } = await import("./segment-editor");

const k = en.segments.editor;
const body = () => within(document.body);

const PAGE = {
  items: [
    {
      id: "c-1",
      name: "Nour Hassan",
      email: "nour@example.com",
      isGuest: false,
      ordersCount: 2,
      amountSpentMinor: 100,
      lastOrderAt: null,
      emailSubscribed: true,
      smsSubscribed: false,
    },
  ],
  pageInfo: { hasNextPage: false, endCursor: null },
  total: 12,
  currency: "EGP",
};
const okPage = { status: "ok", page: PAGE } as const;

function renderEditor(
  props: Partial<Parameters<typeof SegmentEditor>[0]> = {},
  t: Dictionary = en,
) {
  return render(
    <SegmentEditor
      t={t}
      locale={t === ar ? "ar" : "en"}
      currency="EGP"
      mode="create"
      initialName=""
      initialConditions={[]}
      readOnly={false}
      {...props}
    />,
  );
}

const row = (n: number) =>
  screen.getByRole("group", { name: k.conditionLabel.replace("{number}", String(n)) });

function pickField(n: number, field: string): void {
  fireEvent.change(within(row(n)).getByLabelText(k.fieldLabel), { target: { value: field } });
}

function pickOp(n: number, op: string): void {
  fireEvent.change(within(row(n)).getByLabelText(k.operatorLabel), { target: { value: op } });
}

function typeValue(n: number, value: string): void {
  fireEvent.change(within(row(n)).getByLabelText(k.valueLabel), { target: { value: value } });
}

/** Lets the debounce elapse and flushes the promise chain of the mocked action. */
async function elapse(ms = PREVIEW_DEBOUNCE_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  expect.hasAssertions();
  for (const action of Object.values(actions)) action.mockReset();
  actions.previewSegmentAction.mockResolvedValue(okPage);
  actions.createSegmentAction.mockResolvedValue({ status: "idle" });
  actions.updateSegmentAction.mockResolvedValue({ status: "success" });
  router.refresh.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SegmentEditor — condition rows", () => {
  it("starts with one empty row, a name box, Save, and the preview hint", () => {
    renderEditor();

    expect(screen.getByLabelText(k.nameLabel)).toHaveValue("");
    expect(row(1)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: k.save })).toBeEnabled();
    expect(screen.getByText(en.segments.preview.hint)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: k.removeCondition.replace("{number}", "1") }),
    ).toBeNull();
  });

  it("offers the right value input for every filter", () => {
    renderEditor();
    const value = () => within(row(1)).queryByLabelText(k.valueLabel);

    pickField(1, "orders_count");
    expect(value()).toHaveAttribute("inputmode", "numeric");

    pickField(1, "amount_spent");
    expect(value()).toHaveAttribute("inputmode", "decimal");
    expect(within(row(1)).getByText("EGP")).toBeVisible();

    pickField(1, "last_order_date");
    pickOp(1, "within_last_days");
    expect(value()).toHaveAttribute("inputmode", "numeric");
    expect(within(row(1)).getByText(k.daysUnit)).toBeVisible();
    pickOp(1, "on_or_after");
    expect(value()).toHaveAttribute("type", "date");
    pickOp(1, "never");
    expect(value()).toBeNull();

    pickField(1, "email_subscribed");
    expect(within(row(1)).queryByLabelText(k.operatorLabel)).toBeNull();
    expect(within(row(1)).getByRole("option", { name: k.subscribed })).toBeInTheDocument();
    expect(within(row(1)).getByRole("option", { name: k.notSubscribed })).toBeInTheDocument();

    pickField(1, "tags");
    expect(within(row(1)).getByRole("button", { name: en.customerForm.tagsAdd })).toBeVisible();

    pickField(1, "country");
    expect(value()).toHaveAttribute("placeholder", k.countriesPlaceholder);
    expect(within(row(1)).getByText(k.countriesHint)).toBeVisible();

    pickField(1, "language");
    pickOp(1, "unset");
    expect(value()).toBeNull();
    pickOp(1, "eq");
    expect(within(row(1)).getByRole("option", { name: "English" })).toBeInTheDocument();
    expect(within(row(1)).getByRole("option", { name: "العربية" })).toBeInTheDocument();
  });

  it("tag chips de-duplicate with the Wave 1b tagKeyOf (case, spacing) and can be removed", async () => {
    vi.useFakeTimers();
    renderEditor();
    pickField(1, "tags");
    const tagBox = within(row(1)).getByRole("textbox");

    fireEvent.change(tagBox, { target: { value: "VIP, vip ,  Gold   Card," } });
    fireEvent.change(tagBox, { target: { value: "gold card," } });

    const chips = within(row(1)).getByRole("list", { name: en.customerForm.tagsAdded });
    expect(
      within(chips)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["VIP", "Gold Card"]);

    await elapse();
    expect(actions.previewSegmentAction).toHaveBeenLastCalledWith([
      { field: "tags", op: "has_any", values: ["VIP", "Gold Card"] },
    ]);

    fireEvent.click(
      within(row(1)).getByRole("button", {
        name: en.customerForm.removeTag.replace("{tag}", "VIP"),
      }),
    );
    expect(within(row(1)).queryByText("VIP")).toBeNull();
  });

  it("adds and removes rows; Add condition stops at 10 with the limit note", () => {
    renderEditor();
    const add = () => screen.getByRole("button", { name: k.addCondition });

    for (let i = 2; i <= 10; i += 1) fireEvent.click(add());

    expect(screen.getAllByRole("group")).toHaveLength(10);
    expect(add()).toBeDisabled();
    expect(screen.getByText(k.conditionLimit.replace("{max}", "10"))).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: k.removeCondition.replace("{number}", "3") }),
    );
    expect(screen.getAllByRole("group")).toHaveLength(9);
    expect(add()).toBeEnabled();
    expect(screen.queryByText(k.conditionLimit.replace("{max}", "10"))).toBeNull();
  });

  it("removing the first row keeps the others' typed values (rows are keyed, not indexed)", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: k.addCondition }));
    typeValue(1, "111");
    typeValue(2, "222");

    fireEvent.click(
      screen.getByRole("button", { name: k.removeCondition.replace("{number}", "1") }),
    );

    expect(within(row(1)).getByLabelText(k.valueLabel)).toHaveValue("222");
  });
});

describe("SegmentEditor — money in the shop currency", () => {
  it.each([
    ["EGP", "0.29", 29],
    ["JPY", "29", 29],
    ["KWD", "0.029", 29],
    ["EGP", "١٢٫٣٤", 1234],
  ])("%s %s is sent to the preview as %i minor units", async (currency, text, minor) => {
    vi.useFakeTimers();
    renderEditor({ currency });
    pickField(1, "amount_spent");
    typeValue(1, text);

    await elapse();

    expect(actions.previewSegmentAction).toHaveBeenCalledWith([
      { field: "amount_spent", op: "eq", valueMinor: minor },
    ]);
  });

  it("JPY 1.5 is 'Too many decimal places' on Save, and nothing is sent", async () => {
    renderEditor({ currency: "JPY" });
    pickField(1, "amount_spent");
    typeValue(1, "1.5");

    fireEvent.click(screen.getByRole("button", { name: k.save }));

    expect(await within(row(1)).findByText(k.errors.tooManyDecimals)).toBeVisible();
    expect(actions.createSegmentAction).not.toHaveBeenCalled();
    expect(actions.previewSegmentAction).not.toHaveBeenCalled();
  });

  it("an existing amount shows in major units", () => {
    renderEditor({
      currency: "KWD",
      mode: "edit",
      segmentId: "s-1",
      version: 1,
      initialName: "Big spenders",
      initialConditions: [{ field: "amount_spent", op: "gte", valueMinor: 29 }],
    });

    expect(within(row(1)).getByLabelText(k.valueLabel)).toHaveValue("0.029");
  });
});

describe("SegmentEditor — live preview", () => {
  it("waits 400 ms after the last edit, then asks once; a complete row is required", async () => {
    vi.useFakeTimers();
    renderEditor();

    typeValue(1, "3");
    await elapse(PREVIEW_DEBOUNCE_MS - 1);
    expect(actions.previewSegmentAction).not.toHaveBeenCalled();
    expect(screen.getByText(en.segments.preview.loading)).toBeVisible();

    typeValue(1, "35"); // restarts the wait
    await elapse(PREVIEW_DEBOUNCE_MS - 1);
    expect(actions.previewSegmentAction).not.toHaveBeenCalled();

    await elapse(1);
    expect(actions.previewSegmentAction).toHaveBeenCalledTimes(1);
    expect(actions.previewSegmentAction).toHaveBeenCalledWith([
      { field: "orders_count", op: "eq", value: 35 },
    ]);
    expect(screen.getByText("12 customers")).toBeVisible();
    expect(screen.getByText("Nour Hassan").tagName).toBe("BDI");
    expect(screen.getByText("nour@example.com").tagName).toBe("BDI");

    typeValue(1, ""); // incomplete again: back to the hint, no request
    await elapse(1000);
    expect(actions.previewSegmentAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText(en.segments.preview.hint)).toBeVisible();
  });

  it("drops a stale answer that arrives after a newer edit", async () => {
    vi.useFakeTimers();
    let resolveFirst: (value: unknown) => void = () => {};
    actions.previewSegmentAction
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ status: "ok", page: { ...PAGE, total: 2 } });
    renderEditor();

    typeValue(1, "1");
    await elapse();
    typeValue(1, "2");
    await elapse();
    expect(screen.getByText("2 customers")).toBeVisible();

    await act(async () => {
      resolveFirst({ status: "ok", page: { ...PAGE, total: 999 } });
    });

    expect(screen.getByText("2 customers")).toBeVisible();
    expect(screen.queryByText("999 customers")).toBeNull();
  });

  it("shows 'Segments need the store database' on an UNAVAILABLE preview, the error on any other failure", async () => {
    vi.useFakeTimers();
    actions.previewSegmentAction.mockResolvedValueOnce({ status: "unavailable" });
    renderEditor();
    typeValue(1, "1");
    await elapse();
    expect(screen.getByText(en.segments.unavailable)).toBeVisible();

    actions.previewSegmentAction.mockResolvedValueOnce({
      status: "error",
      message: "x",
      fieldErrors: {},
    });
    typeValue(1, "2");
    await elapse();
    expect(screen.getByText(en.segments.preview.error)).toBeVisible();
  });

  it("shows a preview 422 on the matching row", async () => {
    vi.useFakeTimers();
    actions.previewSegmentAction.mockResolvedValue({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: { "conditions.0.value": "Use 0 to 1000000" },
    });
    renderEditor();
    typeValue(1, "99999999");
    await elapse();

    expect(within(row(1)).getByText("Use 0 to 1000000")).toBeVisible();
  });

  it("an unchanged saved segment shows no preview until a condition changes", async () => {
    vi.useFakeTimers();
    renderEditor({
      mode: "edit",
      segmentId: "s-1",
      version: 2,
      initialName: "VIP",
      initialConditions: [{ field: "orders_count", op: "gte", value: 3 }],
    });
    await elapse(1000);
    expect(screen.queryByText(en.segments.preview.heading)).toBeNull();
    expect(actions.previewSegmentAction).not.toHaveBeenCalled();

    typeValue(1, "4");
    await elapse();
    expect(actions.previewSegmentAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText(en.segments.preview.heading)).toBeVisible();
  });
});

describe("SegmentEditor — saving", () => {
  const completeRow = () => {
    fireEvent.change(screen.getByLabelText(k.nameLabel), { target: { value: "  VIP  " } });
    pickOp(1, "gte");
    typeValue(1, "3");
  };

  it("create sends the name and the conditions", async () => {
    renderEditor();
    completeRow();

    fireEvent.click(screen.getByRole("button", { name: k.save }));

    await waitFor(() => expect(actions.createSegmentAction).toHaveBeenCalledTimes(1));
    expect(actions.createSegmentAction).toHaveBeenCalledWith({
      name: "  VIP  ",
      conditions: [{ field: "orders_count", op: "gte", value: 3 }],
    });
  });

  it("an incomplete row blocks Save and is explained on the row", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText(k.nameLabel), { target: { value: "VIP" } });

    fireEvent.click(screen.getByRole("button", { name: k.save }));

    expect(await within(row(1)).findByText(k.errors.required)).toBeVisible();
    expect(actions.createSegmentAction).not.toHaveBeenCalled();
  });

  it("update sends expectedVersion and confirms with a status note", async () => {
    renderEditor({
      mode: "edit",
      segmentId: "s-1",
      version: 7,
      initialName: "VIP",
      initialConditions: [{ field: "orders_count", op: "gte", value: 3 }],
    });
    typeValue(1, "4");

    fireEvent.click(screen.getByRole("button", { name: k.save }));

    await waitFor(() => expect(actions.updateSegmentAction).toHaveBeenCalledTimes(1));
    expect(actions.updateSegmentAction).toHaveBeenCalledWith("s-1", {
      expectedVersion: 7,
      name: "VIP",
      conditions: [{ field: "orders_count", op: "gte", value: 4 }],
    });
    expect(await screen.findByRole("status")).toHaveTextContent(k.saved);
  });

  it("a duplicate-name 409 shows under Name, once", async () => {
    actions.createSegmentAction.mockResolvedValue({
      status: "error",
      message: en.segments.errors.duplicateName,
      fieldErrors: { name: en.segments.errors.duplicateName },
    });
    renderEditor();
    completeRow();

    fireEvent.click(screen.getByRole("button", { name: k.save }));

    const message = await screen.findByText(en.segments.errors.duplicateName);
    expect(screen.getByLabelText(k.nameLabel)).toHaveAccessibleDescription(
      en.segments.errors.duplicateName,
    );
    expect(message).toBeVisible();
    expect(screen.getAllByText(en.segments.errors.duplicateName)).toHaveLength(1);
  });

  it("a stale 409 shows the reload message with a Reload button that refreshes the page", async () => {
    actions.updateSegmentAction.mockResolvedValue({
      status: "error",
      message: en.segments.errors.stale,
      fieldErrors: {},
    });
    renderEditor({
      mode: "edit",
      segmentId: "s-1",
      version: 7,
      initialName: "VIP",
      initialConditions: [{ field: "orders_count", op: "gte", value: 3 }],
    });
    typeValue(1, "4");
    fireEvent.click(screen.getByRole("button", { name: k.save }));

    expect(await screen.findByText(en.segments.errors.stale)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: k.reload }));

    expect(router.refresh).toHaveBeenCalledTimes(1);
    // Editing on top of a stale version does not hide the warning.
    typeValue(1, "5");
    expect(screen.getByText(en.segments.errors.stale)).toBeVisible();
  });

  it("a 422 puts each message on the row its path names, and the others stay clean", async () => {
    actions.createSegmentAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { "conditions.1.days": "Use 1 to 3650 days", name: "Enter a name" },
    });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: k.addCondition }));
    typeValue(1, "1");
    pickField(2, "created_date");
    pickOp(2, "within_last_days");
    typeValue(2, "99999");

    fireEvent.click(screen.getByRole("button", { name: k.save }));

    expect(await within(row(2)).findByText("Use 1 to 3650 days")).toBeVisible();
    expect(within(row(1)).queryByRole("alert")).toBeNull();
    expect(screen.getByText("Enter a name")).toBeVisible();
    expect(within(row(2)).getByLabelText(k.valueLabel)).toBeInvalid();
  });

  it("editing a field clears the server's field errors", async () => {
    actions.createSegmentAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { "conditions.0.value": "Use 0 to 1000000" },
    });
    renderEditor();
    completeRow();
    fireEvent.click(screen.getByRole("button", { name: k.save }));
    expect(await screen.findByText("Use 0 to 1000000")).toBeVisible();

    typeValue(1, "4");

    expect(screen.queryByText("Use 0 to 1000000")).toBeNull();
  });

  it("Cancel goes back to the list", () => {
    renderEditor();

    expect(screen.getByRole("link", { name: k.cancel })).toHaveAttribute(
      "href",
      "/customers/segments",
    );
  });
});

describe("SegmentEditor — read only", () => {
  const props = {
    mode: "edit" as const,
    segmentId: "default:not_purchased",
    version: null,
    initialName: "Haven't purchased",
    initialConditions: [
      { field: "orders_count", op: "eq", value: 0 },
    ] as readonly SegmentCondition[],
    readOnly: true,
  };

  it("shows the conditions with every control disabled and no Save, Add, Remove or preview", () => {
    renderEditor(props);

    expect(screen.getByLabelText(k.nameLabel)).toBeDisabled();
    expect(within(row(1)).getByLabelText(k.fieldLabel)).toBeDisabled();
    expect(within(row(1)).getByLabelText(k.operatorLabel)).toBeDisabled();
    expect(within(row(1)).getByLabelText(k.valueLabel)).toBeDisabled();
    expect(within(row(1)).getByLabelText(k.valueLabel)).toHaveValue("0");
    expect(body().queryByRole("button", { name: k.save })).toBeNull();
    expect(body().queryByRole("button", { name: k.addCondition })).toBeNull();
    expect(body().queryByRole("button", { name: /Remove condition/ })).toBeNull();
    expect(body().queryByText(en.segments.preview.heading)).toBeNull();
  });
});

describe("SegmentEditor — Arabic", () => {
  it("renders from ar.segments.editor, with the name box left to its own direction", () => {
    renderEditor({}, ar);

    expect(screen.getByLabelText(ar.segments.editor.nameLabel)).toHaveAttribute("dir", "auto");
    expect(screen.getByRole("button", { name: ar.segments.editor.save })).toBeVisible();
    expect(screen.getByRole("button", { name: ar.segments.editor.addCondition })).toBeVisible();
    expect(screen.queryByText(en.segments.editor.addCondition)).toBeNull();
    expect(
      within(row0(ar)).getByRole("option", { name: ar.segments.editor.fields.amount_spent }),
    ).toBeInTheDocument();
  });

  it("shows preview names and emails in bdi dir=auto", async () => {
    vi.useFakeTimers();
    renderEditor({}, ar);
    fireEvent.change(
      within(
        screen.getByRole("group", {
          name: ar.segments.editor.conditionLabel.replace("{number}", "1"),
        }),
      ).getByLabelText(ar.segments.editor.valueLabel),
      { target: { value: "1" } },
    );

    await elapse();

    const name = screen.getByText("Nour Hassan");
    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "auto");
    expect(
      screen.getByText(ar.segments.customerCount.many.replace("{count}", formatNumber("ar", 12))),
    ).toBeVisible();
  });
});

function row0(t: Dictionary) {
  return screen.getByRole("group", {
    name: t.segments.editor.conditionLabel.replace("{number}", "1"),
  });
}
