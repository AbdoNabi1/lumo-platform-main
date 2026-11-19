import type {
  EmailSendPort,
  MetaTemplateRecord,
  OutreachCredentialVault,
  SendOutcome,
  WhatsAppCloudApiPort,
  WhatsAppPhoneInfo,
} from "../application/ports";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Yields to the event loop so every already-runnable continuation can run (deterministic barrier helper). */
export async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise<void>((r) => setImmediate(r));
}

export class FakeClock {
  private current: Date;
  constructor(start: Date) {
    this.current = new Date(start);
  }
  now(): Date {
    return new Date(this.current);
  }
  set(d: Date): void {
    this.current = new Date(d);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

type PortMethod = keyof WhatsAppCloudApiPort;
type Handler = (...args: never[]) => unknown;

/** A recording WhatsApp port. Defaults succeed; `once`/`set` script one-shot / permanent behaviour per method. */
export class FakeWhatsAppPort implements WhatsAppCloudApiPort {
  readonly calls: Array<{ method: PortMethod; args: unknown[] }> = [];
  phoneIds: string[] = ["phone-1"];
  templates: MetaTemplateRecord[] = [];
  private readonly permanent = new Map<PortMethod, Handler>();
  private readonly oneShot = new Map<PortMethod, Handler[]>();
  private counter = 0;

  set(method: PortMethod, handler: Handler): void {
    this.permanent.set(method, handler);
  }

  once(method: PortMethod, handler: Handler): void {
    const list = this.oneShot.get(method) ?? [];
    list.push(handler);
    this.oneShot.set(method, list);
  }

  count(method: PortMethod): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  callsOf(method: PortMethod): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  get total(): number {
    return this.calls.length;
  }

  get mutations(): number {
    const m: PortMethod[] = ["subscribeApp", "registerPhone", "createTemplate", "deleteTemplate"];
    return this.calls.filter((c) => m.includes(c.method)).length;
  }

  private async run<T>(method: PortMethod, args: unknown[], fallback: () => T): Promise<T> {
    this.calls.push({ method, args });
    const queued = this.oneShot.get(method)?.shift();
    const handler = queued ?? this.permanent.get(method);
    if (handler !== undefined)
      return (await (handler as (...a: unknown[]) => unknown)(...args)) as T;
    return fallback();
  }

  exchangeCode(code: string): Promise<{ accessToken: string }> {
    return this.run("exchangeCode", [code], () => ({ accessToken: `token-${code}` }));
  }
  subscribeApp(wabaId: string, token: string): Promise<void> {
    return this.run("subscribeApp", [wabaId, token], () => undefined);
  }
  registerPhone(phoneNumberId: string, pin: string, token: string): Promise<void> {
    return this.run("registerPhone", [phoneNumberId, pin, token], () => undefined);
  }
  getPhone(phoneNumberId: string, token: string): Promise<WhatsAppPhoneInfo> {
    return this.run("getPhone", [phoneNumberId, token], () => ({
      phoneNumberId,
      displayPhoneNumber: "+20 101 234 5678",
      verifiedName: "Shop",
      qualityRating: "GREEN",
      messagingLimitTier: "TIER_250",
    }));
  }
  listPhoneNumberIds(wabaId: string, token: string): Promise<string[]> {
    return this.run("listPhoneNumberIds", [wabaId, token], () => [...this.phoneIds]);
  }
  listTemplates(wabaId: string, token: string): Promise<MetaTemplateRecord[]> {
    return this.run("listTemplates", [wabaId, token], () => structuredClone(this.templates));
  }
  getTemplate(templateId: string, token: string): Promise<MetaTemplateRecord> {
    return this.run("getTemplate", [templateId, token], () => {
      const found = this.templates.find((t) => t.id === templateId);
      if (found === undefined) throw new Error("template not found");
      return structuredClone(found);
    });
  }
  createTemplate(
    wabaId: string,
    token: string,
    t: { name: string; language: string; category: string; components: unknown[] },
  ): Promise<{ id: string; status: string; category: string }> {
    return this.run("createTemplate", [wabaId, token, t], () => ({
      id: `meta-${t.name}`,
      status: "PENDING",
      category: t.category,
    }));
  }
  deleteTemplate(wabaId: string, token: string, name: string): Promise<void> {
    return this.run("deleteTemplate", [wabaId, token, name], () => undefined);
  }
  private send(method: PortMethod, args: unknown[]): Promise<SendOutcome> {
    return this.run(method, args, () => {
      this.counter += 1;
      return { kind: "accepted", providerMessageId: `wamid.${this.counter}` };
    });
  }
  sendTemplate(
    phoneNumberId: string,
    token: string,
    m: Parameters<WhatsAppCloudApiPort["sendTemplate"]>[2],
  ): Promise<SendOutcome> {
    return this.send("sendTemplate", [phoneNumberId, token, m]);
  }
  sendText(
    phoneNumberId: string,
    token: string,
    m: Parameters<WhatsAppCloudApiPort["sendText"]>[2],
  ): Promise<SendOutcome> {
    return this.send("sendText", [phoneNumberId, token, m]);
  }
  sendButtons(
    phoneNumberId: string,
    token: string,
    m: Parameters<WhatsAppCloudApiPort["sendButtons"]>[2],
  ): Promise<SendOutcome> {
    return this.send("sendButtons", [phoneNumberId, token, m]);
  }
}

type EmailMessage = Parameters<EmailSendPort["send"]>[0];

export class FakeEmailPort implements EmailSendPort {
  readonly calls: EmailMessage[] = [];
  private handler: ((m: EmailMessage) => Promise<SendOutcome> | SendOutcome) | undefined;
  private counter = 0;

  respond(handler: (m: EmailMessage) => Promise<SendOutcome> | SendOutcome): void {
    this.handler = handler;
  }

  async send(m: EmailMessage): Promise<SendOutcome> {
    this.calls.push(m);
    if (this.handler !== undefined) return await this.handler(m);
    this.counter += 1;
    return { kind: "accepted", providerMessageId: `email-${this.counter}` };
  }
}

/** Seals as readable JSON (stub). Failure switches let a test break seal/open. */
export class FakeVault implements OutreachCredentialVault {
  readonly backing = "stub" as const;
  failSeal = false;
  failOpen = false;
  readonly sealCalls: Array<Readonly<Record<string, string>>> = [];

  seal(
    tenantId: string,
    _purpose: "whatsapp",
    secrets: Readonly<Record<string, string>>,
  ): Promise<string> {
    if (this.failSeal) return Promise.reject(new Error("seal failed"));
    this.sealCalls.push(secrets);
    return Promise.resolve(`sealed:${tenantId}:${JSON.stringify(secrets)}`);
  }

  open(
    tenantId: string,
    _purpose: "whatsapp",
    sealed: string,
  ): Promise<Readonly<Record<string, string>>> {
    if (this.failOpen) return Promise.reject(new Error("open failed"));
    const prefix = `sealed:${tenantId}:`;
    if (!sealed.startsWith(prefix)) return Promise.reject(new Error("open failed"));
    return Promise.resolve(JSON.parse(sealed.slice(prefix.length)) as Record<string, string>);
  }
}
