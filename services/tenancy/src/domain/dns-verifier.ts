/** Checks that a custom hostname's DNS points at the platform's storefront (Plan 1A). */
export interface DnsVerifier {
  pointsToPlatform(hostname: string): Promise<boolean>;
}
