import type { TopicSpec } from "./topic-inventory";

/**
 * The slice of the kafkajs `Admin` client the provisioner uses — structural, so a kafkajs `Admin`
 * satisfies it and a test can hand in a fake without a broker. The arrays are mutable on purpose:
 * kafkajs declares `createTopics` as a function-typed property (checked strictly, not bivariantly)
 * taking `ITopicConfig[]`, which a `readonly` array cannot be passed as.
 */
export interface TopicAdmin {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTopics(): Promise<string[]>;
  createTopics(options: {
    topics: {
      topic: string;
      numPartitions: number;
      replicationFactor: number;
      configEntries: { name: string; value: string }[];
    }[];
    waitForLeaders?: boolean;
  }): Promise<boolean>;
}

export interface ProvisionOptions {
  /** Partitions for a `full` topic (a consumed topic and its `.retry`); a `single` one gets 1. */
  readonly partitions: number;
  readonly replicationFactor: number;
}

export interface ProvisionReport {
  readonly created: readonly string[];
  readonly existing: readonly string[];
  readonly failed: readonly { readonly topic: string; readonly error: string }[];
}

function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const type = (error as { type?: unknown }).type;
  return type === "TOPIC_ALREADY_EXISTS";
}

/**
 * What to log for a failed creation. kafkajs rejects a topic with a `KafkaJSAggregateError` whose own
 * message is only "Topic creation errors"; the cause (`type`, `message`) is in `.errors[]`, so the
 * message alone would hide why the deploy was blocked.
 */
function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const causes = (error as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(causes) || causes.length === 0) return message;
  const detail = causes.map((cause: { type?: unknown; message?: unknown }) =>
    [cause.type, cause.message].filter((part) => typeof part === "string").join(": "),
  );
  return `${message} (${detail.join("; ")})`;
}

/**
 * Creates every topic in `specs` that does not exist yet. Idempotent: an existing topic is left
 * untouched — its partitions and retention are NOT changed, so re-running cannot silently rewrite a
 * live topic's configuration. Topics are created ONE AT A TIME so a failure is attributed to the
 * topic that failed, not to a batch.
 *
 * Never reports a real failure as success. `bootstrap-topics.sh` records why that matters: a
 * creation failure mistaken for "already exists" once left critical topics silently missing. Only
 * kafkajs's `false` (the topic already existed — e.g. created by a concurrent run) or an explicit
 * `TOPIC_ALREADY_EXISTS` counts as existing; every other error lands in `failed`.
 */
export async function provisionTopics(
  admin: TopicAdmin,
  specs: readonly TopicSpec[],
  options: ProvisionOptions,
): Promise<ProvisionReport> {
  const created: string[] = [];
  const existing: string[] = [];
  const failed: { topic: string; error: string }[] = [];

  await admin.connect();
  try {
    const present = new Set(await admin.listTopics());
    for (const spec of specs) {
      if (present.has(spec.name)) {
        existing.push(spec.name);
        continue;
      }
      try {
        const made = await admin.createTopics({
          topics: [
            {
              topic: spec.name,
              numPartitions: spec.partitioning === "full" ? options.partitions : 1,
              replicationFactor: options.replicationFactor,
              configEntries: [{ name: "retention.ms", value: String(spec.retentionMs) }],
            },
          ],
          waitForLeaders: true,
        });
        (made ? created : existing).push(spec.name);
      } catch (error) {
        if (isAlreadyExists(error)) {
          existing.push(spec.name);
        } else {
          failed.push({ topic: spec.name, error: describeFailure(error) });
        }
      }
    }
  } finally {
    await admin.disconnect();
  }
  return { created, existing, failed };
}
