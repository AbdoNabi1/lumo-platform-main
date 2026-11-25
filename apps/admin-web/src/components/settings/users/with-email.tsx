/**
 * A dictionary sentence with an `{email}` placeholder, the address isolated in a `<bdi dir="auto">`
 * so a Latin email inside Arabic text (or the reverse) cannot reorder the sentence around it.
 */
export function WithEmail({
  template,
  email,
}: {
  readonly template: string;
  readonly email: string;
}) {
  const [before = "", after = ""] = template.split("{email}");
  return (
    <>
      {before}
      <bdi dir="auto" className="text-foreground font-medium">
        {email}
      </bdi>
      {after}
    </>
  );
}
