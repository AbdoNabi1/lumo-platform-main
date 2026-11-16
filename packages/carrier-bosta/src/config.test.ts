import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BOSTA_CONFIG, parseBostaConfig } from "./config";

beforeEach(() => {
  expect.hasAssertions();
});

describe("Bosta configuration", () => {
  it.each([undefined, {}])("defaults absent configuration", (raw) => {
    expect(parseBostaConfig(raw)).toEqual({ ok: true, value: DEFAULT_BOSTA_CONFIG });
  });
  it("accepts overrides and discards extra fields", () => {
    expect(parseBostaConfig({ awbFormat: "A4", extra: 1 })).toEqual({
      ok: true,
      value: { awbFormat: "A4", awbLanguage: "ar", allowToOpenPackage: false },
    });
    expect(parseBostaConfig({ awbLanguage: "en", allowToOpenPackage: true })).toEqual({
      ok: true,
      value: { awbFormat: "A6", awbLanguage: "en", allowToOpenPackage: true },
    });
  });
  it.each([
    [{ awbFormat: "Z" }, "awbFormat"],
    [{ awbLanguage: "fr" }, "awbLanguage"],
    [{ allowToOpenPackage: "yes" }, "allowToOpenPackage"],
    ["x", "config"],
    [[], "config"],
    [null, "config"],
  ])("rejects invalid configuration %j", (raw, reason) => {
    expect(parseBostaConfig(raw)).toEqual({ ok: false, reason });
  });
});
