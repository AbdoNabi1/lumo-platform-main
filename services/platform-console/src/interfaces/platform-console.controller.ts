import type { PlatformKpisProjection } from "../read-model/projection";

export interface ControllerResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Framework-agnostic interface boundary for Platform Console (Sprint-5.6 addendum §J) — exposed to
 * platform staff via `POST /platform/kpis` (the report's own literal text; a read/query operation
 * kept as `POST` here to match what was actually built, not "corrected" to a more idiomatic verb).
 */
export class PlatformConsoleController {
  private readonly projection: PlatformKpisProjection;

  constructor(projection: PlatformKpisProjection) {
    this.projection = projection;
  }

  async getKpis(): Promise<ControllerResponse> {
    return { status: 200, body: this.projection.current() };
  }
}
