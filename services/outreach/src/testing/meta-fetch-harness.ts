export type FakeResponse = { status: number; json: unknown } | { throw: Error };

export function createMetaFetchHarness(responses: FakeResponse[]): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }>;
} {
  const queue = [...responses];
  const calls: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
  }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const headers = Object.fromEntries(new Headers(init?.headers ?? request?.headers).entries());
    const rawBody = init?.body;
    let body: unknown = rawBody;
    if (typeof rawBody === "string") {
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        body = rawBody;
      }
    }
    calls.push({
      url: request?.url ?? (input instanceof URL ? input.href : (input as string)),
      method: init?.method ?? request?.method ?? "GET",
      headers,
      body,
    });
    const response = queue.shift();
    if (response === undefined) throw new Error("harness exhausted");
    if ("throw" in response) throw response.throw;
    return await Promise.resolve(
      new Response(JSON.stringify(response.json), {
        status: response.status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetchImpl, calls };
}
