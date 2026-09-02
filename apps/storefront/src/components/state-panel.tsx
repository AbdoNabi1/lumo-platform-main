import type { ReactNode } from "react";
import Link from "next/link";
import { Button, Card, CardContent } from "@platform/ui";

/**
 * Shared not-found/error/empty treatment for storefront catalog pages — the same shape as
 * `admin-web`'s dashboard `StatePanel`, adapted for a full-page destination rather than a
 * widget slot (centered, with an optional way back).
 */
export function StatePanel({
  icon,
  title,
  body,
  action,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
  readonly action?: { readonly href: string; readonly label: string };
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <span
          className="bg-primary-subtle text-primary-subtle-foreground flex size-12 items-center justify-center rounded-lg"
          aria-hidden="true"
        >
          {icon}
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-md max-w-md" role="note">
          {body}
        </p>
        {action !== undefined && (
          <Button asChild>
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
