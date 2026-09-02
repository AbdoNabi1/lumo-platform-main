import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";

export interface SecurityLookupField {
  readonly name: string;
  readonly label: string;
  readonly defaultValue?: string;
}

/**
 * A read-only lookup form for one of the 7 Security Console "resolve" GET routes
 * (`/security/resolve/...`, `/security/consent/...`, `/security/sessions/:id/introspect`,
 * `/security/credentials/:id/lineage`). Deliberately a plain `<form method="get">` with no
 * `action` — the browser submits to the current page URL, which the owning `page.tsx` reads back
 * via `searchParams`, no client JS required. This keeps every lookup a pure navigation (server
 * component, no write, no client boundary) consistent with "no write control on these screens"
 * (T3.1 brief).
 */
export function SecurityLookupForm({
  title,
  fields,
  submitLabel,
}: {
  readonly title: string;
  readonly fields: readonly SecurityLookupField[];
  readonly submitLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-base">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form method="get" className="flex flex-wrap items-end gap-3">
          {fields.map((field) => (
            <div key={field.name} className="flex flex-col gap-1">
              <Label htmlFor={`security-lookup-${field.name}`} className="text-muted-foreground text-sm">
                {field.label}
              </Label>
              <Input
                id={`security-lookup-${field.name}`}
                name={field.name}
                defaultValue={field.defaultValue}
                className="w-56"
              />
            </div>
          ))}
          <Button type="submit" variant="outline" size="sm">
            {submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
