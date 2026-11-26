import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import type { NotificationSettingsSnapshot } from "@/lib/notification-settings-model";
import type { EmailConnectionSnapshot } from "@/lib/notification-settings-model";
import {
  EMAIL_CONNECTED,
  EMAIL_FAILED,
  EMAIL_NONE,
  EMAIL_OFF,
  SETTINGS,
  TEMPLATES,
  template,
} from "./test-fixtures";
import { NotificationSettingsPanel } from "./notification-settings-panel";

const saveAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/settings/notifications/actions", () => ({
  saveNotificationSettingsAction: saveAction,
  saveEmailConnectionAction: vi.fn(),
  setEmailConnectionEnabledAction: vi.fn(),
  testEmailConnectionAction: vi.fn(),
  disconnectEmailConnectionAction: vi.fn(),
}));

const copy = en.notificationSettings;

/** Echoes the patch back the way the server does: the merged document with the next version. */
function echo(base: NotificationSettingsSnapshot) {
  let current = base;
  return async (input: { expectedVersion: number | null; patch: object }) => {
    current = {
      ...current,
      version: (input.expectedVersion ?? 0) + 1,
      values: { ...current.values, ...input.patch },
    };
    return { status: "success", settings: current };
  };
}

beforeEach(() => {
  cleanup();
  saveAction.mockReset().mockImplementation(echo(SETTINGS));
});

function renderPanel(
  settings: NotificationSettingsSnapshot = SETTINGS,
  templates = TEMPLATES,
  t: Dictionary = en,
  emailConnection: EmailConnectionSnapshot | null = EMAIL_CONNECTED,
) {
  return render(
    <NotificationSettingsPanel
      settings={settings}
      templates={templates}
      emailConnection={emailConnection}
      t={t}
    />,
  );
}

describe("NotificationSettingsPanel (Wave 2b)", () => {
  it("shows no banner while the store's email account is connected", () => {
    expect.hasAssertions();
    renderPanel();

    expect(screen.queryByText(copy.deliveryOff)).toBeNull();
    expect(screen.queryByText(copy.deliveryOffDisabled)).toBeNull();
    expect(screen.queryByText(copy.deliveryOffFailed)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("tells the store that customer emails are off until it connects its email account", () => {
    expect.hasAssertions();
    renderPanel(
      { ...SETTINGS, deliveryConfigured: false, emailConnection: "none" },
      TEMPLATES,
      en,
      EMAIL_NONE,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Customer emails are off until you connect your store's email account.",
    );
  });

  it.each([
    ["switched off", EMAIL_OFF, "disabled", "deliveryOffDisabled"],
    ["failing", EMAIL_FAILED, "failed", "deliveryOffFailed"],
  ] as const)(
    "says why customer emails are off when the account is %s",
    (_label, account, state, key) => {
      expect.hasAssertions();
      renderPanel(
        { ...SETTINGS, deliveryConfigured: false, emailConnection: state },
        TEMPLATES,
        en,
        account,
      );

      expect(screen.getByRole("status")).toHaveTextContent(copy[key]);
    },
  );

  it("falls back to the settings' own summary when the account could not be read", () => {
    expect.hasAssertions();
    renderPanel(
      { ...SETTINGS, deliveryConfigured: false, emailConnection: "failed" },
      TEMPLATES,
      en,
      null,
    );

    expect(screen.getByRole("status")).toHaveTextContent(copy.deliveryOffFailed);
    expect(screen.getByText(copy.email.loadError)).toBeInTheDocument();
  });

  it("puts the Email account first and no sender-domain section anywhere", () => {
    expect.hasAssertions();
    renderPanel();

    const html = document.body.innerHTML;
    const order = [copy.email.title, copy.customerTitle, copy.staffTitle].map((title) =>
      html.indexOf(title),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(document.body.textContent).not.toMatch(/authenticate|sender email|dns/i);
  });

  it("follows the account live: disconnecting turns the banner on at once", async () => {
    expect.hasAssertions();
    const actions = await import("@/app/settings/notifications/actions");
    vi.mocked(actions.disconnectEmailConnectionAction).mockResolvedValue({
      status: "success",
      snapshot: EMAIL_NONE,
    });
    renderPanel();
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: copy.email.disconnect }));
    fireEvent.click(
      await within(await screen.findByRole("dialog")).findByRole("button", {
        name: copy.email.disconnectConfirm,
      }),
    );

    await vi.waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((node) => node.textContent?.includes(copy.deliveryOff) === true),
      ).toBe(true),
    );
  });

  it("replaces the account with a newer version from the server", () => {
    expect.hasAssertions();
    const { rerender } = renderPanel();
    expect(screen.getByTestId("email-status")).toHaveTextContent(copy.email.statusConnected);

    rerender(
      <NotificationSettingsPanel
        settings={SETTINGS}
        templates={TEMPLATES}
        emailConnection={EMAIL_FAILED}
        t={en}
      />,
    );
    expect(screen.getByTestId("email-status")).toHaveTextContent(copy.email.statusConnected);

    rerender(
      <NotificationSettingsPanel
        settings={SETTINGS}
        templates={TEMPLATES}
        emailConnection={{
          ...EMAIL_FAILED,
          connection: { ...EMAIL_FAILED.connection!, version: 9 },
        }}
        t={en}
      />,
    );
    expect(screen.getByTestId("email-status")).toHaveTextContent(copy.email.statusFailed);
  });

  it("links to the delivery log", () => {
    expect.hasAssertions();
    renderPanel();

    expect(screen.getByRole("link", { name: copy.deliveryLogLink })).toHaveAttribute(
      "href",
      "/notifications",
    );
  });

  it("lists the five customer notifications and the staff one, each with an Edit link", () => {
    expect.hasAssertions();
    renderPanel();

    const customer = screen
      .getByRole("heading", { name: copy.customerTitle })
      .closest("div")!.parentElement!;
    const names = within(customer)
      .getAllByRole("listitem")
      .map((item) => item.querySelector("p")?.textContent);
    expect(names).toEqual([
      copy.templateNames.order_confirmation,
      copy.templateNames.order_canceled,
      copy.templateNames.order_refunded,
      copy.templateNames.shipping_confirmation,
      copy.templateNames.draft_order_invoice,
    ]);
    expect(
      screen.getByRole("link", { name: `${copy.edit}: ${copy.templateNames.order_refunded}` }),
    ).toHaveAttribute("href", "/settings/notifications/order_refunded");
    expect(
      screen.getByRole("link", { name: `${copy.edit}: ${copy.templateNames.staff_new_order}` }),
    ).toHaveAttribute("href", "/settings/notifications/staff_new_order");
  });

  it("marks a template the merchant customized", () => {
    expect.hasAssertions();
    const custom = template({
      locales: {
        en: { subject: "s", body: "b", customized: true },
        ar: { subject: "s", body: "b", customized: false },
      },
    });
    renderPanel(SETTINGS, [custom, ...TEMPLATES.slice(1)]);

    expect(screen.getAllByText(copy.customized)).toHaveLength(1);
  });

  it("turns a notification off with the loaded version and keeps the others as they were", async () => {
    expect.hasAssertions();
    renderPanel();

    const toggle = screen.getByRole("switch", {
      name: copy.toggleLabel.replace("{name}", copy.templateNames.order_canceled),
    });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    await vi.waitFor(() => expect(toggle).not.toBeChecked());
    expect(saveAction).toHaveBeenCalledWith({
      expectedVersion: 3,
      patch: { disabledTemplates: ["order_canceled"] },
    });
  });

  it("turns it back on, and the next save uses the version the last one returned", async () => {
    expect.hasAssertions();
    renderPanel({
      ...SETTINGS,
      values: { ...SETTINGS.values, disabledTemplates: ["order_canceled"] },
    });
    saveAction.mockImplementation(
      echo({ ...SETTINGS, values: { ...SETTINGS.values, disabledTemplates: ["order_canceled"] } }),
    );

    const toggle = screen.getByRole("switch", {
      name: copy.toggleLabel.replace("{name}", copy.templateNames.order_canceled),
    });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(toggle).toBeChecked());
    expect(saveAction).toHaveBeenLastCalledWith({
      expectedVersion: 3,
      patch: { disabledTemplates: [] },
    });

    fireEvent.click(toggle);
    await vi.waitFor(() => expect(saveAction).toHaveBeenCalledTimes(2));
    expect(saveAction).toHaveBeenLastCalledWith({
      expectedVersion: 4,
      patch: { disabledTemplates: ["order_canceled"] },
    });
  });

  it("shows the conflict message and leaves the switch where it was when the save is refused", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({ status: "error", message: copy.conflict, fieldErrors: {} });
    renderPanel();

    const toggle = screen.getByRole("switch", {
      name: copy.toggleLabel.replace("{name}", copy.templateNames.order_canceled),
    });
    fireEvent.click(toggle);

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.conflict);
    expect(toggle).toBeChecked();
  });

  describe("staff notifications", () => {
    function staff(): HTMLElement {
      return screen.getByRole("region", { name: copy.recipientsLabel });
    }

    it("says nobody gets New order emails while the list is empty", () => {
      expect.hasAssertions();
      renderPanel();

      expect(within(staff()).getByText(copy.recipientsEmpty)).toBeInTheDocument();
    });

    it("adds a recipient (lower-cased) with the loaded version and shows it in <bdi dir=auto>", async () => {
      expect.hasAssertions();
      renderPanel();

      fireEvent.change(screen.getByLabelText(copy.recipientLabel), {
        target: { value: " Owner@Shop.Example " },
      });
      fireEvent.click(screen.getByRole("button", { name: copy.recipientAdd }));

      const added = await within(staff()).findByText("owner@shop.example");
      expect(added.tagName).toBe("BDI");
      expect(added).toHaveAttribute("dir", "auto");
      expect(saveAction).toHaveBeenCalledWith({
        expectedVersion: 3,
        patch: { staffRecipients: ["owner@shop.example"] },
      });
      expect(screen.getByLabelText(copy.recipientLabel)).toHaveValue("");
    });

    it("refuses an invalid address and a duplicate without calling the server", () => {
      expect.hasAssertions();
      renderPanel({
        ...SETTINGS,
        values: { ...SETTINGS.values, staffRecipients: ["owner@shop.example"] },
      });

      fireEvent.change(screen.getByLabelText(copy.recipientLabel), { target: { value: "nope" } });
      fireEvent.click(screen.getByRole("button", { name: copy.recipientAdd }));
      expect(screen.getByText(copy.recipientInvalid)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(copy.recipientLabel), {
        target: { value: "OWNER@shop.example" },
      });
      fireEvent.click(screen.getByRole("button", { name: copy.recipientAdd }));
      expect(screen.getByText(copy.recipientDuplicate)).toBeInTheDocument();
      expect(saveAction).not.toHaveBeenCalled();
    });

    it("refuses an eleventh recipient", () => {
      expect.hasAssertions();
      const ten = Array.from({ length: 10 }, (_, i) => `a${i}@shop.example`);
      renderPanel({ ...SETTINGS, values: { ...SETTINGS.values, staffRecipients: ten } });

      fireEvent.change(screen.getByLabelText(copy.recipientLabel), {
        target: { value: "extra@shop.example" },
      });
      fireEvent.click(screen.getByRole("button", { name: copy.recipientAdd }));

      expect(screen.getByText(copy.recipientsFull.replace("{max}", "10"))).toBeInTheDocument();
      expect(saveAction).not.toHaveBeenCalled();
    });

    it("removes a recipient", async () => {
      expect.hasAssertions();
      const base = {
        ...SETTINGS,
        values: { ...SETTINGS.values, staffRecipients: ["a@shop.example", "b@shop.example"] },
      };
      saveAction.mockImplementation(echo(base));
      renderPanel(base);

      fireEvent.click(
        screen.getByRole("button", {
          name: copy.recipientRemove.replace("{email}", "a@shop.example"),
        }),
      );

      await vi.waitFor(() => expect(within(staff()).queryByText("a@shop.example")).toBeNull());
      expect(saveAction).toHaveBeenCalledWith({
        expectedVersion: 3,
        patch: { staffRecipients: ["b@shop.example"] },
      });
      expect(within(staff()).getByText("b@shop.example")).toBeInTheDocument();
    });

    it("shows the server's refusal and keeps the typed address", async () => {
      expect.hasAssertions();
      saveAction.mockResolvedValue({
        status: "error",
        message: en.formErrors.invalid,
        fieldErrors: { staffRecipients: copy.recipientInvalid },
      });
      renderPanel();

      fireEvent.change(screen.getByLabelText(copy.recipientLabel), {
        target: { value: "a@shop.example" },
      });
      fireEvent.click(screen.getByRole("button", { name: copy.recipientAdd }));

      expect(await screen.findByText(copy.recipientInvalid)).toBeInTheDocument();
      expect(screen.getByLabelText(copy.recipientLabel)).toHaveValue("a@shop.example");
    });
  });

  it("renders in Arabic with every section titled and logical classes only", () => {
    expect.hasAssertions();
    const { container } = renderPanel(SETTINGS, TEMPLATES, ar);
    const arCopy = ar.notificationSettings;

    for (const title of [arCopy.email.title, arCopy.customerTitle, arCopy.staffTitle]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: arCopy.deliveryLogLink })).toBeInTheDocument();
    const classes = Array.from(container.querySelectorAll("[class]"))
      .map((element) => element.getAttribute("class") ?? "")
      .join(" ")
      .split(/\s+/);
    expect(classes.filter((cls) => /(^|:)(ml|mr|pl|pr|left|right)-/.test(cls))).toEqual([]);
  });
});
