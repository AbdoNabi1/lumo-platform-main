import { describe, expect, it, vi } from "vitest";
import { hashPreviewToken } from "../domain/preview-token";
import type { InMemoryPreviewTokenRepository } from "../infrastructure/in-memory-repositories";
import { harness } from "../testing/fakes";

describe("preview tokens", () => {
  it("issues a 60-minute token, stores only its hash, and builds the primary-host url", async () => {
    const { controller, repos } = harness({ hosts: { "t-1": "shop.example.eg" } });
    const res = await controller.issuePreviewToken({ tenantId: "t-1", createdBy: "staff-1" });
    expect(res.status).toBe(201);
    const body = res.body as { token: string; expiresAt: string; url: string };
    expect(body.expiresAt).toBe("2026-10-27T11:00:00.000Z");
    expect(body.url).toBe(`https://shop.example.eg/?preview=${body.token}`);
    const stored = (repos.previewTokens as InMemoryPreviewTokenRepository).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toBe(hashPreviewToken(body.token));
    expect(JSON.stringify(stored)).not.toContain(body.token);
  });

  it("url is null without a verified primary hostname", async () => {
    const { controller } = harness();
    const res = await controller.issuePreviewToken({ tenantId: "t-1", createdBy: "s" });
    expect((res.body as { url: unknown }).url).toBeNull();
  });

  it("a token resolves in its own shop only, until it expires; issuing deletes expired rows", async () => {
    const { controller, repos, advance } = harness();
    const token = (
      (await controller.issuePreviewToken({ tenantId: "t-1", createdBy: "s" })).body as {
        token: string;
      }
    ).token;
    expect((await controller.shell({ tenantId: "t-1", previewToken: token })).status).toBe(200);
    expect((await controller.shell({ tenantId: "t-2", previewToken: token })).status).toBe(401);
    advance(60 * 60 * 1000);
    const expired = await controller.shell({ tenantId: "t-1", previewToken: token });
    expect(expired).toEqual({
      status: 401,
      body: {
        code: "PREVIEW_INVALID",
        message: "Preview link is invalid or expired",
        retryable: false,
        fields: [],
      },
    });
    await controller.issuePreviewToken({ tenantId: "t-1", createdBy: "s" });
    expect((repos.previewTokens as InMemoryPreviewTokenRepository).all()).toHaveLength(1);
  });

  it("a malformed token is refused without a lookup", async () => {
    const { controller, repos } = harness();
    const lookup = vi.spyOn(repos.previewTokens, "findActive");
    expect(
      (await controller.shell({ tenantId: "t-1", previewToken: "x".repeat(101) })).status,
    ).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("a failing host lookup still returns the token, with a null url", async () => {
    const { controller } = harness({ hostLookupFails: true });
    const res = await controller.issuePreviewToken({ tenantId: "t-1", createdBy: "s" });
    expect(res.status).toBe(201);
    expect((res.body as { url: unknown }).url).toBeNull();
  });

  it("every token is new and is 256 bits in base64url", async () => {
    const { controller } = harness();
    const issue = async () =>
      (
        (await controller.issuePreviewToken({ tenantId: "t-1", createdBy: "s" })).body as {
          token: string;
        }
      ).token;
    const [a, b] = [await issue(), await issue()];
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
