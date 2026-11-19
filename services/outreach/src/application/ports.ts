export interface WhatsAppPhoneInfo {
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string | null;
  messagingLimitTier: string | null;
}
export interface MetaTemplateRecord {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
  rejectedReason: string | null;
  qualityScore: string | null;
}
export type SendOutcome =
  | { kind: "accepted"; providerMessageId: string }
  | { kind: "rejected"; code: string; message: string; retryable: boolean }
  | { kind: "unknown"; message: string };
export interface WhatsAppCloudApiPort {
  exchangeCode(code: string): Promise<{ accessToken: string }>;
  subscribeApp(wabaId: string, token: string): Promise<void>;
  registerPhone(phoneNumberId: string, pin: string, token: string): Promise<void>;
  getPhone(phoneNumberId: string, token: string): Promise<WhatsAppPhoneInfo>;
  listPhoneNumberIds(wabaId: string, token: string): Promise<string[]>;
  listTemplates(wabaId: string, token: string): Promise<MetaTemplateRecord[]>;
  getTemplate(templateId: string, token: string): Promise<MetaTemplateRecord>;
  createTemplate(
    wabaId: string,
    token: string,
    t: { name: string; language: string; category: string; components: unknown[] },
  ): Promise<{ id: string; status: string; category: string }>;
  deleteTemplate(wabaId: string, token: string, name: string): Promise<void>;
  sendTemplate(
    phoneNumberId: string,
    token: string,
    m: { to: string; name: string; language: string; components: unknown[]; correlationId: string },
  ): Promise<SendOutcome>;
  sendText(
    phoneNumberId: string,
    token: string,
    m: { to: string; text: string; contextMessageId?: string; correlationId: string },
  ): Promise<SendOutcome>;
  sendButtons(
    phoneNumberId: string,
    token: string,
    m: {
      to: string;
      body: string;
      buttons: { id: string; title: string }[];
      contextMessageId?: string;
      correlationId: string;
    },
  ): Promise<SendOutcome>;
}
export interface EmailSendPort {
  send(m: {
    from: string;
    replyTo?: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
    headers?: Record<string, string>;
  }): Promise<SendOutcome>;
}
export interface OutreachCredentialVault {
  readonly backing: "real" | "stub";
  seal(
    tenantId: string,
    purpose: "whatsapp",
    secrets: Readonly<Record<string, string>>,
  ): Promise<string>;
  open(
    tenantId: string,
    purpose: "whatsapp",
    sealed: string,
  ): Promise<Readonly<Record<string, string>>>;
}
