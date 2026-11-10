import { describe, expect, it, vi } from "vitest";
import type { Principal } from "@platform/contracts";
import type { MediaLibraryController } from "@platform/media";
import type { OnlineStoreController } from "@platform/online-store";
import type { AdminGuard } from "./admin-guard";
import { MediaLibraryAdminController } from "./media-library.admin-controller";
import { OnlineStoreAdminController } from "./online-store.admin-controller";

const principal: Principal = { id: "staff-1", kind: "staff", roles: ["viewer"], tenantId: "t-1" };
const delegated = { status: 200, body: { delegated: true } };
const denied = { status: 403, body: { code: "FORBIDDEN" } };

const METHODS = [
  ["getPreferences", "online_store:read"],
  ["updatePreferences", "online_store:update_preferences"],
  ["getAccess", "online_store:read"],
  ["updateAccess", "online_store_admin:update_access"],
  ["getTheme", "online_store:read"],
  ["saveThemeDraft", "online_store:edit_theme"],
  ["discardThemeDraft", "online_store:edit_theme"],
  ["publishTheme", "online_store_admin:publish_theme"],
  ["listThemeReleases", "online_store:read"],
  ["restoreThemeRelease", "online_store_admin:publish_theme"],
  ["issuePreviewToken", "online_store:read"],
  ["listMenus", "online_store:read"],
  ["getMenu", "online_store:read"],
  ["searchLinkTargets", "online_store:read"],
  ["listPolicies", "online_store:read"],
  ["getPolicy", "online_store:read"],
  ["createMenu", "online_store:manage_menus"],
  ["updateMenu", "online_store:manage_menus"],
  ["deleteMenu", "online_store:manage_menus"],
  ["updatePolicy", "online_store:manage_policies"],
  ["generatePolicyTemplate", "online_store:manage_policies"],
] as const;

function harness(answer: typeof denied | null) {
  const ensure = vi.fn(async () => answer);
  const target = vi.fn(async () => delegated);
  const inner = Object.fromEntries(METHODS.map(([method]) => [method, target]));
  const controller = new OnlineStoreAdminController({
    onlineStore: inner as unknown as OnlineStoreController,
    guard: { ensure } as unknown as AdminGuard,
  });
  return { controller, ensure, target };
}

describe("OnlineStoreAdminController", () => {
  it.each(METHODS)("%s asks for %s, then delegates the input", async (method, permission) => {
    const { controller, ensure, target } = harness(null);
    const input = { tenantId: "t-1" } as never;
    expect(await controller[method](principal, input)).toEqual(delegated);
    expect(ensure).toHaveBeenCalledWith(principal, permission);
    expect(target).toHaveBeenCalledWith(input);
  });

  it.each(METHODS)("%s stops at a refusal and touches nothing", async (method) => {
    const { controller, target } = harness(denied);
    expect(await controller[method](principal, { tenantId: "t-1" } as never)).toEqual(denied);
    expect(target).not.toHaveBeenCalled();
  });
});

describe("MediaLibraryAdminController.uploadImage", () => {
  function media(answer: typeof denied | null) {
    const ensure = vi.fn(async () => answer);
    const uploadImage = vi.fn(async () => delegated);
    const controller = new MediaLibraryAdminController({
      mediaLibrary: { uploadImage } as unknown as MediaLibraryController,
      guard: { ensure } as unknown as AdminGuard,
    });
    return { controller, ensure, uploadImage };
  }
  const input = { bytes: new Uint8Array(), purpose: "logo", tenantId: "t-1" } as const;

  it("asks for online_store:upload_image, then delegates", async () => {
    const { controller, ensure, uploadImage } = media(null);
    expect(await controller.uploadImage(principal, input)).toEqual(delegated);
    expect(ensure).toHaveBeenCalledWith(principal, "online_store:upload_image");
    expect(uploadImage).toHaveBeenCalledWith(input);
  });

  it("stops at a refusal", async () => {
    const { controller, uploadImage } = media(denied);
    expect(await controller.uploadImage(principal, input)).toEqual(denied);
    expect(uploadImage).not.toHaveBeenCalled();
  });
});
