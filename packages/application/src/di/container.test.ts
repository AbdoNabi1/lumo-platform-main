import { describe, expect, it } from "vitest";
import { createToken } from "./token";
import { DependencyResolutionError, createContainer } from "./container";

interface Greeter {
  greet(): string;
}

describe("DI container", () => {
  it("resolves registered values with the token's type", () => {
    const token = createToken<Greeter>("Greeter");
    const container = createContainer();
    container.registerValue(token, { greet: () => "hi" });
    expect(container.resolve(token).greet()).toBe("hi");
  });

  it("memoizes singleton factories and re-runs transient factories", () => {
    let calls = 0;
    const container = createContainer();

    const singleton = createToken<{ id: number }>("Singleton");
    container.registerFactory(singleton, () => ({ id: (calls += 1) }), { singleton: true });
    expect(container.resolve(singleton)).toBe(container.resolve(singleton));

    const transient = createToken<{ id: number }>("Transient");
    container.registerFactory(transient, () => ({ id: (calls += 1) }), { singleton: false });
    expect(container.resolve(transient)).not.toBe(container.resolve(transient));
  });

  it("throws DependencyResolutionError for unregistered tokens", () => {
    const token = createToken<string>("Missing");
    expect(() => createContainer().resolve(token)).toThrowError(DependencyResolutionError);
  });

  it("resolves from the parent container within a scope", () => {
    const token = createToken<string>("Shared");
    const parent = createContainer();
    parent.registerValue(token, "value");
    const scope = parent.createScope();
    expect(scope.resolve(token)).toBe("value");
    expect(scope.has(token)).toBe(true);
  });
});
