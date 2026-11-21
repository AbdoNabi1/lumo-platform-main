import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import type { HashPort } from "../ids/dedup-id";
import { DoubleHashError } from "./hashing";
import { normalizeIdentity } from "./normalization";
import { emailForPlatform, platformMatchKeys, splitFullName } from "./platform-identity";

const nodeSha256: HashPort = {
  sha256Hex: async (s) => createHash("sha256").update(s, "utf8").digest("hex"),
};
const sha = (s: string) => nodeSha256.sha256Hex(s);

describe("platform-identity", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  const base = normalizeIdentity(
    {
      email: " Jane.Doe+Shopping@googlemail.com ",
      phone: "01012345678",
      firstName: "Ahmed",
      lastName: "Ali",
      city: "Cairo",
      state: "Giza",
      country: "EG",
      postalCode: "11511",
      externalId: " cust-123 ",
    },
    { defaultCountryCode: "20" },
  );

  it("pins literal digests so the hasher itself is checked", async () => {
    expect(await sha("201012345678")).toBe(
      "b12a7c358b87131b5cef5a3e69a5d474532a78e4a3183971b2c70f67c8bb3c8f",
    );
    expect(await sha("+201012345678")).toBe(
      "0895f44c7a43ae484d10b8509021516091079927afc18baa37fad1a70f35c01d",
    );
  });
  it("meta: everything hashed, phone without +", async () => {
    expect(await platformMatchKeys("meta", base, nodeSha256)).toEqual({
      em: await sha("jane.doe+shopping@googlemail.com"),
      ph: await sha("201012345678"),
      fn: await sha("ahmed"),
      ln: await sha("ali"),
      ct: await sha("cairo"),
      st: await sha("giza"),
      zp: await sha("11511"),
      country: await sha("eg"),
      externalId: await sha("cust-123"),
    });
  });
  it("snap equals meta", async () => {
    expect(await platformMatchKeys("snap", base, nodeSha256)).toEqual(
      await platformMatchKeys("meta", base, nodeSha256),
    );
  });
  it("tiktok: phone with +, city/state/country plain", async () => {
    expect(await platformMatchKeys("tiktok", base, nodeSha256)).toEqual({
      em: await sha("jane.doe+shopping@googlemail.com"),
      ph: await sha("+201012345678"),
      fn: await sha("ahmed"),
      ln: await sha("ali"),
      ct: "cairo",
      st: "giza",
      zp: await sha("11511"),
      country: "eg",
      externalId: await sha("cust-123"),
    });
  });
  it("google_ads: gmail dots and +suffix removed, plain address parts, no external id", async () => {
    expect(await platformMatchKeys("google_ads", base, nodeSha256)).toEqual({
      em: "338abf9ef1c8793cadc7bcf51ed595338eb727ed9e06ce3d91d566d60b975937", // sha("janedoe@googlemail.com")
      ph: await sha("+201012345678"),
      fn: await sha("ahmed"),
      ln: await sha("ali"),
      ct: "cairo",
      st: "giza",
      zp: "11511",
      country: "EG",
    });
  });
  it.each(["firstName", "lastName", "country", "postalCode"] as const)(
    "google_ads drops the whole address when %s is missing",
    async (field) => {
      const partial = normalizeIdentity({
        email: "a@b.com",
        phone: "+201012345678",
        firstName: "Ahmed",
        lastName: "Ali",
        country: "EG",
        postalCode: "11511",
        [field]: undefined,
      });
      expect(
        Object.keys(await platformMatchKeys("google_ads", partial, nodeSha256)).sort(),
      ).toEqual(["em", "ph"]);
    },
  );
  it("ga4: gmail dots removed, +suffix kept, digits removed from names", async () => {
    const id = normalizeIdentity({
      email: "Jane.Doe+Shopping@googlemail.com",
      firstName: "Ali2",
      lastName: "123",
    });
    const keys = await platformMatchKeys("ga4", id, nodeSha256);
    expect(keys.em).toBe("77e1d8b954c12009b587de638fc81de43e21aa79163cbf39ac4ce0c21e13e627"); // sha("janedoe+shopping@googlemail.com")
    expect(keys.fn).toBe(await sha("ali"));
    expect(keys.ln).toBeUndefined();
  });
  it("gmail.com gets the same rule as googlemail.com", () => {
    expect(emailForPlatform("jane.doe+x@gmail.com", "google_ads")).toBe("janedoe@gmail.com");
    expect(emailForPlatform("jane.doe+x@gmail.com", "ga4")).toBe("janedoe+x@gmail.com");
  });
  it.each(["meta", "snap", "tiktok", "google_ads", "ga4"] as const)(
    "%s keeps non-gmail addresses verbatim",
    (p) => {
      expect(emailForPlatform("jane.doe+x@example.com", p)).toBe("jane.doe+x@example.com");
    },
  );
  it("a blank external id is omitted, not hashed", async () => {
    const id = normalizeIdentity({ email: "a@b.com", externalId: "   " });
    expect((await platformMatchKeys("tiktok", id, nodeSha256)).externalId).toBeUndefined();
  });
  it("Arabic digits hash like Latin digits", async () => {
    const ar = normalizeIdentity({ phone: "٠١٠١٢٣٤٥٦٧٨" }, { defaultCountryCode: "20" });
    expect((await platformMatchKeys("meta", ar, nodeSha256)).ph).toBe(await sha("201012345678"));
  });
  it.each(["sha256", "mixed", undefined] as const)("refuses hashStatus %j", async (status) => {
    const error = await platformMatchKeys(
      "meta",
      { ...base, hashStatus: status },
      nodeSha256,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DoubleHashError);
    expect((error as DoubleHashError).status).toBe(status ?? "mixed");
  });
  it.each([
    ["Ahmed Mohamed Ali", { firstName: "Ahmed", lastName: "Mohamed Ali" }],
    ["  أحمد   علي ", { firstName: "أحمد", lastName: "علي" }],
    ["Ahmed", { firstName: "Ahmed" }],
    ["   ", {}],
    [undefined, {}],
  ])("splitFullName(%j)", (input, expected) => {
    expect(splitFullName(input)).toEqual(expected);
  });
});
