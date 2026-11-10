import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PolicyDto, PolicyTemplateInputsDto } from "@/lib/api/online-store";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  generatePolicyTemplateAction: vi.fn(),
  savePolicyAction: vi.fn(),
}));
vi.mock("@/app/settings/policies/actions", () => actions);
const { PolicyCard } = await import("./policy-card");

const defaults: PolicyTemplateInputsDto = {
  storeName: "Nour",
  contactEmail: "",
  contactPhone: "",
  businessAddress: "",
  returnWindowDays: 14,
  returnShippingPaidBy: "customer",
  refundMethod: "original",
  cashOnDelivery: true,
  deliveryDays: { min: 2, max: 5 },
  shipsInternationally: false,
};
const policy = (extra: Partial<PolicyDto> = {}): PolicyDto => ({
  type: "refund",
  body: { en: "Our old text" },
  updatedAt: "2026-11-01T10:00:00.000Z",
  version: 3,
  ...extra,
});
const p = en.policies;

afterEach(() => {
  cleanup();
  for (const fn of Object.values(actions)) fn.mockReset();
  vi.restoreAllMocks();
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

function renderCard(extra: { policy?: PolicyDto; canEdit?: boolean; storefrontUrl?: string } = {}) {
  return render(
    <PolicyCard
      t={en}
      locale="en"
      type="refund"
      title="Refund policy"
      policy={extra.policy ?? policy()}
      set
      canEdit={extra.canEdit ?? true}
      defaults={defaults}
      storefrontUrl={extra.storefrontUrl ?? null}
    />,
  );
}

const textarea = () => screen.getByRole("textbox") as HTMLTextAreaElement;

async function generate(body: string) {
  actions.generatePolicyTemplateAction.mockResolvedValue({ status: "ok", body });
  fireEvent.click(screen.getByRole("button", { name: p.createFromTemplate }));
  fireEvent.click(screen.getByRole("button", { name: p.generate }));
  await flush();
}

describe("PolicyCard (spec 2.3, 2.7)", () => {
  it("asks before replacing text with a template, then shows the reminder above the editor", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard();
    await generate("## Refunds");
    expect(confirm).toHaveBeenCalledWith(p.replaceConfirm);
    expect(textarea().value).toBe("## Refunds");
    const reminder = screen.getByText(p.reminder);
    // Above the editor in document order.
    expect(
      reminder.compareDocumentPosition(textarea()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(actions.savePolicyAction).not.toHaveBeenCalled();
  });

  it("keeps the text when the merchant declines the replacement", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderCard();
    await generate("## Refunds");
    expect(textarea().value).toBe("Our old text");
    expect(screen.queryByText(p.reminder)).toBeNull();
  });

  it("fills an empty tab without asking", async () => {
    const confirm = vi.spyOn(window, "confirm");
    renderCard({ policy: policy({ body: {} }) });
    await generate("## Refunds");
    expect(confirm).not.toHaveBeenCalled();
    expect(textarea().value).toBe("## Refunds");
  });

  it("fills the chosen language's tab and opens it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard();
    actions.generatePolicyTemplateAction.mockResolvedValue({ status: "ok", body: "## الاسترجاع" });
    fireEvent.click(screen.getByRole("button", { name: p.createFromTemplate }));
    fireEvent.change(screen.getByLabelText(p.templateLocale), { target: { value: "ar" } });
    fireEvent.click(screen.getByRole("button", { name: p.generate }));
    await flush();
    expect(textarea().value).toBe("## الاسترجاع");
    expect(textarea()).toHaveAttribute("name", "body.ar");
  });

  it("saves with the card's version; the second save sends the version the first returned", async () => {
    actions.savePolicyAction.mockResolvedValueOnce({ status: "success", version: 4 });
    actions.savePolicyAction.mockResolvedValueOnce({ status: "success", version: 5 });
    renderCard();
    fireEvent.change(textarea(), { target: { value: "New text" } });
    fireEvent.click(screen.getByRole("button", { name: en.onlineStorePreferences.save }));
    await flush();
    expect(actions.savePolicyAction).toHaveBeenLastCalledWith("refund", {
      body: { en: "New text" },
      expectedVersion: 3,
    });
    expect(screen.getByRole("status")).toHaveTextContent(en.onlineStorePreferences.saved);
    fireEvent.click(screen.getByRole("button", { name: en.onlineStorePreferences.save }));
    await flush();
    expect(actions.savePolicyAction).toHaveBeenLastCalledWith("refund", {
      body: { en: "New text" },
      expectedVersion: 4,
    });
  });

  it("the reminder stays until the next save", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    actions.savePolicyAction.mockResolvedValue({ status: "success", version: 4 });
    renderCard();
    await generate("## Refunds");
    expect(screen.getByText(p.reminder)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.onlineStorePreferences.save }));
    await flush();
    expect(screen.queryByText(p.reminder)).toBeNull();
  });

  it("a refused save shows the field error on its tab and keeps the edits", async () => {
    actions.savePolicyAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { "body.en": en.richText.unsafeLinkSaved },
    });
    renderCard();
    fireEvent.change(textarea(), { target: { value: "[x](https://a.example)" } });
    fireEvent.click(screen.getByRole("button", { name: en.onlineStorePreferences.save }));
    await flush();
    expect(screen.getByText(en.richText.unsafeLinkSaved)).toBeInTheDocument();
    expect(textarea().value).toBe("[x](https://a.example)");
  });

  it("a crashed save shows our own copy and gives the button back", async () => {
    actions.savePolicyAction.mockRejectedValue(new Error("offline"));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: en.onlineStorePreferences.save }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(en.formErrors.unexpected);
    expect(screen.getByRole("button", { name: en.onlineStorePreferences.save })).toBeEnabled();
  });

  it("is read-only for a viewer: no save, no template", () => {
    renderCard({ canEdit: false });
    expect(textarea()).toBeDisabled();
    expect(screen.queryByRole("button", { name: en.onlineStorePreferences.save })).toBeNull();
    expect(screen.queryByRole("button", { name: p.createFromTemplate })).toBeNull();
  });

  it("links a set policy on the store", () => {
    renderCard({ storefrontUrl: "https://nour.example/" });
    expect(screen.getByRole("link", { name: p.viewOnStore })).toHaveAttribute(
      "href",
      "https://nour.example/policies/refund-policy",
    );
  });

  it("speaks Egyptian Arabic in an Arabic admin", () => {
    render(
      <PolicyCard
        t={ar}
        locale="ar"
        type="refund"
        title="سياسة الاسترجاع"
        policy={policy()}
        set
        canEdit
        defaults={defaults}
        storefrontUrl={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: ar.policies.createFromTemplate }),
    ).toBeInTheDocument();
    expect(screen.getByText(ar.policies.set)).toBeInTheDocument();
  });
});
