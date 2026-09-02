/**
 * Metrics seam for the messaging runtime (Step 9). A plain port so the runtime is measurable
 * without dragging an SDK into every consumer: the OTel adapter arrives with the
 * instrumentation sprint (G-19) and feeds the collector → Prometheus (doc 26 §1), yielding
 * processed/sec, failed/sec, retry/sec, dlq/sec and duration histograms. `noopMetrics` is the
 * safe default — never optional-chaining in the hot path.
 */
export interface MessagingMetrics {
  processed(topic: string, consumerGroup: string, durationMs: number): void;
  failed(topic: string, consumerGroup: string): void;
  retried(topic: string, consumerGroup: string, attempt: number): void;
  deadLettered(topic: string, consumerGroup: string): void;
  duplicate(topic: string, consumerGroup: string): void;
}

export const noopMetrics: MessagingMetrics = {
  processed: () => undefined,
  failed: () => undefined,
  retried: () => undefined,
  deadLettered: () => undefined,
  duplicate: () => undefined,
};
