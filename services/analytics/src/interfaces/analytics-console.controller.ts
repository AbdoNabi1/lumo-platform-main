import { err, ok } from "@platform/types";
import { NotFoundError } from "@platform/utils";
import type { Metric } from "../domain/semantic-model";
import type { DimensionDefinition } from "../domain/dimension-definition";
import type { SemanticRegistry } from "../registry/semantic-registry";
import { type ControllerResponse, present } from "./presenter";

export interface AnalyticsConsoleControllerDeps {
  readonly registry: SemanticRegistry;
}

export interface GetMetricRequest {
  readonly id: string;
}

export interface GetDimensionRequest {
  readonly id: string;
}

/**
 * Framework-agnostic interface boundary for Analytics' semantic-layer catalog (Phase 9 hardening —
 * this context previously had zero `interfaces/` layer and zero HTTP exposure despite the governed
 * metric/dimension catalog being fully built since Sprint 3.2/D-064). Exposes the CATALOG only
 * (definitions: what metrics/dimensions exist, their formulas/units/dependencies) — not query
 * execution. Running a real {@link SemanticEngine} query needs a populated `AnalyticsReadStore`
 * (ClickHouse in production); no CDC/projection pipeline feeds one yet in this environment (the
 * gap tracked alongside "Data Platform/CDC half of P5"), so wiring a query-execution endpoint here
 * would either require a new engine (out of scope, the brief forbids it) or would silently return
 * empty results against an unpopulated store — a placeholder dressed as a working endpoint. The
 * catalog itself carries no such risk: it is governed, static, always-correct data.
 */
export class AnalyticsConsoleController {
  private readonly registry: SemanticRegistry;

  constructor(deps: AnalyticsConsoleControllerDeps) {
    this.registry = deps.registry;
  }

  async listMetrics(): Promise<ControllerResponse> {
    return present<readonly Metric[]>(ok(this.registry.metrics.list()), 200);
  }

  async getMetric(request: GetMetricRequest): Promise<ControllerResponse> {
    const metric = this.registry.metrics.get(request.id);
    if (metric === undefined) {
      return present(err(new NotFoundError(`Metric "${request.id}" not found`)), 200);
    }
    return present(ok(metric), 200);
  }

  async listDimensions(): Promise<ControllerResponse> {
    return present<readonly DimensionDefinition[]>(ok(this.registry.dimensions.list()), 200);
  }

  async getDimension(request: GetDimensionRequest): Promise<ControllerResponse> {
    const dimension = this.registry.dimensions.get(request.id);
    if (dimension === undefined) {
      return present(err(new NotFoundError(`Dimension "${request.id}" not found`)), 200);
    }
    return present(ok(dimension), 200);
  }
}
