import { describe, expect, it } from "vitest";
import { EnvSecretProvider } from "./env-provider";
import { ChainedSecretProvider } from "./chained-provider";

describe("EnvSecretProvider", () => {
  it("reads a plain environment variable", () => {
    const provider = new EnvSecretProvider({ TOKEN: "abc" });
    expect(provider.get("TOKEN")).toBe("abc");
  });

  it("treats empty strings as missing", () => {
    const provider = new EnvSecretProvider({ TOKEN: "" });
    expect(provider.get("TOKEN")).toBeUndefined();
  });

  it("throws on require when missing", () => {
    const provider = new EnvSecretProvider({});
    expect(() => provider.require("TOKEN")).toThrowError(/Missing required secret: TOKEN/);
  });
});

describe("ChainedSecretProvider", () => {
  it("returns the first non-empty value", () => {
    const chained = new ChainedSecretProvider([
      new EnvSecretProvider({ TOKEN: "" }),
      new EnvSecretProvider({ TOKEN: "second" }),
    ]);
    expect(chained.get("TOKEN")).toBe("second");
  });

  it("returns undefined when no provider has the key", () => {
    const chained = new ChainedSecretProvider([new EnvSecretProvider({})]);
    expect(chained.get("TOKEN")).toBeUndefined();
  });
});
