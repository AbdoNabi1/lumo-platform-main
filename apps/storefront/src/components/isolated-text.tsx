/**
 * A translated sentence with one placeholder filled by a value isolated in `<bdi>`, so the value's
 * script (a Latin shop name or "#D3" inside Arabic) cannot reorder the words around it. A template
 * without the placeholder renders as-is.
 */
export function IsolatedText({
  template,
  token,
  value,
}: {
  readonly template: string;
  /** The placeholder to replace, exactly as it appears in the template ("{shop}", "#{draft}"). */
  readonly token: string;
  readonly value: string;
}) {
  const at = template.indexOf(token);
  if (at === -1) return <>{template}</>;
  return (
    <>
      {template.slice(0, at)}
      <bdi>{value}</bdi>
      {template.slice(at + token.length)}
    </>
  );
}
