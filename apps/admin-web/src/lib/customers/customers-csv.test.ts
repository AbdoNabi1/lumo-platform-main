import { beforeEach, describe, expect, it } from "vitest";
import type { CustomerExportRowDto } from "@/lib/api/customers";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { buildCustomersCsv, CUSTOMERS_CSV_COLUMNS } from "./customers-csv";

function row(overrides: Partial<CustomerExportRowDto> = {}): CustomerExportRowDto {
  return {
    id: "c-1",
    name: "Nour Hassan",
    email: "nour@example.com",
    phone: "+201001234567",
    language: "ar",
    emailMarketing: true,
    smsMarketing: false,
    tags: ["Cairo", "VIP"],
    note: "Prefers calls",
    isGuest: false,
    address: { line1: "1 Nile St", city: "Cairo", postalCode: "11511", country: "EG" },
    ...overrides,
  };
}

const lines = (csv: string) => csv.replace(/^\uFEFF/, "").split("\r\n");

beforeEach(() => {
  expect.hasAssertions();
});

describe("buildCustomersCsv", () => {
  it("starts with a BOM, uses CRLF line ends and ends with a line break", () => {
    const csv = buildCustomersCsv([row()], { t: en });

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(lines(csv)).toHaveLength(3);
  });

  it("writes the English header row in the plan's column order", () => {
    const [header] = lines(buildCustomersCsv([], { t: en }));

    expect(header).toBe(
      "Name,Email,Phone,Language,Email marketing,SMS marketing,Tags,Note,Address,City,Postal code,Country,Guest",
    );
    expect(CUSTOMERS_CSV_COLUMNS).toEqual([
      "name",
      "email",
      "phone",
      "language",
      "emailMarketing",
      "smsMarketing",
      "tags",
      "note",
      "address",
      "city",
      "postalCode",
      "country",
      "guest",
    ]);
  });

  it("writes the Arabic header row from the Arabic dictionary", () => {
    const [header] = lines(buildCustomersCsv([], { t: ar }));

    expect(header).toBe(
      CUSTOMERS_CSV_COLUMNS.map((column) => ar.customersExport.columns[column]).join(","),
    );
    expect(header).toContain("الاسم");
    expect(header).toContain("التسويق عبر الرسائل القصيرة");
    expect(header).not.toContain("Name");
  });

  it("writes one row per customer: yes/no from the dictionary, tags joined, first address split out", () => {
    const [, data] = lines(buildCustomersCsv([row()], { t: en }));

    expect(data).toBe(
      'Nour Hassan,nour@example.com,+201001234567,ar,Yes,No,"Cairo, VIP",Prefers calls,1 Nile St,Cairo,11511,EG,No',
    );
    const [, arabic] = lines(buildCustomersCsv([row({ isGuest: true })], { t: ar }));
    expect(arabic?.startsWith("Nour Hassan,nour@example.com,+201001234567,ar,نعم,لا,")).toBe(true);
    expect(arabic?.endsWith(",نعم")).toBe(true);
  });

  it("leaves absent values empty: no phone, language, note, tags or address", () => {
    const [, data] = lines(
      buildCustomersCsv(
        [row({ phone: null, language: null, note: null, tags: [], address: null })],
        { t: en },
      ),
    );

    expect(data).toBe("Nour Hassan,nour@example.com,,,Yes,No,,,,,,,No");
  });

  it("guards a name Excel would evaluate, and keeps a phone-shaped value as typed", () => {
    const [, data] = lines(
      buildCustomersCsv([row({ name: "=SUM(1)", phone: "+201001234567", note: "@cmd" })], {
        t: en,
      }),
    );

    expect(data?.startsWith("'=SUM(1),nour@example.com,+201001234567,")).toBe(true);
    expect(data).toContain(",'@cmd,");
  });

  it("guards a phone-shaped start that continues into a formula, and a tag or email that starts with a sign", () => {
    const [, data] = lines(
      buildCustomersCsv(
        [row({ phone: "+20=cmd|' /C calc'!A0", tags: ["-1+1"], email: "-x@example.com" })],
        { t: en },
      ),
    );

    expect(data).toContain(",'-x@example.com,'+20=cmd|' /C calc'!A0,");
    expect(data).toContain(",'-1+1,");
  });

  it("quotes cells with commas, quotes and line breaks", () => {
    const [, ...rest] = lines(
      buildCustomersCsv([row({ name: 'Nour "Nono", Hassan', note: "a\nb" })], { t: en }),
    );

    const text = rest.join("\r\n");
    expect(text).toContain('"Nour ""Nono"", Hassan"');
    expect(text).toContain('"a\nb"');
  });
});
