import { AppError } from "@platform/utils";
import type { InjectionToken } from "./token";

export class DependencyResolutionError extends AppError {
  constructor(description: string) {
    super(`No provider registered for dependency: ${description}`, { code: "DI_UNRESOLVED" });
  }
}

export type Factory<T> = (container: Container) => T;

export interface FactoryOptions {
  /** When true (default), the factory runs once and the instance is memoized. */
  readonly singleton?: boolean;
}

export interface Container {
  registerValue<T>(token: InjectionToken<T>, value: T): this;
  registerFactory<T>(token: InjectionToken<T>, factory: Factory<T>, options?: FactoryOptions): this;
  resolve<T>(token: InjectionToken<T>): T;
  has(token: InjectionToken<unknown>): boolean;
  createScope(): Container;
}

interface ValueRegistration {
  readonly kind: "value";
  readonly value: unknown;
}

interface FactoryRegistration {
  readonly kind: "factory";
  readonly factory: Factory<unknown>;
  readonly singleton: boolean;
  instance?: { readonly value: unknown };
}

type Registration = ValueRegistration | FactoryRegistration;

class ContainerImpl implements Container {
  private readonly registrations = new Map<symbol, Registration>();
  private readonly parent?: Container;

  constructor(parent?: Container) {
    this.parent = parent;
  }

  registerValue<T>(token: InjectionToken<T>, value: T): this {
    this.registrations.set(token.key, { kind: "value", value });
    return this;
  }

  registerFactory<T>(
    token: InjectionToken<T>,
    factory: Factory<T>,
    options: FactoryOptions = {},
  ): this {
    this.registrations.set(token.key, {
      kind: "factory",
      factory: factory,
      singleton: options.singleton ?? true,
    });
    return this;
  }

  has(token: InjectionToken<unknown>): boolean {
    return this.registrations.has(token.key) || (this.parent?.has(token) ?? false);
  }

  resolve<T>(token: InjectionToken<T>): T {
    const registration = this.registrations.get(token.key);
    if (registration === undefined) {
      if (this.parent !== undefined) {
        return this.parent.resolve(token);
      }
      throw new DependencyResolutionError(token.description);
    }
    if (registration.kind === "value") {
      return registration.value as T;
    }
    if (registration.singleton) {
      registration.instance ??= { value: registration.factory(this) };
      return registration.instance.value as T;
    }
    return registration.factory(this) as T;
  }

  createScope(): Container {
    return new ContainerImpl(this);
  }
}

/** Creates a new, empty dependency-injection container. */
export function createContainer(): Container {
  return new ContainerImpl();
}
