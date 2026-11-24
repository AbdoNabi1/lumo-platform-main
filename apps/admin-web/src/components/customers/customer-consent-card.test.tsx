import { beforeEach, describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { CustomerConsentCard } from "./customer-consent-card";

const body = () => within(document.body);

const consents = [
  { scope: "marketing", granted: true, occurredAt: "2026-11-01T10:00:00.000Z" },
  { scope: "marketing_sms", granted: false, occurredAt: "2026-11-02T10:00:00.000Z" },
  { scope: "analytics", granted: true, occurredAt: "2026-11-03T10:00:00.000Z" },
];

beforeEach(() => {
  expect.hasAssertions();
});

describe("CustomerConsentCard", () => {
  it("labels marketing as Email marketing and marketing_sms as SMS marketing", () => {
    render(<CustomerConsentCard consents={consents} t={en} locale="en" />);

    expect(body().getByText("Email marketing")).toBeInTheDocument();
    expect(body().getByText("SMS marketing")).toBeInTheDocument();
    expect(body().queryByText("marketing")).toBeNull();
    expect(body().queryByText("marketing_sms")).toBeNull();
  });

  it("labels them in Arabic", () => {
    render(<CustomerConsentCard consents={consents} t={ar} locale="ar" />);

    expect(body().getByText("التسويق عبر البريد الإلكتروني")).toBeInTheDocument();
    expect(body().getByText("التسويق عبر الرسائل القصيرة")).toBeInTheDocument();
    expect(body().queryByText("Email marketing")).toBeNull();
  });

  it("shows any other scope by its raw name, inside bdi", () => {
    render(<CustomerConsentCard consents={consents} t={en} locale="en" />);

    const raw = body().getByText("analytics");
    expect(raw.tagName).toBe("BDI");
  });

  it("keeps one row per scope: the latest record wins", () => {
    render(
      <CustomerConsentCard
        consents={[
          { scope: "marketing", granted: true, occurredAt: "2026-11-01T10:00:00.000Z" },
          { scope: "marketing", granted: false, occurredAt: "2026-11-05T10:00:00.000Z" },
        ]}
        t={en}
        locale="en"
      />,
    );

    expect(body().getAllByText("Email marketing")).toHaveLength(1);
    expect(body().getByText(en.customerDetail.consentDenied)).toBeInTheDocument();
    expect(body().queryByText(en.customerDetail.consentGranted)).toBeNull();
  });

  it("shows the empty text with no records", () => {
    render(<CustomerConsentCard consents={[]} t={en} locale="en" />);

    expect(body().getByText(en.customerDetail.noConsent)).toBeInTheDocument();
  });
});
