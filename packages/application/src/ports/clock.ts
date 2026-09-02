import type { Clock } from "@platform/contracts";
import { createToken, type InjectionToken } from "../di";

export type { Clock };

/**
 * DI token for the {@link Clock} outbound port. The interface lives in `@platform/contracts`
 * (so infrastructure adapters depend only on contracts); the application owns the token and wires
 * the adapter (`@platform/clock`'s `SystemClock`) to it at the composition root. The domain
 * never reads the clock — time is supplied through this port.
 */
export const CLOCK: InjectionToken<Clock> = createToken<Clock>("Clock");
