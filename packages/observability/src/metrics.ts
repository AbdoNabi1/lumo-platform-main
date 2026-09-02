import { metrics, type Counter, type Histogram, type Meter } from "@opentelemetry/api";

export function getMeter(name: string, version?: string): Meter {
  return metrics.getMeter(name, version);
}

export function createCounter(meter: Meter, name: string, description?: string): Counter {
  return meter.createCounter(name, { description });
}

export function createHistogram(meter: Meter, name: string, description?: string): Histogram {
  return meter.createHistogram(name, { description });
}
