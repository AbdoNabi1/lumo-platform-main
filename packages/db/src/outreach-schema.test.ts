import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schemaDir = join(import.meta.dirname, "..", "prisma", "schema");

describe("outreach migration", () => {
  it("creates every mapped field and forces tenant isolation for every model", () => {
    expect.hasAssertions();
    const schema = readFileSync(join(schemaDir, "outreach.prisma"), "utf8");
    const sql = readFileSync(
      join(schemaDir, "migrations", "20261119000000_outreach_channels", "migration.sql"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const models = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)];
    expect(models).toHaveLength(10);
    for (const [, , body] of models) {
      const table = /@@map\("([^"]+)"\)/.exec(body)?.[1];
      expect(table).toBeDefined();
      const create = new RegExp(`CREATE TABLE "outreach"\\."${table}" \\(([\\s\\S]*?)\\n\\);`).exec(
        sql,
      )?.[1];
      expect(create).toBeDefined();
      for (const line of body.split("\n")) {
        const field = /^\s+(\w+)\s+(String|Int|DateTime|Json)(\?)?(?=\s|$)/.exec(line);
        if (!field) continue;
        const column = /@map\("([^"]+)"\)/.exec(line)?.[1] ?? field[1];
        const type =
          field[2] === "String"
            ? line.includes("@db.Uuid")
              ? "UUID"
              : "TEXT"
            : (
                { Int: "INTEGER", DateTime: "TIMESTAMP(3)", Json: "JSONB" } as Record<
                  string,
                  string
                >
              )[field[2]];
        const sqlLine = create
          ?.split("\n")
          .find((entry) => entry.trimStart().startsWith(`"${column}" `));
        expect(sqlLine).toBeDefined();
        expect(sqlLine).toContain(`"${column}" ${type}`);
        expect(sqlLine?.includes("NOT NULL")).toBe(!field[3]);
      }
      expect(sql).toContain(`ALTER TABLE "outreach"."${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE "outreach"."${table}" FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(
        `CREATE POLICY tenant_isolation ON "outreach"."${table}" FOR ALL\n  USING (tenant_id = current_setting('app.tenant_id', true))\n  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));`,
      );
    }
  });

  it("pins important amended column types and nullability", () => {
    expect.hasAssertions();
    const schema = readFileSync(join(schemaDir, "outreach.prisma"), "utf8");
    const fields: [string, string, string][] = [
      ["WhatsAppConnection", "displayPhoneNumber", "String?"],
      ["WhatsAppConnection", "verifiedName", "String?"],
      ["WhatsAppConnection", "connectedAt", "DateTime?"],
      ["WhatsAppConnection", "sealedCredentials", "String"],
      ["WhatsAppConnection", "onboardingAttemptId", "String? @db.Uuid"],
      ["WhatsAppConnection", "onboardingLeaseOwner", "String? @db.Uuid"],
      ["WhatsAppConnection", "onboardingLeaseUntil", "DateTime?"],
      ["MessageTemplate", "components", "Json"],
      ["MessageTemplate", "statusEventAt", "DateTime?"],
      ["MessageTemplate", "categoryEventAt", "DateTime?"],
      ["MessageTemplate", "reconciledAt", "DateTime?"],
      ["MessageTemplate", "revision", "Int @default(0)"],
      ["OutboundMessage", "correlationId", "String @db.Uuid"],
      ["OutboundMessage", "dispatchStartedAt", "DateTime?"],
      ["OutboundMessage", "dispatchPhoneNumberId", "String?"],
      ["OutboundMessage", "dispatchWabaId", "String?"],
      ["OutboundMessage", "templateRevision", "Int?"],
      ["InboundMessage", "occurredAt", "DateTime"],
      ["UnmatchedStatusEvent", "correlationId", "String?"],
      ["UnmatchedStatusEvent", "resolvedAt", "DateTime?"],
      ["EmailSendCounter", "count", "Int"],
    ];
    for (const [model, field, type] of fields) {
      const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1];
      expect(
        body?.split("\n").some((line) => {
          const expected = `${field} ${type}`;
          const actual = line.trim();
          return (
            actual.startsWith(expected) &&
            (actual.length === expected.length || /\s/.test(actual.charAt(expected.length)))
          );
        }),
      ).toBe(true);
    }
  });

  it("keeps the required replay and lookup indexes in both schema and SQL", () => {
    expect.hasAssertions();
    const schema = readFileSync(join(schemaDir, "outreach.prisma"), "utf8");
    const sql = readFileSync(
      join(schemaDir, "migrations", "20261119000000_outreach_channels", "migration.sql"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const indexes: [string, string, string, string, string, string][] = [
      [
        "WhatsAppPhoneDirectory",
        "whatsapp_phone_directory",
        "unique",
        "tenantId, wabaId",
        "tenant_id, waba_id",
        "0_key",
      ],
      [
        "WhatsAppPhoneDirectory",
        "whatsapp_phone_directory",
        "unique",
        "tenantId, shopTenantId",
        "tenant_id, shop_tenant_id",
        "1_key",
      ],
      [
        "WhatsAppPhoneDirectory",
        "whatsapp_phone_directory",
        "index",
        "shopTenantId",
        "shop_tenant_id",
        "2_idx",
      ],
      [
        "MessageTemplate",
        "message_templates",
        "unique",
        "tenantId, wabaId, name, language",
        "tenant_id, waba_id, name, language",
        "0_key",
      ],
      ["Contact", "contacts", "unique", "tenantId, phoneE164", "tenant_id, phone_e164", "0_key"],
      ["Contact", "contacts", "unique", "tenantId, email", "tenant_id, email", "1_key"],
      [
        "ConsentEvent",
        "consent_events",
        "index",
        "tenantId, contactId, occurredAt",
        "tenant_id, contact_id, occurred_at",
        "0_idx",
      ],
      [
        "OutboundMessage",
        "outbound_messages",
        "unique",
        "tenantId, idempotencyKey",
        "tenant_id, idempotency_key",
        "0_key",
      ],
      [
        "OutboundMessage",
        "outbound_messages",
        "unique",
        "tenantId, correlationId",
        "tenant_id, correlation_id",
        "1_key",
      ],
      [
        "OutboundMessage",
        "outbound_messages",
        "index",
        "tenantId, providerMessageId",
        "tenant_id, provider_message_id",
        "2_idx",
      ],
      [
        "MessageStatusEvent",
        "message_status_events",
        "unique",
        "tenantId, providerEventId",
        "tenant_id, provider_event_id",
        "0_key",
      ],
      [
        "InboundMessage",
        "inbound_messages",
        "unique",
        "tenantId, providerMessageId",
        "tenant_id, provider_message_id",
        "0_key",
      ],
      [
        "UnmatchedStatusEvent",
        "unmatched_status_events",
        "unique",
        "tenantId, providerEventId",
        "tenant_id, provider_event_id",
        "0_key",
      ],
      [
        "UnmatchedStatusEvent",
        "unmatched_status_events",
        "index",
        "tenantId, providerMessageId",
        "tenant_id, provider_message_id",
        "1_idx",
      ],
      [
        "UnmatchedStatusEvent",
        "unmatched_status_events",
        "index",
        "tenantId, correlationId",
        "tenant_id, correlation_id",
        "2_idx",
      ],
      [
        "UnmatchedStatusEvent",
        "unmatched_status_events",
        "index",
        "tenantId, phoneNumberId, providerMessageId",
        "tenant_id, phone_number_id, provider_message_id",
        "3_idx",
      ],
    ];
    for (const [model, table, kind, fields, columns, suffix] of indexes) {
      const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1];
      expect(body).toContain(`@@${kind}([${fields}], map: "${table}_${suffix}")`);
      const quoted = columns
        .split(", ")
        .map((column) => `"${column}"`)
        .join(", ");
      expect(sql).toContain(
        `CREATE ${kind === "unique" ? "UNIQUE " : ""}INDEX "${table}_${suffix}" ON "outreach"."${table}"(${quoted});`,
      );
    }
  });
});
