import { promises as dns } from "node:dns";
import type { DnsVerifier } from "../domain/dns-verifier";

export interface DnsResolver {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
}

export interface NodeDnsVerifierOptions {
  /** The name merchants CNAME to, e.g. `shops.morbeh.store`. */
  readonly cnameTarget: string;
  /** The storefront's public IPv4s, for apex domains that cannot CNAME. */
  readonly ipv4Targets: readonly string[];
  readonly resolver?: DnsResolver;
}

const normalise = (name: string): string => name.toLowerCase().replace(/\.$/, "");

/** `DnsVerifier` over `node:dns`. A lookup failure (NXDOMAIN, no data, timeout) means "not yet". */
export class NodeDnsVerifier implements DnsVerifier {
  private readonly options: NodeDnsVerifierOptions;
  private readonly resolver: DnsResolver;

  constructor(options: NodeDnsVerifierOptions) {
    this.options = options;
    this.resolver = options.resolver ?? dns;
  }

  async pointsToPlatform(hostname: string): Promise<boolean> {
    const target = normalise(this.options.cnameTarget);
    const cnames = await this.resolver.resolveCname(hostname).catch(() => [] as string[]);
    if (cnames.some((name) => normalise(name) === target)) return true;
    const addresses = await this.resolver.resolve4(hostname).catch(() => [] as string[]);
    return addresses.some((ip) => this.options.ipv4Targets.includes(ip));
  }
}
