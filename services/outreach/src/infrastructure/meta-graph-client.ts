import type {
  MetaTemplateRecord,
  SendOutcome,
  WhatsAppCloudApiPort,
  WhatsAppPhoneInfo,
} from "../application/ports";

const GRAPH_ORIGIN = "https://graph.facebook.com";
const MAX_PAGES = 20;
const TEMPLATE_FIELDS = "id,name,language,category,status,components,rejected_reason,quality_score";
const PHONE_FIELDS =
  "id,display_phone_number,verified_name,quality_rating,whatsapp_business_manager_messaging_limit";
const RETRYABLE_CODES: ReadonlySet<string> = new Set(["130429", "131056", "80007"]);
const REDACTED = "[redacted]";

/** Thrown by the non-send methods on any non-2xx, transport failure or unusable response. Never carries a secret. */
export class MetaApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

type Raw = { ok: true; status: number; payload: unknown } | { ok: false; timedOut: boolean };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret.length > 0) out = out.split(secret).join(REDACTED);
  return out;
}

/**
 * The only provider text allowed through the code-only channel: a finite safe integer (or a strictly decimal string of
 * one), normalised to its digits. Anything else — or a value equal to / containing a known secret — gets the
 * `HTTP_<status>` fallback, so a malformed provider response can never smuggle a credential into a code.
 */
function errorCode(payload: unknown, status: number, secrets: readonly string[]): string {
  const fallback = `HTTP_${status}`;
  const error = isRecord(payload) ? payload.error : undefined;
  const raw = isRecord(error) ? error.code : undefined;
  let number: number | null = null;
  if (typeof raw === "number") number = raw;
  else if (typeof raw === "string" && /^[0-9]+$/.test(raw)) number = Number(raw);
  if (number === null || !Number.isSafeInteger(number)) return fallback;
  const code = String(number);
  const leaks = [code, typeof raw === "string" ? raw : code].some((candidate) =>
    secrets.some((secret) => secret.length > 0 && candidate.includes(secret)),
  );
  return leaks ? fallback : code;
}

function errorText(payload: unknown, status: number, secrets: readonly string[]): string {
  const error = isRecord(payload) ? payload.error : undefined;
  const message = isRecord(error) ? str(error.message) : null;
  return message === null || message.length === 0
    ? `Meta request failed (HTTP ${status})`
    : redact(message, secrets);
}

function parseTemplate(item: unknown): MetaTemplateRecord | null {
  if (!isRecord(item)) return null;
  const { id, name, language, category, status } = item;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof language !== "string" ||
    typeof category !== "string" ||
    typeof status !== "string"
  )
    return null;
  const components = item.components === undefined ? [] : item.components;
  if (!Array.isArray(components)) return null;
  const score = isRecord(item.quality_score) ? str(item.quality_score.score) : null;
  return {
    id,
    name,
    language,
    category,
    status,
    components: components as unknown[],
    rejectedReason: str(item.rejected_reason),
    qualityScore: score,
  };
}

export class MetaGraphClient implements WhatsAppCloudApiPort {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(o: {
    appId: string;
    appSecret: string;
    apiVersion: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.appId = o.appId;
    this.appSecret = o.appSecret;
    this.base = `${GRAPH_ORIGIN}/${o.apiVersion}`;
    this.fetchImpl = o.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = o.timeoutMs ?? 10_000;
  }

  // ---- transport -----------------------------------------------------------------------------------------------

  private async raw(
    method: string,
    url: string,
    token: string | undefined,
    body?: unknown,
  ): Promise<Raw> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (token !== undefined) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await this.fetchImpl(url, {
        method,
        headers,
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      return { ok: true, status: response.status, payload };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return { ok: false, timedOut: name === "AbortError" || name === "TimeoutError" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Non-send call: returns the JSON payload of a 2xx, throws MetaApiError otherwise. */
  private async call(
    method: string,
    url: string,
    token: string | undefined,
    secrets: readonly string[],
    body?: unknown,
  ): Promise<unknown> {
    const result = await this.raw(method, url, token, body);
    if (!result.ok) {
      throw result.timedOut
        ? new MetaApiError("TIMEOUT", "Meta request timed out", 0)
        : new MetaApiError("NETWORK_ERROR", "Meta request failed", 0);
    }
    if (result.status < 200 || result.status >= 300) {
      throw new MetaApiError(
        errorCode(result.payload, result.status, secrets),
        errorText(result.payload, result.status, secrets),
        result.status,
      );
    }
    return result.payload;
  }

  private invalid(status = 200): MetaApiError {
    return new MetaApiError("INVALID_RESPONSE", "Meta returned an unexpected response", status);
  }

  // ---- onboarding ----------------------------------------------------------------------------------------------

  async exchangeCode(code: string): Promise<{ accessToken: string }> {
    const query = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      code,
    });
    const payload = await this.call(
      "GET",
      `${this.base}/oauth/access_token?${query.toString()}`,
      undefined,
      [this.appSecret, code],
    );
    const accessToken = isRecord(payload) ? str(payload.access_token) : null;
    if (accessToken === null || accessToken.length === 0) throw this.invalid();
    return { accessToken };
  }

  async subscribeApp(wabaId: string, token: string): Promise<void> {
    await this.call("POST", `${this.base}/${encodeURIComponent(wabaId)}/subscribed_apps`, token, [
      token,
    ]);
  }

  async registerPhone(phoneNumberId: string, pin: string, token: string): Promise<void> {
    await this.call(
      "POST",
      `${this.base}/${encodeURIComponent(phoneNumberId)}/register`,
      token,
      [token, pin],
      { messaging_product: "whatsapp", pin },
    );
  }

  async getPhone(phoneNumberId: string, token: string): Promise<WhatsAppPhoneInfo> {
    const payload = await this.call(
      "GET",
      `${this.base}/${encodeURIComponent(phoneNumberId)}?fields=${PHONE_FIELDS}`,
      token,
      [token],
    );
    if (!isRecord(payload)) throw this.invalid();
    return {
      phoneNumberId: str(payload.id) ?? phoneNumberId,
      displayPhoneNumber: str(payload.display_phone_number) ?? "",
      verifiedName: str(payload.verified_name) ?? "",
      qualityRating: str(payload.quality_rating),
      messagingLimitTier: str(payload.whatsapp_business_manager_messaging_limit),
    };
  }

  // ---- paging --------------------------------------------------------------------------------------------------

  /**
   * Follows paging.next (max 20 pages) and returns the items of a COMPLETE enumeration only. Any failure, bad schema,
   * repeated cursor/URL, off-host `next` or a 21st page throws `incompleteCode`. The bearer token is only ever sent to
   * graph.facebook.com, and the paging URL never appears in an error message.
   */
  private async paginate<T>(
    firstUrl: string,
    token: string,
    incompleteCode: string,
    label: string,
    parse: (item: unknown) => T | null,
  ): Promise<T[]> {
    const fail = (reason: string, status = 0): MetaApiError =>
      new MetaApiError(incompleteCode, `${label} incomplete: ${reason}`, status);
    const seen = new Set<string>([firstUrl]);
    const items: T[] = [];
    let url = firstUrl;
    for (let page = 1; ; page++) {
      const result = await this.raw("GET", url, token);
      if (!result.ok)
        throw fail(result.timedOut ? "page request timed out" : "page request failed");
      if (result.status < 200 || result.status >= 300)
        throw fail("page request failed", result.status);
      const body = result.payload;
      if (!isRecord(body) || !Array.isArray(body.data))
        throw fail("invalid page schema", result.status);
      for (const raw of body.data as unknown[]) {
        const item = parse(raw);
        if (item === null) throw fail("invalid item schema", result.status);
        items.push(item);
      }
      const paging = body.paging === undefined ? {} : body.paging;
      if (!isRecord(paging)) throw fail("invalid paging schema", result.status);
      // Absent cursor metadata is fine; PRESENT metadata must be well-formed or the enumeration is not certifiable.
      const cursors = paging.cursors === undefined ? {} : paging.cursors;
      if (!isRecord(cursors)) throw fail("invalid paging schema", result.status);
      for (const field of [cursors.before, cursors.after])
        if (field !== undefined && typeof field !== "string")
          throw fail("invalid paging schema", result.status);
      const after = str(cursors.after);
      if (after !== null) {
        const key = `cursor:${after}`;
        if (seen.has(key)) throw fail("repeated cursor", result.status);
        seen.add(key);
      }
      const next = paging.next;
      if (next === undefined || next === null) return items;
      if (typeof next !== "string") throw fail("invalid paging schema", result.status);
      if (page === MAX_PAGES) throw fail("page limit reached", result.status);
      if (!next.startsWith(`${GRAPH_ORIGIN}/`) || !this.isGraphUrl(next))
        throw fail("unexpected paging host", result.status);
      if (seen.has(next)) throw fail("repeated paging url", result.status);
      seen.add(next);
      url = next;
    }
  }

  private isGraphUrl(candidate: string): boolean {
    try {
      const parsed = new URL(candidate);
      return (
        parsed.protocol === "https:" &&
        parsed.origin === GRAPH_ORIGIN &&
        parsed.username === "" &&
        parsed.password === ""
      );
    } catch {
      return false;
    }
  }

  async listPhoneNumberIds(wabaId: string, token: string): Promise<string[]> {
    const ids = await this.paginate(
      `${this.base}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id`,
      token,
      "PHONE_LIST_INCOMPLETE",
      "Phone number list",
      (item) => {
        const id = isRecord(item) ? str(item.id) : null;
        return id !== null && /^\d+$/.test(id) ? id : null;
      },
    );
    return ids;
  }

  // ---- templates -----------------------------------------------------------------------------------------------

  async listTemplates(wabaId: string, token: string): Promise<MetaTemplateRecord[]> {
    return await this.paginate(
      `${this.base}/${encodeURIComponent(wabaId)}/message_templates?fields=${TEMPLATE_FIELDS}&limit=100`,
      token,
      "TEMPLATE_SYNC_INCOMPLETE",
      "Template sync",
      parseTemplate,
    );
  }

  async getTemplate(templateId: string, token: string): Promise<MetaTemplateRecord> {
    const payload = await this.call(
      "GET",
      `${this.base}/${encodeURIComponent(templateId)}?fields=${TEMPLATE_FIELDS}`,
      token,
      [token],
    );
    const record = parseTemplate(payload);
    if (record === null) throw this.invalid();
    return record;
  }

  async createTemplate(
    wabaId: string,
    token: string,
    t: { name: string; language: string; category: string; components: unknown[] },
  ): Promise<{ id: string; status: string; category: string }> {
    const payload = await this.call(
      "POST",
      `${this.base}/${encodeURIComponent(wabaId)}/message_templates`,
      token,
      [token],
      {
        name: t.name,
        language: t.language,
        category: t.category,
        components: t.components,
      },
    );
    const id = isRecord(payload) ? str(payload.id) : null;
    const status = isRecord(payload) ? str(payload.status) : null;
    const category = isRecord(payload) ? str(payload.category) : null;
    if (id === null || status === null || category === null) throw this.invalid();
    return { id, status, category };
  }

  async deleteTemplate(wabaId: string, token: string, name: string): Promise<void> {
    await this.call(
      "DELETE",
      `${this.base}/${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(name)}`,
      token,
      [token],
    );
  }

  // ---- sends ---------------------------------------------------------------------------------------------------

  sendTemplate(
    phoneNumberId: string,
    token: string,
    m: { to: string; name: string; language: string; components: unknown[]; correlationId: string },
  ): Promise<SendOutcome> {
    return this.send(phoneNumberId, token, {
      ...this.envelope(m.to),
      type: "template",
      template: { name: m.name, language: { code: m.language }, components: m.components },
      biz_opaque_callback_data: m.correlationId,
    });
  }

  sendText(
    phoneNumberId: string,
    token: string,
    m: { to: string; text: string; contextMessageId?: string; correlationId: string },
  ): Promise<SendOutcome> {
    return this.send(phoneNumberId, token, {
      ...this.envelope(m.to),
      type: "text",
      text: { body: m.text },
      ...(m.contextMessageId === undefined ? {} : { context: { message_id: m.contextMessageId } }),
      biz_opaque_callback_data: m.correlationId,
    });
  }

  async sendButtons(
    phoneNumberId: string,
    token: string,
    m: {
      to: string;
      body: string;
      buttons: { id: string; title: string }[];
      contextMessageId?: string;
      correlationId: string;
    },
  ): Promise<SendOutcome> {
    if (m.buttons.length < 1 || m.buttons.length > 3 || m.buttons.some((b) => b.title.length > 20))
      throw new Error("buttons_invalid");
    return await this.send(phoneNumberId, token, {
      ...this.envelope(m.to),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: m.body },
        action: {
          buttons: m.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
        },
      },
      ...(m.contextMessageId === undefined ? {} : { context: { message_id: m.contextMessageId } }),
      biz_opaque_callback_data: m.correlationId,
    });
  }

  private envelope(to: string): {
    messaging_product: "whatsapp";
    recipient_type: "individual";
    to: string;
  } {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.startsWith("+") ? to.slice(1) : to,
    };
  }

  private async send(
    phoneNumberId: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<SendOutcome> {
    const result = await this.raw(
      "POST",
      `${this.base}/${encodeURIComponent(phoneNumberId)}/messages`,
      token,
      body,
    );
    if (!result.ok)
      return {
        kind: "unknown",
        message: result.timedOut ? "Meta request timed out" : "Meta request failed",
      };
    const { status, payload } = result;
    if (status >= 200 && status < 300) {
      const messages = isRecord(payload) ? payload.messages : undefined;
      const first: unknown = Array.isArray(messages) ? messages[0] : undefined;
      const id = isRecord(first) ? str(first.id) : null;
      return id !== null && id.length > 0
        ? { kind: "accepted", providerMessageId: id }
        : { kind: "unknown", message: "Meta returned no message id" };
    }
    if (status >= 400 && status < 500) {
      const code = errorCode(payload, status, [token]);
      return {
        kind: "rejected",
        code,
        message: errorText(payload, status, [token]),
        retryable: status === 429 || RETRYABLE_CODES.has(code),
      };
    }
    return { kind: "unknown", message: `Meta service error (HTTP ${status})` };
  }
}
