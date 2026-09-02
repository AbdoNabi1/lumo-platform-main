import { PlatformKpisProjection } from "./read-model/projection";
import { PlatformConsoleController } from "./interfaces/platform-console.controller";

export interface WiredPlatformConsole {
  readonly platformConsole: PlatformConsoleController;
  /** Test/composition-only seam — feeds a recorded integration event into the projection. */
  readonly ingest: (eventType: string, payload: Record<string, unknown>) => void;
}

/**
 * Composition root for the Platform Console context — a read-model only, no outbox of its own
 * (owns no aggregates/events; nothing to drain). A later runtime milestone wires `ingest` onto the
 * live event bus for Tenancy/Licensing/Usage/System events.
 */
export function wirePlatformConsole(): WiredPlatformConsole {
  const projection = new PlatformKpisProjection();
  const controller = new PlatformConsoleController(projection);

  return {
    platformConsole: controller,
    ingest: (eventType, payload) => projection.apply(eventType, payload),
  };
}
