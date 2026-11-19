import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";
import { PreviewBanner } from "./preview-banner";

const EXPIRES = "2026-11-02T14:05:00.000Z";
const localTime = (locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(EXPIRES));

describe("PreviewBanner (Ruling 16)", () => {
  it("says it is a preview and when the link expires, in the viewer's own clock", () => {
    render(<PreviewBanner t={en} locale="en" expiresAt={EXPIRES} expired={false} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(en.preview.banner);
    expect(banner).toHaveTextContent(en.preview.expires.replace("{time}", localTime("en")));
    expect(banner.querySelector("time")).toHaveAttribute("datetime", EXPIRES);
  });

  it("formats the time for Arabic", () => {
    render(<PreviewBanner t={ar} locale="ar" expiresAt={EXPIRES} expired={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(localTime("ar"));
  });

  it("renders no clock on the server, so hydration never disagrees with the browser's zone", () => {
    const html = renderToString(
      <PreviewBanner t={en} locale="en" expiresAt={EXPIRES} expired={false} />,
    );
    expect(html).toContain(en.preview.banner);
    expect(html).not.toContain(localTime("en"));
  });

  it("says the link expired", () => {
    render(<PreviewBanner t={en} locale="en" expiresAt={null} expired />);
    expect(screen.getByRole("status")).toHaveTextContent(en.preview.expired);
    expect(screen.getByRole("status")).not.toHaveTextContent(en.preview.banner);
  });

  it("leaves out the expiry when it is unknown or not a date", () => {
    render(<PreviewBanner t={en} locale="en" expiresAt="not a date" expired={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(en.preview.banner);
    expect(screen.getByRole("status").querySelector("time")).toBeNull();
  });
});
