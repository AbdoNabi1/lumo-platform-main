import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
  action.mockReset();
});
it("shows connection status and requires confirmation to disconnect", () => {
  render(<CarriersCard carriers={[carrier]} t={en} />);
  expect(screen.getByText(en.carrierSettings.connected)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: en.carrierSettings.disconnect }));
  expect(screen.getByText(en.carrierSettings.confirmDisconnect)).toBeInTheDocument();
  expect(action).not.toHaveBeenCalled();
});
