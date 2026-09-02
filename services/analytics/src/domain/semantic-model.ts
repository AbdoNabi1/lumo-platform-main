import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";
import type { Aggregation, MetricUnit } from "./value-objects/aggregation";
import type { CanonicalId } from "./value-objects/canonical-id";
import { defineMetricExpression, type MetricExpression } from "./value-objects/metric-expression";
import type { SemanticBinding } from "./semantic-binding";

interface MeasureProps {
  readonly id: CanonicalId;
  readonly aggregation: Aggregation;
  readonly binding: SemanticBinding;
}

/** A single numeric read from one read model's field, pre-aggregation — `AggregationEngine`'s input. */
export class Measure extends ValueObject<MeasureProps> {
  static define(
    id: CanonicalId,
    aggregation: Aggregation,
    binding: SemanticBinding,
  ): Result<Measure, ValidationError> {
    return ok(new Measure({ id, aggregation, binding }));
  }

  get id(): CanonicalId {
    return this.props.id;
  }

  get aggregation(): Aggregation {
    return this.props.aggregation;
  }

  get binding(): SemanticBinding {
    return this.props.binding;
  }
}

interface MetricDefinitionProps {
  readonly id: CanonicalId;
  readonly unit: MetricUnit;
  readonly description: string;
  readonly measure: Measure;
}

/** A base metric — one {@link Measure}'s aggregated value, named and typed for query/display. */
export class MetricDefinition extends ValueObject<MetricDefinitionProps> {
  static define(
    id: CanonicalId,
    unit: MetricUnit,
    description: string,
    measure: Measure,
  ): Result<MetricDefinition, ValidationError> {
    if (description.trim().length === 0) {
      return err(
        new ValidationError("Invalid metric definition", [
          { field: "description", message: "must not be empty" },
        ]),
      );
    }
    return ok(new MetricDefinition({ id, unit, description, measure }));
  }

  get id(): CanonicalId {
    return this.props.id;
  }

  get unit(): MetricUnit {
    return this.props.unit;
  }

  get description(): string {
    return this.props.description;
  }

  get measure(): Measure {
    return this.props.measure;
  }
}

interface CalculatedMetricProps {
  readonly id: CanonicalId;
  readonly unit: MetricUnit;
  readonly description: string;
  readonly expression: MetricExpression;
}

/** A metric derived from other metrics via a {@link MetricExpression} — never a raw read. */
export class CalculatedMetric extends ValueObject<CalculatedMetricProps> {
  static define(
    id: CanonicalId,
    unit: MetricUnit,
    description: string,
    expression: MetricExpression,
  ): Result<CalculatedMetric, ValidationError> {
    if (description.trim().length === 0) {
      return err(
        new ValidationError("Invalid calculated metric", [
          { field: "description", message: "must not be empty" },
        ]),
      );
    }
    const validExpression = defineMetricExpression(expression);
    if (!validExpression.ok) return validExpression;
    return ok(new CalculatedMetric({ id, unit, description, expression }));
  }

  get id(): CanonicalId {
    return this.props.id;
  }

  get unit(): MetricUnit {
    return this.props.unit;
  }

  get description(): string {
    return this.props.description;
  }

  get expression(): MetricExpression {
    return this.props.expression;
  }
}

/** Every metric kind the semantic layer can resolve and evaluate. */
export type Metric = MetricDefinition | CalculatedMetric;

export function isCalculatedMetric(metric: Metric): metric is CalculatedMetric {
  return metric instanceof CalculatedMetric;
}

export function isMetricDefinition(metric: Metric): metric is MetricDefinition {
  return metric instanceof MetricDefinition;
}
