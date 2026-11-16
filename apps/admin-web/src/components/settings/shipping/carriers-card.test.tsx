import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { CarrierSettingsEntryDto } from "@/lib/api/carriers";
import { CarriersCard } from "./carriers-card";

const action = vi.hoisted(() => vi.fn());
vi.mock("@/app/settings/shipping/carrier-actions", () => ({
  disconnectCarrierAction: action,
  saveCarrierAction: vi.fn(),
  rotateCarrierSecretAction: vi.fn(),
}));
const carrier: CarrierSettingsEntryDto = {
  key: "bosta",
  displayName: "Bosta",
  available: true,
  configured: true,
  enabled: true,
  config: null,
  capabilities: { cod: true, awb: true, webhooks: true, cancel: true },
  webhookUrl: null,
};
beforeEach(() => {
  expect.hasAssertions();
  action.mockReset().mockResolvedValue({ status: "success" });
});
function activate(element: HTMLElement) {
  expect(element).toHaveFocus();
  fireEvent.keyDown(element, { key: "Enter", code: "Enter" });
  // jsdom does not synthesize the browser's click for Enter on a button.
  fireEvent.click(element, { detail: 0 });
  fireEvent.keyUp(element, { key: "Enter", code: "Enter" });
}

it("disconnect confirmation supports keyboard cancellation and confirmation", async () => {
  render(<CarriersCard carriers={[carrier]} t={en} />);
  const trigger = screen.getByRole("button", { name: en.carrierSettings.disconnect });
  trigger.focus();
  activate(trigger);
  let dialog = screen.getByRole("dialog", { name: en.carrierSettings.disconnect });
  expect(dialog).toHaveAccessibleDescription(en.carrierSettings.confirmDisconnect);
  let cancel = within(dialog).getByRole("button", { name: en.carrierSettings.cancel });
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
  expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(cancel).toHaveFocus();
  trigger.focus();
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(action).not.toHaveBeenCalled();
  fireEvent.keyDown(cancel, { key: "Escape" });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(action).not.toHaveBeenCalled();

  activate(trigger);
  dialog = screen.getByRole("dialog", { name: en.carrierSettings.disconnect });
  cancel = within(dialog).getByRole("button", { name: en.carrierSettings.cancel });
  activate(cancel);
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(action).not.toHaveBeenCalled();

  activate(trigger);
  dialog = screen.getByRole("dialog", { name: en.carrierSettings.disconnect });
  const confirm = within(dialog).getByRole("button", { name: en.carrierSettings.disconnect });
  confirm.focus();
  activate(confirm);
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  expect(action).toHaveBeenCalledWith("bosta");
});
it.each([en, ar])("isolates carrier names and badges both connection states", (t) => {
  const other = { ...carrier, key: "other", displayName: "شركة Example", configured: false };
  render(<CarriersCard carriers={[carrier, other]} t={t} />);
  for (const name of [t.carrierSettings.carrierBosta, other.displayName]) {
    expect(screen.getByText(name).closest("bdi")).toHaveAttribute("dir", "auto");
  }
  for (const label of [t.carrierSettings.connected, t.carrierSettings.notConnected]) {
    const badge = screen.getByText(label);
    expect(badge.tagName).toBe("SPAN");
    expect(badge).toHaveClass("rounded-full");
  }
});
