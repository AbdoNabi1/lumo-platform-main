import { describe, expect, it } from "vitest";
import { bestTextOn, mixHex, normalizeHex } from "./color";

describe("normalizeHex", () => {
  it.each([
    ["#AABBCC", "#aabbcc"],
    ["#0f172a", "#0f172a"],
  ])("accepts %s as %s", (input, expected) => {
    expect(normalizeHex(input)).toBe(expected);
  });

  it.each([
    "red",
    "#fff",
    "#ffffff80",
    "rgb(0,0,0)",
    "#000000;}</style><script>",
    "＃ffffff",
    "",
    " #ffffff",
    null,
    42,
  ])("refuses %j", (input) => {
    expect(normalizeHex(input)).toBeNull();
  });
});

describe("mixHex / bestTextOn", () => {
  it("mixes channel by channel and rounds", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#123456", "#ffffff", 0)).toBe("#123456");
    expect(mixHex("#123456", "#ffffff", 1)).toBe("#ffffff");
  });

  it("picks the readable text colour", () => {
    expect(bestTextOn("#ffffff")).toBe("#000000");
    expect(bestTextOn("#000000")).toBe("#ffffff");
    expect(bestTextOn("#635bff")).toBe("#ffffff");
  });
});
