/**
 * The transport-neutral response returned across the admin boundary — structurally identical to
 * each context's `ControllerResponse`. Presentation (the `Result` → status + error-envelope mapping)
 * is **delegated to the owning context's presenter**, the single source of truth; the admin layer
 * never re-maps status codes or reshapes bodies.
 */
export interface AdminResponse {
  readonly status: number;
  readonly body: unknown;
}
