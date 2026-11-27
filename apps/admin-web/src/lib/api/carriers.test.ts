import { beforeEach, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ getAdminApi: vi.fn(), mutateAdminApi: vi.fn() }));
vi.mock("./client", () => client);
import { updateCarrier, rotateCarrierWebhookSecret } from "./carriers";

beforeEach(() => {
  expect.hasAssertions();
  vi.clearAllMocks();
});

it("allows 20 seconds for credential verification", async () => {
  client.mutateAdminApi.mockResolvedValue({ outcome: "ok", data: {} });
  await updateCarrier("bosta", { enabled: true }, "key");
  expect(client.mutateAdminApi).toHaveBeenCalledWith(
    "/api/v1/shipping/carriers/bosta",
    expect.objectContaining({ method: "PUT", timeoutMs: 20_000, idempotencyKey: "key" }),
    expect.any(Function),
  );
});

it("allows 20 seconds for rotating a secret", async () => {
  client.mutateAdminApi.mockResolvedValue({ outcome: "ok", data: {} });
  await rotateCarrierWebhookSecret("bosta", "key");
  expect(client.mutateAdminApi).toHaveBeenCalledWith(
    "/api/v1/shipping/carriers/bosta/webhook-secret",
    expect.objectContaining({ method: "POST", timeoutMs: 20_000, idempotencyKey: "key" }),
    expect.any(Function),
  );
});
