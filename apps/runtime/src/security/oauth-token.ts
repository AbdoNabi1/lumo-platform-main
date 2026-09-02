import type { JsonHttpClient } from "./http-transport";
import type { BearerTokenProvider } from "./kms-cloud";

/**
 * OAuth2 **bearer-token providers** for the cloud crypto/threat adapters (H-3 / G-SEC-2). Real, SDK-free:
 * {@link ClientCredentialsTokenProvider} performs the standard `client_credentials` grant over the shared
 * HTTP transport and caches the token until shortly before it expires (one token flow reused by Azure Key
 * Vault, CrowdStrike, and Microsoft Defender); {@link StaticBearerTokenProvider} wraps a token already
 * provisioned by the platform (e.g. GCP workload identity). Client secrets are sent only to the token
 * endpoint and never logged.
 */

interface TokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
}

export interface ClientCredentialsOptions {
  readonly http: JsonHttpClient;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scope?: string;
  /** Injected clock in ms (tests); defaults to `Date.now`. */
  readonly now?: () => number;
}

export class ClientCredentialsTokenProvider implements BearerTokenProvider {
  private cached: { readonly token: string; readonly expiresAt: number } | undefined;
  private readonly http: JsonHttpClient;
  private readonly tokenUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly scope: string | undefined;
  private readonly now: () => number;

  constructor(options: ClientCredentialsOptions) {
    this.http = options.http;
    this.tokenUrl = options.tokenUrl;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.scope = options.scope;
    this.now = options.now ?? Date.now;
  }

  async getToken(): Promise<string> {
    if (this.cached !== undefined && this.now() < this.cached.expiresAt) return this.cached.token;
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      ...(this.scope !== undefined ? { scope: this.scope } : {}),
    }).toString();
    const res = (await this.http.send(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form,
    })) as TokenResponse;
    if (res.access_token === undefined)
      throw new Error("oauth token endpoint returned no access_token");
    // Refresh 30s early; default to a conservative 5-minute lifetime when the server omits expires_in.
    const ttlMs = ((res.expires_in ?? 300) - 30) * 1_000;
    this.cached = { token: res.access_token, expiresAt: this.now() + Math.max(0, ttlMs) };
    return res.access_token;
  }
}

/** A bearer token already supplied by the platform (workload identity / metadata server / injection). */
export class StaticBearerTokenProvider implements BearerTokenProvider {
  constructor(private readonly token: string) {}
  getToken(): Promise<string> {
    return Promise.resolve(this.token);
  }
}
