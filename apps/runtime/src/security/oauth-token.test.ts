import { describe, expect, it } from "vitest";
import {
  JsonHttpClient,
  type HttpFetch,
  type HttpRequestInit,
  type HttpResponse,
} from "./http-transport";
import { ClientCredentialsTokenProvider, StaticBearerTokenProvider } from "./oauth-token";

function tokenHttp(): { http: JsonHttpClient; calls: { url: string; body: string | undefined }[] } {
  const calls: { url: string; body: string | undefined }[] = [];
  const fetchFn: HttpFetch = async (url, init?: HttpRequestInit) => {
    calls.push({ url, body: init?.body });
    const body = { access_token: `tok-${calls.length}`, expires_in: 3600 };
    const response: HttpResponse = {
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
    return response;
  };
  return { http: new JsonHttpClient({ fetch: fetchFn }), calls };
}

describe("ClientCredentialsTokenProvider", () => {
  it("performs the client_credentials grant and caches the token until it nears expiry", async () => {
    let clock = 0;
    const { http, calls } = tokenHttp();
    const provider = new ClientCredentialsTokenProvider({
      http,
      tokenUrl: "https://login.test/token",
      clientId: "id",
      clientSecret: "secret",
      scope: "https://vault.azure.net/.default",
      now: () => clock,
    });

    expect(await provider.getToken()).toBe("tok-1");
    expect(await provider.getToken()).toBe("tok-1"); // cached
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toContain("grant_type=client_credentials");
    expect(calls[0]?.body).toContain("client_id=id");

    clock = 3_600_000; // past the (expires_in - 30s) window → refetch
    expect(await provider.getToken()).toBe("tok-2");
    expect(calls).toHaveLength(2);
  });
});

describe("StaticBearerTokenProvider", () => {
  it("returns the provisioned token", async () => {
    expect(await new StaticBearerTokenProvider("workload-token").getToken()).toBe("workload-token");
  });
});
