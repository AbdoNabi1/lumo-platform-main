import { describe, expect, it } from "vitest";
import { NodeDnsVerifier, type DnsResolver } from "./node-dns-verifier";

function resolver(records: { cname?: string[]; a?: string[] }): DnsResolver {
  const notFound = Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
  return {
    resolveCname: async () => {
      if (records.cname === undefined) throw notFound;
      return records.cname;
    },
    resolve4: async () => {
      if (records.a === undefined) throw notFound;
      return records.a;
    },
  };
}

const options = { cnameTarget: "shops.morbeh.store", ipv4Targets: ["203.0.113.10"] };

describe("NodeDnsVerifier", () => {
  it("accepts a CNAME to the target (case and trailing dot ignored)", async () => {
    const dns = new NodeDnsVerifier({
      ...options,
      resolver: resolver({ cname: ["Shops.Morbeh.Store."] }),
    });
    expect(await dns.pointsToPlatform("www.acme.com")).toBe(true);
  });

  it("accepts an apex A record on a platform IPv4", async () => {
    const dns = new NodeDnsVerifier({ ...options, resolver: resolver({ a: ["203.0.113.10"] }) });
    expect(await dns.pointsToPlatform("acme.com")).toBe(true);
  });

  it("rejects other targets and missing records without throwing", async () => {
    const elsewhere = new NodeDnsVerifier({
      ...options,
      resolver: resolver({ cname: ["other.host"], a: ["198.51.100.1"] }),
    });
    expect(await elsewhere.pointsToPlatform("acme.com")).toBe(false);
    const missing = new NodeDnsVerifier({ ...options, resolver: resolver({}) });
    expect(await missing.pointsToPlatform("acme.com")).toBe(false);
  });
});
