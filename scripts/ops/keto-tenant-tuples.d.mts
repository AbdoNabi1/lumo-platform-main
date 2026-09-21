// Types for keto-tenant-tuples.mjs, so the TypeScript test in packages/auth can import it.
export const NAMESPACE: string;
export interface KetoListedTuple {
  namespace: string;
  object: string;
  relation: string;
  subject_id?: string;
  subject_set?: { namespace: string; object: string; relation: string };
}
export interface KetoClient {
  list(namespace?: string): Promise<KetoListedTuple[]>;
  exists(tuple: KetoListedTuple): Promise<boolean>;
  put(body: Record<string, unknown>): Promise<void>;
  remove(tuple: KetoListedTuple): Promise<void>;
}
export type GateStatus = "match" | "contracted" | "empty" | "mismatch";
export interface Gate {
  tenantId: string;
  status: GateStatus;
  bare: { tuple: KetoListedTuple; permission: string; subject: string }[];
  qualified: { tuple: KetoListedTuple; permission: string; subject: string }[];
  otherTenants: number;
  missingTwin: { tuple: KetoListedTuple; permission: string; subject: string }[];
  orphanQualified: { tuple: KetoListedTuple; permission: string; subject: string }[];
  perPermission: { name: string; bare: number; qualified: number }[];
  perSubject: { name: string; bare: number; qualified: number }[];
}
export interface RunOptions {
  client: KetoClient;
  tenantId: string;
  apply: boolean;
  out: (line: string) => void;
  /** Injected so tests skip the pacing and retry waits; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}
export function qualify(tenantId: string, permission: string): string;
export function assertTenantId(tenantId: unknown): void;
export function parseObject(object: string): { tenantId: string | null; permission: string };
export function subjectOf(tuple: KetoListedTuple): string;
export function createKetoClient(options: {
  baseUrl: string;
  apiKey: string;
  fetch: (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => Promise<{ status: number; json(): Promise<unknown>; text?(): Promise<string> }>;
}): KetoClient;
export function computeGate(tuples: KetoListedTuple[], tenantId: string): Gate;
export function runCountGate(options: Omit<RunOptions, "apply">): Promise<number>;
export function runBackfill(options: RunOptions): Promise<number>;
export function runDeleteBare(options: RunOptions): Promise<number>;
export function parseArgs(argv: string[]): { tenantId: string; apply: boolean };
export function cliMain(
  run: (options: RunOptions) => Promise<number>,
  options?: {
    argv?: string[];
    env?: Record<string, string | undefined>;
    fetch?: unknown;
    out?: (line: string) => void;
  },
): Promise<number>;
