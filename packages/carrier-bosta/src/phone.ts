export function toBostaPhone(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const ascii = raw.replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) & 0x0f));
  const compact = ascii.replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;
  let national = compact.replace(/^\+/, "");
  if (national.startsWith("0020")) national = national.slice(4);
  else if (national.startsWith("20") && national.length === 12) national = national.slice(2);
  if (national.length === 10 && national.startsWith("1")) national = `0${national}`;
  return /^01[0125]\d{8}$/.test(national) ? national : null;
}
