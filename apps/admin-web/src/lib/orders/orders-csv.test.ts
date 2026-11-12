import { describe, expect, it } from "vitest";
import type { OrderExportRowDto } from "@/lib/api/orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { buildOrdersCsv, csvCell, guardCell, itemsCell, plainAmount } from "./orders-csv";

function row(overrides: Partial<OrderExportRowDto> = {}): OrderExportRowDto {
  return {
    orderId: "o-1",
    orderNumber: "1001",
    createdAt: "2026-10-18T09:05:00.000Z",
    customerName: "Mona Ali",
    email: "mona@example.com",
    phone: "+201012345678",
    line1: "1 Nile St",
    line2: null,
    city: "Cairo",
    province: "EG-C",
    country: "EG",
    items: [
      { title: "T-shirt", variantTitle: "L", sku: "SKU-1", quantity: 2 },
      { title: "Cap", variantTitle: null, sku: null, quantity: 1 },
    ],
    itemCount: 3,
    subtotalMinor: 120000,
    shippingMinor: 5000,
    discountMinor: 0,
    totalMinor: 125000,
    codAmountMinor: 125000,
    currency: "EGP",
    paymentStatus: "pending",
    paymentProvider: "cod",
    fulfillmentStatus: "unfulfilled",
    shippingMethod: "standard",
    tags: [],
    note: null,
    ...overrides,
  };
}

const options = { t: en, locale: "en" as const, timeZone: "Asia/Riyadh" };
const lines = (csv: string) => csv.replace(/^\uFEFF/, "").split("\r\n");

describe("guardCell — formula injection (Review Focus 4)", () => {
  it("prefixes ' to a cell Excel would run", () => {
    expect(guardCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(guardCell("@cmd")).toBe("'@cmd");
    expect(guardCell("+abc")).toBe("'+abc");
    expect(guardCell("-abc")).toBe("'-abc");
    expect(guardCell("\t=1")).toBe("'\t=1");
    expect(guardCell("\r=1")).toBe("'\r=1");
  });

  it("guards a phone-shaped start that continues into a formula", () => {
    expect(guardCell("+20=cmd|' /C calc'!A0")).toBe("'+20=cmd|' /C calc'!A0");
  });

  it("keeps phones and numbers exactly as typed", () => {
    expect(guardCell("+201012345678")).toBe("+201012345678");
    expect(guardCell("+20 (10) 123-4567")).toBe("+20 (10) 123-4567");
    expect(guardCell("-5")).toBe("-5");
    expect(guardCell("01012345678")).toBe("01012345678");
    expect(guardCell("")).toBe("");
  });
});

describe("csvCell — RFC 4180", () => {
  it("quotes a cell holding a comma, quote or line break, doubling quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("plain")).toBe("plain");
  });
});

describe("plainAmount", () => {
  it("prints minor units as plain decimals in the currency's own exponent", () => {
    expect(plainAmount(125000, "EGP")).toBe("1250.00");
    expect(plainAmount(5, "EGP")).toBe("0.05");
    expect(plainAmount(1250, "JPY")).toBe("1250");
    expect(plainAmount(1250, "KWD")).toBe("1.250");
    expect(plainAmount(0, "EGP")).toBe("0.00");
  });
});

describe("itemsCell", () => {
  it("joins the lines as 'qty × title (variant) [SKU]'", () => {
    expect(itemsCell(row().items)).toBe("2 × T-shirt (L) [SKU-1]; 1 × Cap");
  });
});

describe("buildOrdersCsv", () => {
  it("starts with a UTF-8 BOM, ends lines with CRLF, and prints headers in the spec's order", () => {
    const csv = buildOrdersCsv([row()], options);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(lines(csv)[0]).toBe(
      "Order,Date,Customer name,Phone,Email,Address line 1,Address line 2,City,Province,Country,Items,Item count,Subtotal,Shipping,Discount,Total,COD amount,Currency,Payment status,Payment method,Fulfillment status,Shipping method,Tags,Notes",
    );
  });

  it("writes one row per order in the shop's time zone, with province names and plain amounts", () => {
    expect(lines(buildOrdersCsv([row()], options))[1]).toBe(
      "#1001,2026-10-18 12:05,Mona Ali,+201012345678,mona@example.com,1 Nile St,,Cairo,Cairo,EG,2 × T-shirt (L) [SKU-1]; 1 × Cap,3,1200.00,50.00,0.00,1250.00,1250.00,EGP,Payment pending,Cash on delivery,Unfulfilled,Standard shipping,,",
    );
  });

  it("prints Arabic headers and the Arabic province name for an Arabic admin", () => {
    const [header, body] = lines(buildOrdersCsv([row()], { ...options, t: ar, locale: "ar" }));
    expect(header?.startsWith("الطلب,التاريخ,اسم العميل")).toBe(true);
    expect(body).toContain(",القاهرة,");
  });
});
