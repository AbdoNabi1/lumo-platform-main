import { withTimeout } from "./resilience";

/**
 * A minimal HTTP transport shared by the Security context's REST-based provider adapters (Vault, GCP KMS,
 * Azure Key Vault, the YubiHSM connector, and every threat-intel feed) — one JSON request/response
 * implementation with timeout protection and typed errors, so no adapter re-implements fetch/timeout/error
 * plumbing (H-3, no-duplication rule). It is transport only: it holds no provider semantics, no auth
 * scheme (callers pass headers), and never logs bodies (secrets/keys must not leak).
 */

export interface HttpRequestInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** The injected transport (the global `fetch` satisfies it; tests pass a double). */
export type HttpFetch = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

/** A non-2xx HTTP response. Carries status + (truncated) body for diagnostics — never a secret value. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly bodyExcerpt: string,
  ) {
    super(`http ${status} for ${url}: ${bodyExcerpt.slice(0, 200)}`);
    this.name = "HttpError";
  }
}

export interface JsonHttpClientOptions {
  readonly fetch: HttpFetch;
  /** Per-request timeout in ms (default 5000). */
  readonly timeoutMs?: number;
}

/** JSON-over-HTTP client with timeout + typed non-2xx errors. */
export class JsonHttpClient {
  private readonly fetch: HttpFetch;
  private readonly timeoutMs: number;

  constructor(options: JsonHttpClientOptions) {
    this.fetch = options.fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    return this.send(url, { method: "GET", headers });
  }

  async postJson(
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    return this.send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body ?? {}),
    });
  }

  /** Sends a request and returns the parsed JSON body, throwing {@link HttpError} on any non-2xx status. */
  async send(url: string, init: HttpRequestInit): Promise<unknown> {
    const response = await withTimeout(
      () => this.fetch(url, init),
      this.timeoutMs,
      `${init.method ?? "GET"} ${url}`,
    );
    if (response.status < 200 || response.status >= 300) {
      const bodyExcerpt = await response.text().catch(() => "");
      throw new HttpError(response.status, url, bodyExcerpt);
    }
    const text = await response.text();
    if (text.length === 0) return {};
    return JSON.parse(text) as unknown;
  }
}
