/**
 * Outbound port for reading the current time. Implemented by infrastructure
 * (`@platform/clock`'s `SystemClock`) and wired into the application via DI (the `CLOCK`
 * token lives in `@platform/application`).
 *
 * Keeping time behind a port mirrors {@link IdGenerator}: the domain stays deterministic
 * (it never reads the clock), and time can be fixed/faked for deterministic tests.
 */
export interface Clock {
  /** Returns the current instant as a `Date`. */
  now(): Date;
}
