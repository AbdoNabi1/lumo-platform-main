import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { Asset } from "./asset";
import { ContentType } from "./value-objects/content-type";
import { StorageKey } from "./value-objects/storage-key";

describe("Asset", () => {
  it("registers and emits media.asset_ready", () => {
    const storageKey = StorageKey.create("uploads/a.png");
    const contentType = ContentType.create("image/png");
    if (!storageKey.ok || !contentType.ok) throw new Error("invalid fixture");

    const asset = Asset.register(
      UniqueEntityId.from("asset-1"),
      storageKey.value,
      contentType.value,
      "evt-1",
      new Date("2026-06-30T00:00:00.000Z"),
    );

    const events = asset.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("media.asset_ready");
    expect(asset.contentType.value).toBe("image/png");
  });
});
