import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { WhatsAppConnectionDto, WhatsAppTemplateDto } from "@/lib/api/outreach";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { WhatsAppConnectionCard } from "./whatsapp-connection-card";

const actions = vi.hoisted(() => ({
  abandonOnboardingAction: vi.fn(),
  disconnectWhatsAppAction: vi.fn(),
  refreshWhatsAppAction: vi.fn(),
  connectWhatsAppAction: vi.fn(),
  testSendAction: vi.fn(),
}));
vi.mock("@/app/settings/whatsapp/actions", () => actions);

const signup = { appId: "1234567890", configId: "cfg-42", graphApiVersion: "v24.0" };
const base: WhatsAppConnectionDto = {
  available: true,
  status: "not_connected",
  displayPhoneNumber: null,
  verifiedName: null,
  qualityRating: null,
  messagingLimitTier: null,
  connectedAt: null,
  lastError: null,
  onboardingFailure: null,
  onboardingStage: null,
  version: 0,
  signup,
};
const connected: WhatsAppConnectionDto = {
  ...base,
  status: "connected",
  displayPhoneNumber: "+20 100 123 4567",
  verifiedName: "Nour Store",
  qualityRating: "GREEN",
  messagingLimitTier: "TIER_250",
  connectedAt: "2026-11-20T10:00:00.000Z",
  version: 4,
};
const onboarding: WhatsAppConnectionDto = { ...base, status: "onboarding", version: 2 };
const template: WhatsAppTemplateDto = {
  name: "order_update",
  language: "en",
  category: "UTILITY",
  status: "APPROVED",
  variableCount: 1,
  supported: true,
  sendShape: { bodyVariableCount: 1, headerHasVariable: false, buttons: [] },
};

function renderCard(
  connection: WhatsAppConnectionDto,
  t: Dictionary = en,
  templates: readonly WhatsAppTemplateDto[] | null = [template],
) {
  return render(
    <WhatsAppConnectionCard
      connection={connection}
      templates={templates}
      t={t}
      locale={t === ar ? "ar" : "en"}
    />,
  );
}

beforeEach(() => {
  expect.hasAssertions();
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.disconnectWhatsAppAction.mockResolvedValue({ status: "success" });
  actions.abandonOnboardingAction.mockResolvedValue({ status: "success" });
  actions.refreshWhatsAppAction.mockResolvedValue({ status: "success" });
});

/** Dictionary copy is split around brand `<bdi>`s, so match an element by its whole text. */
const hasText = (text: string, tag?: string) => (_c: string, el: Element | null) =>
  el !== null && (tag === undefined || el.tagName === tag) && el.textContent === text;

function activate(element: HTMLElement) {
  expect(element).toHaveFocus();
  fireEvent.keyDown(element, { key: "Enter", code: "Enter" });
  // jsdom does not synthesize the browser's click for Enter on a button.
  fireEvent.click(element, { detail: 0 });
  fireEvent.keyUp(element, { key: "Enter", code: "Enter" });
}

describe("each state renders", () => {
  it("available:false is an info card with no Connect button", () => {
    expect.hasAssertions();
    const { signup: _signup, ...rest } = base;
    renderCard({ ...rest, available: false });
    expect(
      screen.getByRole("heading", { name: en.whatsappSettings.unavailableTitle }),
    ).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(en.whatsappSettings.unavailableBody);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["not_connected", "disconnected"] as const)(
    "%s explains what is needed and offers Connect WhatsApp",
    (status) => {
      expect.hasAssertions();
      renderCard({ ...base, status });
      expect(screen.getByText(hasText(en.whatsappSettings.needAccount, "LI"))).toBeInTheDocument();
      expect(screen.getByText(hasText(en.whatsappSettings.needNumber, "LI"))).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeEnabled();
      expect(screen.getByText(en.whatsappSettings.statusNotConnected)).toBeInTheDocument();
    },
  );

  it("never mentions coexistence", () => {
    expect.hasAssertions();
    renderCard({ ...base });
    expect(document.body.textContent?.toLowerCase()).not.toContain("coexist");
  });

  it("not connected without signup data offers no button", () => {
    expect.hasAssertions();
    const { signup: _signup, ...rest } = base;
    renderCard(rest);
    expect(screen.queryByRole("button", { name: "Connect WhatsApp" })).toBeNull();
  });

  it("connected shows the number, verified name, quality, limit and date", () => {
    expect.hasAssertions();
    renderCard(connected);
    expect(screen.getByText("+20 100 123 4567")).toBeInTheDocument();
    expect(screen.getByText("Nour Store")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(
      screen.getByText(
        hasText(
          "Business messaging limit: up to 250 customers you start conversations with in 24 hours (shared across your business)",
          "P",
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Nov 20, 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.whatsappSettings.refresh })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.whatsappSettings.sendTest })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.whatsappSettings.disconnect }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["GREEN", "High"],
    ["YELLOW", "Medium"],
    ["RED", "Low"],
    [null, "Not rated yet"],
  ])("quality %s reads %s", (rating, label) => {
    expect.hasAssertions();
    renderCard({ ...connected, qualityRating: rating });
    expect(screen.getByText(label)).toHaveClass("rounded-full");
  });

  it("an unknown limit tier reads — and never the raw tier", () => {
    expect.hasAssertions();
    renderCard({ ...connected, messagingLimitTier: "TIER_SECRET_9" });
    expect(screen.getByText(hasText("Business messaging limit: —", "P"))).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("TIER_SECRET_9");
  });

  it("error shows the connected card plus an alert with the mapped copy", () => {
    expect.hasAssertions();
    renderCard({ ...connected, status: "error", lastError: "AUTHORIZATION_EXPIRED" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.whatsappSettings.errors.AUTHORIZATION_EXPIRED,
    );
    expect(screen.getByText("+20 100 123 4567")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.whatsappSettings.refresh })).toBeInTheDocument();
  });

  it.each(["META_131056", "PROVIDER_ERROR", "HTTP_500", null])(
    "error with code %s shows generic copy, never the code",
    (code) => {
      expect.hasAssertions();
      renderCard({ ...connected, status: "error", lastError: code });
      expect(screen.getByRole("alert")).toHaveTextContent(en.whatsappSettings.errors.generic);
      expect(document.body.textContent).not.toMatch(/META_|HTTP_|PROVIDER_ERROR/);
    },
  );
});

describe("onboarding state (R2-B01, R3-B01)", () => {
  it("says the setup isn't finished and offers Continue setup and Cancel setup", () => {
    expect.hasAssertions();
    renderCard({ ...onboarding, onboardingFailure: null });
    expect(screen.getByRole("heading", { name: "Setup isn't finished." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue setup" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel setup" })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ONBOARDING_RECONCILIATION_REQUIRED shows the plan's copy and offers Cancel setup for a different number", () => {
    expect.hasAssertions();
    renderCard({ ...onboarding, onboardingFailure: "ONBOARDING_RECONCILIATION_REQUIRED" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Turn off two-step verification for this number in WhatsApp Manager, then continue setup.",
    );
    expect(
      screen.getByText(hasText(en.whatsappSettings.reconciliationCancelHint, "P")),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel setup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue setup" })).toBeInTheDocument();
  });

  it("an unknown failure shows generic copy, never the code", () => {
    expect.hasAssertions();
    renderCard({ ...onboarding, onboardingFailure: "META_131056" });
    expect(screen.getByRole("alert")).toHaveTextContent(en.whatsappSettings.errors.generic);
    expect(document.body).not.toHaveTextContent("META_131056");
  });

  it("Continue setup runs the same Embedded Signup flow", async () => {
    expect.hasAssertions();
    const login = vi.fn();
    const init = vi.fn();
    (window as unknown as { FB: unknown }).FB = { init, login };
    renderCard(onboarding);
    fireEvent.click(screen.getByRole("button", { name: "Continue setup" }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(init).toHaveBeenCalledWith({ appId: "1234567890", version: "v24.0", xfbml: false });
    delete (window as unknown as { FB?: unknown }).FB;
  });

  it("the Cancel setup dialog has the plan's description, focuses Keep setup, closes on Escape and returns focus to the trigger", async () => {
    expect.hasAssertions();
    renderCard(onboarding);
    const trigger = screen.getByRole("button", { name: "Cancel setup" });
    trigger.focus();
    activate(trigger);
    const dialog = screen.getByRole("dialog", { name: "Cancel setup" });
    expect(dialog).toHaveAccessibleDescription(
      "This stops the unfinished WhatsApp setup. You can start again with any number.",
    );
    const keep = within(dialog).getByRole("button", { name: en.whatsappSettings.keepSetup });
    expect(keep).toHaveFocus();
    expect(trigger).toBeInTheDocument(); // the trigger stays mounted while the dialog is open
    fireEvent.keyDown(keep, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.abandonOnboardingAction).not.toHaveBeenCalled();
  });

  it("confirming calls abandonOnboardingAction with the version and shows a refusal as an alert", async () => {
    expect.hasAssertions();
    actions.abandonOnboardingAction.mockResolvedValue({
      status: "error",
      message: en.whatsappSettings.errors.ONBOARDING_NOT_ACTIVE,
    });
    renderCard({ ...onboarding, version: 9 });
    const trigger = screen.getByRole("button", { name: "Cancel setup" });
    trigger.focus();
    activate(trigger);
    const dialog = screen.getByRole("dialog", { name: "Cancel setup" });
    const confirm = within(dialog).getByRole("button", { name: "Cancel setup" });
    confirm.focus();
    activate(confirm);
    await waitFor(() => expect(actions.abandonOnboardingAction).toHaveBeenCalledTimes(1));
    expect(actions.abandonOnboardingAction).toHaveBeenCalledWith(9);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.whatsappSettings.errors.ONBOARDING_NOT_ACTIVE,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Disconnect dialog (A7)", () => {
  it("has a title and description, focuses Cancel, closes on Escape, returns focus to the trigger which stays mounted", async () => {
    expect.hasAssertions();
    renderCard(connected);
    const trigger = screen.getByRole("button", { name: en.whatsappSettings.disconnect });
    trigger.focus();
    activate(trigger);
    const dialog = screen.getByRole("dialog", { name: en.whatsappSettings.disconnectTitle });
    expect(dialog).toHaveAccessibleDescription(
      "Automations will stop sending WhatsApp messages. You can connect again at any time.",
    );
    const cancel = within(dialog).getByRole("button", { name: en.whatsappSettings.cancel });
    expect(cancel).toHaveFocus();
    expect(trigger).toBeInTheDocument();
    expect(trigger.isConnected).toBe(true);
    fireEvent.keyDown(cancel, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger.isConnected).toBe(true);
    expect(actions.disconnectWhatsAppAction).not.toHaveBeenCalled();
  });

  it("Cancel closes without calling the action and focus returns to the trigger", async () => {
    expect.hasAssertions();
    renderCard(connected);
    const trigger = screen.getByRole("button", { name: en.whatsappSettings.disconnect });
    trigger.focus();
    activate(trigger);
    const cancel = within(screen.getByRole("dialog")).getByRole("button", {
      name: en.whatsappSettings.cancel,
    });
    activate(cancel);
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(actions.disconnectWhatsAppAction).not.toHaveBeenCalled();
  });

  it("confirming disconnects with the stored version", async () => {
    expect.hasAssertions();
    renderCard(connected);
    const trigger = screen.getByRole("button", { name: en.whatsappSettings.disconnect });
    trigger.focus();
    activate(trigger);
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: en.whatsappSettings.disconnect });
    confirm.focus();
    activate(confirm);
    await waitFor(() => expect(actions.disconnectWhatsAppAction).toHaveBeenCalledTimes(1));
    expect(actions.disconnectWhatsAppAction).toHaveBeenCalledWith(4);
  });

  it("a refused disconnect shows the localised message", async () => {
    expect.hasAssertions();
    actions.disconnectWhatsAppAction.mockResolvedValue({
      status: "error",
      message: en.whatsappSettings.errors.stale,
    });
    renderCard(connected);
    const trigger = screen.getByRole("button", { name: en.whatsappSettings.disconnect });
    trigger.focus();
    activate(trigger);
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: en.whatsappSettings.disconnect,
    });
    confirm.focus();
    activate(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(en.whatsappSettings.errors.stale);
  });
});

describe("Refresh and the test panel", () => {
  it("Refresh status calls the action and says so", async () => {
    expect.hasAssertions();
    renderCard(connected);
    fireEvent.click(screen.getByRole("button", { name: en.whatsappSettings.refresh }));
    await waitFor(() => expect(actions.refreshWhatsAppAction).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(en.whatsappSettings.refreshed)).toBeInTheDocument();
  });

  it("a refused refresh shows the message as an alert", async () => {
    expect.hasAssertions();
    actions.refreshWhatsAppAction.mockResolvedValue({
      status: "error",
      message: en.whatsappSettings.errors.generic,
    });
    renderCard(connected);
    fireEvent.click(screen.getByRole("button", { name: en.whatsappSettings.refresh }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.whatsappSettings.errors.generic);
  });

  it("Send a test message opens the form, with the approved templates", () => {
    expect.hasAssertions();
    renderCard(connected);
    const button = screen.getByRole("button", { name: en.whatsappSettings.sendTest });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(en.whatsappSettings.test.to)).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(en.whatsappSettings.test.to)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "order_update · en" })).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByLabelText(en.whatsappSettings.test.to)).toBeNull();
  });

  it("says so when the templates could not be loaded", () => {
    expect.hasAssertions();
    renderCard(connected, en, null);
    fireEvent.click(screen.getByRole("button", { name: en.whatsappSettings.sendTest }));
    expect(screen.getByRole("note")).toHaveTextContent(en.whatsappSettings.loadError);
  });
});

describe("non-disclosure (document.body)", () => {
  it("never renders a WABA id, a phone-number id, credentials or provider text, whatever the API sent", () => {
    expect.hasAssertions();
    const polluted = {
      ...connected,
      status: "error",
      lastError: "META_131056",
      phoneNumberId: "109876543210987",
      wabaId: "223344556677889",
      sealedCredentials: "sealed:AAAA",
      accessToken: "EAAB-secret-token",
    } as unknown as WhatsAppConnectionDto;
    renderCard(polluted);
    fireEvent.click(screen.getByRole("button", { name: en.whatsappSettings.sendTest }));
    const html = document.body.innerHTML;
    for (const secret of [
      "phoneNumberId",
      "wabaId",
      "109876543210987",
      "223344556677889",
      "sealed",
      "EAAB-secret-token",
      "META_131056",
    ]) {
      expect(html).not.toContain(secret);
    }
  });

  it("an onboarding card never renders ids either", () => {
    expect.hasAssertions();
    renderCard({
      ...onboarding,
      onboardingStage: "registering",
      onboardingFailure: "PHONE_IN_USE",
    });
    const text = document.body.innerHTML;
    expect(text).not.toMatch(/phoneNumberId|wabaId|registering/);
    expect(screen.getByRole("alert")).toHaveTextContent(en.whatsappSettings.errors.PHONE_IN_USE);
  });
});

describe("RTL and brand isolation", () => {
  it("renders the phone number inside <bdi dir=ltr> and the verified name inside <bdi dir=auto>", () => {
    expect.hasAssertions();
    renderCard({ ...connected, verifiedName: "متجر نور" }, ar);
    const phone = screen.getByText("+20 100 123 4567");
    expect(phone.tagName).toBe("BDI");
    expect(phone).toHaveAttribute("dir", "ltr");
    const name = screen.getByText("متجر نور");
    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "auto");
  });

  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)("isolates every brand name in <bdi dir=auto> (%s)", (_locale, t: Dictionary) => {
    expect.hasAssertions();
    const { signup: _signup, ...rest } = base;
    const { unmount } = renderCard({ ...rest, available: false }, t);
    for (const brand of Array.from(document.querySelectorAll("bdi"))) {
      expect(brand).toHaveAttribute("dir", "auto");
    }
    expect(screen.getAllByText("WhatsApp")[0]!.closest("bdi")).toHaveAttribute("dir", "auto");
    unmount();
    renderCard(onboarding, t);
    for (const brand of screen.getAllByText("WhatsApp")) {
      expect(brand.closest("bdi")).toHaveAttribute("dir", "auto");
    }
  });

  it("uses logical spacing, never a physical left/right class", () => {
    expect.hasAssertions();
    renderCard(connected, ar);
    const classes = Array.from(document.querySelectorAll("[class]"))
      .map((el) => el.getAttribute("class") ?? "")
      .join(" ");
    expect(classes).not.toMatch(/(^|\s)(ml|mr|pl|pr|left|right|text-left|text-right)-/);
  });

  it("renders Arabic copy for the connected state", () => {
    expect.hasAssertions();
    renderCard(connected, ar);
    expect(screen.getByRole("button", { name: ar.whatsappSettings.refresh })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ar.whatsappSettings.disconnect }),
    ).toBeInTheDocument();
    expect(screen.getByText("عالي")).toBeInTheDocument();
  });
});
