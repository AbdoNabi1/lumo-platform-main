import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog } from "@platform/ui";
import { en } from "@/messages/en";
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
function show() {
  return render(
    <Dialog open>
      <CarrierDialogContent carrier={carrier} t={en} onClose={() => undefined} />
    </Dialog>,
  );
}
it("never renders the saved key and starts with an empty password", async () => {
  const { container } = show();
  const input = screen.getByLabelText(en.carrierSettings.apiKey);
  expect(input).toHaveValue("");
  expect(input).toHaveAttribute("placeholder", en.carrierSettings.apiKeySaved);
  fireEvent.click(screen.getByRole("button", { name: en.carrierSettings.save }));
  await waitFor(() => expect(actions.saveCarrierAction).toHaveBeenCalled());
  expect(container.innerHTML).not.toContain("stored-secret-never-display");
});
it("copies the webhook URL", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  show();
  fireEvent.click(screen.getByRole("button", { name: en.carrierSettings.webhookUrl }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(carrier.webhookUrl));
});
it("requires confirmation before rotating", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: en.carrierSettings.rotate }));
  expect(screen.getByText(en.carrierSettings.confirmRotate)).toBeInTheDocument();
  expect(actions.rotateCarrierSecretAction).not.toHaveBeenCalled();
});
