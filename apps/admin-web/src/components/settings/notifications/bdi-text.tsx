import { Fragment, type ReactNode } from "react";

/**
 * A sentence from the dictionary with `{name}` placeholders filled in. Each value is wrapped in
 * `<bdi dir="auto">`, so an email address, a store name or a domain keeps its own direction and
 * cannot reorder the Arabic or English sentence around it.
 */
export function BdiText({
  template,
  values,
}: {
  readonly template: string;
  readonly values: Readonly<Record<string, string>>;
}) {
  const parts = template.split(/\{(\w+)\}/);
  const nodes: ReactNode[] = parts.map((part, index) => {
    // Odd positions are the placeholder names the split captured.
    if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>;
    const value = values[part];
    return value === undefined ? (
      <Fragment key={index}>{`{${part}}`}</Fragment>
    ) : (
      <bdi key={index} dir="auto" className="text-foreground font-medium">
        {value}
      </bdi>
    );
  });
  return <>{nodes}</>;
}

/** A plain-text fill (for attributes such as `aria-label`, where markup is impossible). */
export function fillText(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
