import type { Clock } from "@platform/contracts";

/**
 * Reads the host system clock. Infrastructure adapter for the application `Clock` port — the
 * domain and application never import this (Dependency Inversion); it is wired into the DI
 * container at the composition root. Tests of other code inject a fixed clock instead.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
