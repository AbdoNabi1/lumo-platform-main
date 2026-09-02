/**
 * A typed injection token. The phantom `__type` carrier makes tokens for different `T`
 * structurally distinct, so `resolve(token)` is correctly typed at the call site.
 */
export interface InjectionToken<T> {
  readonly key: symbol;
  readonly description: string;
  /** Phantom type carrier; never present at runtime. */
  readonly __type?: T;
}

export function createToken<T>(description: string): InjectionToken<T> {
  return { key: Symbol(description), description };
}
