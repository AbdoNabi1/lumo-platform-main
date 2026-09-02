import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Folder } from "./folder";
import { MediaAsset } from "./media-asset";

describe("Folder", () => {
  it("creates and archives", () => {
    const folder = Folder.create(
      UniqueEntityId.from("folder-1"),
      "Product images",
      "evt-1",
      new Date(0),
    );
    expect(folder.status.value).toBe("active");
    folder.archive("evt-2", new Date(0));
    expect(folder.status.value).toBe("archived");
  });

  it("rejects archiving twice", () => {
    const folder = Folder.create(
      UniqueEntityId.from("folder-1"),
      "Product images",
      "evt-1",
      new Date(0),
    );
    folder.archive("evt-2", new Date(0));
    expect(() => folder.archive("evt-3", new Date(0))).toThrow(BusinessRuleError);
  });
});

describe("MediaAsset", () => {
  it("creates and archives", () => {
    const asset = MediaAsset.create(
      UniqueEntityId.from("asset-1"),
      "hero.png",
      "media/hero.png",
      "evt-1",
      new Date(0),
    );
    expect(asset.status.value).toBe("active");
    asset.archive("evt-2", new Date(0));
    expect(asset.status.value).toBe("archived");
  });
});
