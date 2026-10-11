export interface Province {
  readonly code: string;
  readonly en: string;
  readonly ar: string;
}

export type RegionLocale = "en" | "ar";

// ISO 3166-1 alpha-2. Country names come from Intl.DisplayNames at render time.
export const COUNTRY_CODES: readonly string[] = [
  ...["AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX"],
  ...["AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ"],
  ...["BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK"],
  ...["CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM"],
  ...["DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR"],
  ...["GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS"],
  ...["GT", "GU", "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN"],
  ...["IO", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN"],
  ...["KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV"],
  ...["LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ"],
  ...["MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI"],
  ...["NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM"],
  ...["PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC"],
  ...["SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV"],
  ...["SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR"],
  ...["TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI"],
  ...["VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW"],
];

const EG: readonly Province[] = [
  { code: "EG-ALX", en: "Alexandria", ar: "الإسكندرية" },
  { code: "EG-ASN", en: "Aswan", ar: "أسوان" },
  { code: "EG-AST", en: "Asyut", ar: "أسيوط" },
  { code: "EG-BA", en: "Red Sea", ar: "البحر الأحمر" },
  { code: "EG-BH", en: "Beheira", ar: "البحيرة" },
  { code: "EG-BNS", en: "Beni Suef", ar: "بني سويف" },
  { code: "EG-C", en: "Cairo", ar: "القاهرة" },
  { code: "EG-DK", en: "Dakahlia", ar: "الدقهلية" },
  { code: "EG-DT", en: "Damietta", ar: "دمياط" },
  { code: "EG-FYM", en: "Faiyum", ar: "الفيوم" },
  { code: "EG-GH", en: "Gharbia", ar: "الغربية" },
  { code: "EG-GZ", en: "Giza", ar: "الجيزة" },
  { code: "EG-IS", en: "Ismailia", ar: "الإسماعيلية" },
  { code: "EG-JS", en: "South Sinai", ar: "جنوب سيناء" },
  { code: "EG-KB", en: "Qalyubia", ar: "القليوبية" },
  { code: "EG-KFS", en: "Kafr El Sheikh", ar: "كفر الشيخ" },
  { code: "EG-KN", en: "Qena", ar: "قنا" },
  { code: "EG-LX", en: "Luxor", ar: "الأقصر" },
  { code: "EG-MN", en: "Minya", ar: "المنيا" },
  { code: "EG-MNF", en: "Monufia", ar: "المنوفية" },
  { code: "EG-MT", en: "Matrouh", ar: "مطروح" },
  { code: "EG-PTS", en: "Port Said", ar: "بورسعيد" },
  { code: "EG-SHG", en: "Sohag", ar: "سوهاج" },
  { code: "EG-SHR", en: "Sharqia", ar: "الشرقية" },
  { code: "EG-SIN", en: "North Sinai", ar: "شمال سيناء" },
  { code: "EG-SUZ", en: "Suez", ar: "السويس" },
  { code: "EG-WAD", en: "New Valley", ar: "الوادي الجديد" },
];

const SA: readonly Province[] = [
  { code: "SA-01", en: "Riyadh", ar: "الرياض" },
  { code: "SA-02", en: "Makkah", ar: "مكة المكرمة" },
  { code: "SA-03", en: "Madinah", ar: "المدينة المنورة" },
  { code: "SA-04", en: "Eastern Province", ar: "المنطقة الشرقية" },
  { code: "SA-05", en: "Qassim", ar: "القصيم" },
  { code: "SA-06", en: "Ha'il", ar: "حائل" },
  { code: "SA-07", en: "Tabuk", ar: "تبوك" },
  { code: "SA-08", en: "Northern Borders", ar: "الحدود الشمالية" },
  { code: "SA-09", en: "Jazan", ar: "جازان" },
  { code: "SA-10", en: "Najran", ar: "نجران" },
  { code: "SA-11", en: "Al Bahah", ar: "الباحة" },
  { code: "SA-12", en: "Al Jawf", ar: "الجوف" },
  { code: "SA-14", en: "Asir", ar: "عسير" },
];

const AE: readonly Province[] = [
  { code: "AE-AZ", en: "Abu Dhabi", ar: "أبوظبي" },
  { code: "AE-AJ", en: "Ajman", ar: "عجمان" },
  { code: "AE-FU", en: "Fujairah", ar: "الفجيرة" },
  { code: "AE-SH", en: "Sharjah", ar: "الشارقة" },
  { code: "AE-DU", en: "Dubai", ar: "دبي" },
  { code: "AE-RK", en: "Ras Al Khaimah", ar: "رأس الخيمة" },
  { code: "AE-UQ", en: "Umm Al Quwain", ar: "أم القيوين" },
];

export const PROVINCES: Readonly<Record<string, readonly Province[]>> = { EG, SA, AE };

export function hasProvinces(countryCode: string): boolean {
  return (PROVINCES[countryCode]?.length ?? 0) > 0;
}

export function isProvinceOf(countryCode: string, provinceCode: string): boolean {
  return PROVINCES[countryCode]?.some((p) => p.code === provinceCode) ?? false;
}

export function provinceName(code: string, locale: RegionLocale): string {
  const country = code.split("-")[0] ?? "";
  const found = PROVINCES[country]?.find((p) => p.code === code);
  return found ? found[locale] : code;
}
