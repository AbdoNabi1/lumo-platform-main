import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Dialog } from "@platform/ui";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import type { CarrierSettingsEntryDto } from "@/lib/api/carriers";
import { CarrierDialogContent } from "./carrier-dialog";

const actions = vi.hoisted(() => ({
  saveCarrierAction: vi.fn(),
  rotateCarrierSecretAction: vi.fn(),
}));
vi.mock("@/app/settings/shipping/carrier-actions", () => actions);
const carrier: CarrierSettingsEntryDto = {
  key: "bosta",
  displayName: "Bosta",
  available: true,
  configured: true,
  enabled: true,
  config: {
    awbFormat: "A6",
    awbLanguage: "ar",
    allowToOpenPackage: false,
    apiKey: "stored-secret-never-display",
  },
  capabilities: { cod: true, awb: true, webhooks: true, cancel: true },
  webhookUrl: "https://example.test/webhook",
};
beforeEach(() => {
  expect.hasAssertions();
  vi.clearAllMocks();
  actions.saveCarrierAction.mockResolvedValue({ status: "success" });
  actions.rotateCarrierSecretAction.mockResolvedValue({ status: "success" });
});
function show(entry = carrier, t: Dictionary = en) {
  return render(
    <Dialog open>
      <CarrierDialogContent carrier={entry} t={t} onClose={() => undefined} />
    </Dialog>,
  );
}
it("never renders the saved key and starts with an empty password", async () => {
  show();
  const dialog = screen.getByRole("dialog");
  const input = within(dialog).getByLabelText(en.carrierSettings.apiKey);
  expect(input).toHaveValue("");
  expect(input).toHaveAttribute("placeholder", en.carrierSettings.apiKeySaved);
  fireEvent.click(within(dialog).getByRole("button", { name: en.carrierSettings.save }));
  await waitFor(() => expect(actions.saveCarrierAction).toHaveBeenCalled());
  expect(document.body.innerHTML).not.toContain("stored-secret-never-display");
  expect(input).toHaveValue("");
  expect(input).toHaveAttribute("placeholder", en.carrierSettings.apiKeySaved);
});
it("copies the webhook URL", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  show();
  fireEvent.click(screen.getByRole("button", { name: en.carrierSettings.webhookUrl }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(carrier.webhookUrl));
});
function activate(element: HTMLElement) {
  expect(element).toHaveFocus();
  fireEvent.keyDown(element, { key: "Enter", code: "Enter" });
  // jsdom does not synthesize the browser's click for Enter on a button.
  fireEvent.click(element, { detail: 0 });
  fireEvent.keyUp(element, { key: "Enter", code: "Enter" });
}
it("rotate confirmation supports keyboard cancellation and confirmation", async () => {
  show();
  const trigger = screen.getByRole("button", { name: en.carrierSettings.rotate });
  trigger.focus();
  activate(trigger);
  let dialog = screen.getByRole("dialog", { name: en.carrierSettings.rotate });
  expect(dialog).toHaveAccessibleDescription(en.carrierSettings.confirmRotate);
  let cancel = within(dialog).getByRole("button", { name: en.carrierSettings.cancel });
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
  expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(cancel).toHaveFocus();
  trigger.focus();
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(actions.rotateCarrierSecretAction).not.toHaveBeenCalled();
  fireEvent.keyDown(cancel, { key: "Escape" });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(actions.rotateCarrierSecretAction).not.toHaveBeenCalled();

  activate(trigger);
  dialog = screen.getByRole("dialog", { name: en.carrierSettings.rotate });
  cancel = within(dialog).getByRole("button", { name: en.carrierSettings.cancel });
  activate(cancel);
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(actions.rotateCarrierSecretAction).not.toHaveBeenCalled();

  activate(trigger);
  dialog = screen.getByRole("dialog", { name: en.carrierSettings.rotate });
  const confirm = within(dialog).getByRole("button", { name: en.carrierSettings.rotate });
  confirm.focus();
  activate(confirm);
  await waitFor(() => expect(actions.rotateCarrierSecretAction).toHaveBeenCalledTimes(1));
  expect(actions.rotateCarrierSecretAction).toHaveBeenCalledWith("bosta");
});
it.each([en, ar])("isolates Bosta and other carrier dialog titles", (t) => {
  const first = show(carrier, t);
  expect(screen.getByText(t.carrierSettings.carrierBosta).closest("bdi")).toHaveAttribute(
    "dir",
    "auto",
  );
  first.unmount();
  const other = { ...carrier, key: "other", displayName: "شركة Example" };
  show(other, t);
  expect(screen.getByText(other.displayName).closest("bdi")).toHaveAttribute("dir", "auto");
});
