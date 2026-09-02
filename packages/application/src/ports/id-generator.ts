import type { IdGenerator } from "@platform/contracts";
import { createToken, type InjectionToken } from "../di";

export type { IdGenerator };

/**
 * DI token for the {@link IdGenerator} outbound port. The interface lives in
 * `@platform/contracts` (so infrastructure adapters depend only on contracts); the application
 * owns the token and wires the adapter (`@platform/id`'s `CryptoIdGenerator`) to it at the
 * composition root. The domain never depends on this.
 */
export const ID_GENERATOR: InjectionToken<IdGenerator> = createToken<IdGenerator>("IdGenerator");
