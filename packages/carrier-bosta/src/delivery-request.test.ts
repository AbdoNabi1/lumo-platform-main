import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BOSTA_CONFIG } from "./config";
import {
  buildDeliveryPayload,
  checkParcel,
  describeItems,
  splitReceiverName,
  type BostaParcel,
} from "./delivery-request";

beforeEach(() => {
  expect.hasAssertions();
});
const parcel = (over: Partial<BostaParcel> = {}): BostaParcel => ({
  recipient: { name: "Sasuke Uchiha", phone: "01065685435" },
  address: { line1: "Helwan street x", city: "Helwan", province: "EG-C", country: "EG" },
  codAmountMinor: 5000,
  currency: "EGP",
  itemsCount: 2,
  description: "Desc.",
  packageImages: [],
  ...over,
});
const payloadInput = (value: BostaParcel) => ({
  parcel: value,
  reference: "1001-1",
  city: { _id: "FceDyHXwpSYYF9zGW", name: "Cairo" },
  config: DEFAULT_BOSTA_CONFIG,
  webhookUrl: "https://api.example/api/v1/public/shipping/webhook/bosta",
  webhookHeaders: { "x-tenant-id": "t-1", Authorization: "s3cret" },
});

describe("delivery request", () => {
  it("converts minor units, validates currency and COD boundaries in order", () => {
    expect(buildDeliveryPayload(payloadInput(parcel({ codAmountMinor: 1234 }))).cod).toBe(12.34);
    expect(checkParcel(parcel({ codAmountMinor: 3_000_000 }), DEFAULT_BOSTA_CONFIG)).toBeNull();
    expect(
      checkParcel(parcel({ currency: "USD", codAmountMinor: -1 }), DEFAULT_BOSTA_CONFIG),
    ).toEqual({ code: "CURRENCY_NOT_SUPPORTED" });
    expect(checkParcel(parcel({ codAmountMinor: 3_000_001 }), DEFAULT_BOSTA_CONFIG)).toEqual({
      code: "COD_ABOVE_CARRIER_LIMIT",
    });
    for (const amount of [-1, 10.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])
      expect(checkParcel(parcel({ codAmountMinor: amount }), DEFAULT_BOSTA_CONFIG)).toEqual({
        code: "COD_INVALID",
      });
  });
  it.each([
    [
      { line1: "Helwan street x", city: "Helwan", country: "SA", province: "SA-01" },
      "COUNTRY_NOT_SUPPORTED",
    ],
    [{ line1: "Helwan street x", city: "Helwan", country: "EG" }, "PROVINCE_MISSING"],
    [
      { line1: "Helwan street x", city: "Helwan", country: "EG", province: "EG-ZZ" },
      "PROVINCE_UNKNOWN",
    ],
    [{ line1: "Helwan street x", city: " ", country: "EG", province: "EG-C" }, "DISTRICT_MISSING"],
    [{ line1: "St 5", city: "Helwan", country: "EG", province: "EG-C" }, "ADDRESS_LINE_TOO_SHORT"],
  ])("refuses unshippable address %#", (address, reason) => {
    expect(checkParcel(parcel({ address }), DEFAULT_BOSTA_CONFIG)).toEqual({
      code: "ADDRESS_NOT_SHIPPABLE",
      reason,
    });
  });
  it("validates recipient and phone and joins address lines", () => {
    expect(
      checkParcel(
        parcel({ recipient: { name: "  ", phone: "01065685435" } }),
        DEFAULT_BOSTA_CONFIG,
      ),
    ).toEqual({ code: "ADDRESS_NOT_SHIPPABLE", reason: "RECIPIENT_MISSING" });
    expect(
      checkParcel(parcel({ recipient: { name: "A", phone: "bad" } }), DEFAULT_BOSTA_CONFIG),
    ).toEqual({ code: "PHONE_NOT_SHIPPABLE" });
    expect(
      checkParcel(
        parcel({
          address: {
            line1: "St 5",
            line2: "Flat 2",
            city: "Helwan",
            province: "EG-C",
            country: "EG",
          },
        }),
        DEFAULT_BOSTA_CONFIG,
      ),
    ).toBeNull();
  });
  it("builds documented payload and omits optional fields as appropriate", () => {
    const body = buildDeliveryPayload(payloadInput(parcel()));
    expect(body).toEqual({
      type: 10,
      specs: {
        packageType: "Parcel",
        size: "SMALL",
        packageDetails: { itemsCount: 2, description: "Desc." },
      },
      cod: 50,
      dropOffAddress: {
        city: "Cairo",
        cityId: "FceDyHXwpSYYF9zGW",
        districtName: "Helwan",
        firstLine: "Helwan street x",
      },
      receiver: { firstName: "Sasuke", lastName: "Uchiha", phone: "01065685435" },
      businessReference: "1001-1",
      uniqueBusinessReference: "1001-1",
      allowToOpenPackage: false,
      escrowInfo: { isExcluded: true },
      webhookUrl: "https://api.example/api/v1/public/shipping/webhook/bosta",
      webhookCustomHeaders: { "x-tenant-id": "t-1", Authorization: "s3cret" },
    });
    expect(body).not.toHaveProperty("deliveryImages");
    expect(body).not.toHaveProperty("goodsInfo");
    const noWebhook = buildDeliveryPayload({ ...payloadInput(parcel()), webhookUrl: null });
    expect(noWebhook).not.toHaveProperty("webhookUrl");
    expect(noWebhook).not.toHaveProperty("webhookCustomHeaders");
  });
  it("permits opening only with up to ten distinct HTTPS images", () => {
    const config = { ...DEFAULT_BOSTA_CONFIG, allowToOpenPackage: true };
    const images = Array.from({ length: 12 }, (_, index) => `https://a/${index + 1}.jpg`);
    const withImages = parcel({
      packageImages: ["http://a/x.jpg", images[0]!, images[0]!, ...images.slice(1)],
    });
    expect(checkParcel(withImages, config)).toBeNull();
    expect(buildDeliveryPayload({ ...payloadInput(withImages), config })).toMatchObject({
      allowToOpenPackage: true,
      deliveryImages: [{ type: "ALLOW_TO_OPEN_THE_PACKAGE", images: images.slice(0, 10) }],
    });
    expect(checkParcel(parcel({ packageImages: ["http://a/x.jpg"] }), config)).toEqual({
      code: "OPEN_PACKAGE_NEEDS_IMAGES",
    });
  });
  it("splits names and clips descriptions", () => {
    expect(splitReceiverName("Ahmed")).toEqual({ firstName: "Ahmed", lastName: "-" });
    expect(splitReceiverName("  Sasuke   Uchiha  ")).toEqual({
      firstName: "Sasuke",
      lastName: "Uchiha",
    });
    expect(describeItems(" x ")).toBe("x");
    expect(describeItems("x".repeat(250))).toBe(`${"x".repeat(199)}…`);
  });
});
