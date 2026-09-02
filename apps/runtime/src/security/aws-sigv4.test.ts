import { describe, expect, it } from "vitest";
import { signAwsRequest } from "./aws-sigv4";

/** AWS's published SigV4 test-suite credentials (docs "Examples of a signed request"). */
const CREDENTIALS = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

describe("signAwsRequest (SigV4)", () => {
  it("matches the AWS 'get-vanilla' test vector", () => {
    const headers = signAwsRequest({
      method: "GET",
      host: "example.amazonaws.com",
      path: "/",
      headers: {},
      body: "",
      service: "service",
      region: "us-east-1",
      credentials: CREDENTIALS,
      date: new Date("2015-08-30T12:36:00Z"),
    });
    expect(headers["X-Amz-Date"]).toBe("20150830T123600Z");
    expect(headers["Authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  it("is deterministic for a fixed instant and includes a session token when present", () => {
    const input = {
      method: "POST",
      host: "kms.us-east-1.amazonaws.com",
      path: "/",
      headers: {
        "X-Amz-Target": "TrentService.Encrypt",
        "Content-Type": "application/x-amz-json-1.1",
      },
      body: JSON.stringify({ KeyId: "k", Plaintext: "cA==" }),
      service: "kms",
      region: "us-east-1",
      credentials: { ...CREDENTIALS, sessionToken: "session-123" },
      date: new Date("2026-07-18T00:00:00Z"),
    } as const;
    const a = signAwsRequest(input);
    const b = signAwsRequest(input);
    expect(a["Authorization"]).toBe(b["Authorization"]);
    expect(a["X-Amz-Security-Token"]).toBe("session-123");
    // Signed headers must include the extra x-amz-target header.
    expect(a["Authorization"]).toContain("SignedHeaders=content-type;host;x-amz-date;x-amz-target");
  });
});
