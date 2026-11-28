import { beforeEach, describe, expect, it } from "vitest";
import type { LeadDto } from "@/lib/api/leads";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { buildLeadsCsv } from "./leads-csv";

beforeEach(() => {
  expect.hasAssertions();
});

function lead(overrides: Partial<LeadDto> = {}): LeadDto {
  return {
    id: "lead-1",
    formId: "form-1",
    name: "Mona",
    phone: "+201001234567",
    phoneE164: "+201001234567",
    email: "mona@example.com",
    message: "Hello",
    status: "new",
    trackingStatus: "pending",
    eventId: "lead_lead-1",
    createdAt: "2026-11-22T10:05:00.000Z",
    pageUrl: "https://shop.example.com/",
    referrer: null,
    ...overrides,
  };
}

const options = { t: en, locale: "en" as const, timeZone: "Africa/Cairo" };

describe("buildLeadsCsv", () => {
  it("starts with a BOM and ends every line with CRLF", () => {
    const csv = buildLeadsCsv([lead(), lead({ id: "lead-2" })], options);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(4); // header, two rows, trailing empty
    expect(lines[3]).toBe("");
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("writes the header row from t.leadsExport.columns, in the specified order", () => {
    const csv = buildLeadsCsv([], options);
    const c = en.leadsExport.columns;
    expect(csv).toBe(
      `\uFEFF${[c.date, c.name, c.phone, c.email, c.message, c.status, c.form, c.pageUrl].join(",")}\r\n`,
    );
  });

  it("writes the header in Arabic for an Arabic admin", () => {
    const csv = buildLeadsCsv([], { t: ar, locale: "ar", timeZone: "Africa/Cairo" });
    expect(
      csv.startsWith(`\uFEFF${ar.leadsExport.columns.date},${ar.leadsExport.columns.name},`),
    ).toBe(true);
  });

  it("writes one row: shop-local date, fields, status label, form, page URL", () => {
    const csv = buildLeadsCsv([lead()], options);
    const row = csv.slice(1).split("\r\n")[1];
    expect(row).toBe(
      `2026-11-22 12:05,Mona,+201001234567,mona@example.com,Hello,${en.leadStatus.new},form-1,https://shop.example.com/`,
    );
  });

  it("guards and quotes a formula name byte-exactly", () => {
    const csv = buildLeadsCsv([lead({ name: '=HYPERLINK("x")' })], options);
    expect(csv).toContain(',"\'=HYPERLINK(""x"")",');
  });

  it("guards a message starting with @, a tab, a CR or +1+2", () => {
    const cases: readonly [string, string][] = [
      ["@SUM(A1)", "'@SUM(A1)"],
      ["\tcmd", "'\tcmd"],
      ["+1+2", "'+1+2"],
    ];
    for (const [message, cell] of cases) {
      const row =
        buildLeadsCsv([lead({ message })], options)
          .slice(1)
          .split("\r\n")[1] ?? "";
      expect(row, message).toContain(`,${cell},`);
    }
    // A leading CR is guarded and then quoted (it is a line break to CSV).
    const cr = buildLeadsCsv([lead({ message: "\rx" })], options);
    expect(cr).toContain(',"\'\rx",');
  });

  it("guards every visitor-typed column, not just the name", () => {
    const hostile = lead({
      name: "=1",
      phone: "=2",
      email: "@3",
      message: "=4",
      pageUrl: "=5",
    });
    const row = buildLeadsCsv([hostile], options).slice(1).split("\r\n")[1] ?? "";
    expect(row).toContain(",'=1,'=2,'@3,'=4,");
    expect(row.endsWith(",'=5")).toBe(true);
  });

  it("keeps a real phone number as typed", () => {
    const row =
      buildLeadsCsv([lead({ phone: "+20 100 123 4567" })], options)
        .slice(1)
        .split("\r\n")[1] ?? "";
    expect(row).toContain(",+20 100 123 4567,");
  });

  it("writes null email, message and page URL as empty cells", () => {
    const row = buildLeadsCsv([lead({ email: null, message: null, pageUrl: null })], options)
      .slice(1)
      .split("\r\n")[1];
    expect(row).toBe(`2026-11-22 12:05,Mona,+201001234567,,,${en.leadStatus.new},form-1,`);
  });

  it("quotes a multi-line message with commas", () => {
    const row = buildLeadsCsv([lead({ message: "a,b\nc" })], options).slice(1);
    expect(row).toContain(',"a,b\nc",');
  });
});
