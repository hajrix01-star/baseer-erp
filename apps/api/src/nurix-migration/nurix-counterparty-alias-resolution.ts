export type NurixCounterpartyKind = 'COMMERCIAL_SUPPLIER' | 'GOVERNMENT_AUTHORITY' | 'GOVERNMENT_PLATFORM' | 'UTILITY_PROVIDER' | 'OTHER';
export type NurixCounterpartyAliasKind = 'CANONICAL' | 'FORMER_NAME' | 'TRADE_NAME' | 'ABBREVIATION' | 'SOURCE_VARIANT';

export type NurixCounterpartyAliasDefinition = Readonly<{
  canonicalKey: string;
  canonicalNameAr: string;
  canonicalNameEn?: string;
  kind: NurixCounterpartyKind;
  alias: string;
  aliasKind: NurixCounterpartyAliasKind;
}>;

export type NurixCounterpartyResolution =
  | Readonly<{ status: 'MATCHED'; canonicalKey: string; kind: NurixCounterpartyKind; aliasKind: NurixCounterpartyAliasKind }>
  | Readonly<{ status: 'REVIEW_REQUIRED'; reason: 'NO_EXPLICIT_ALIAS' | 'AMBIGUOUS_ALIAS' }>;

/**
 * Conservative Arabic/Latin normalisation for an exact alias registry lookup.
 * It intentionally does not use edit distance, transliteration, or semantic
 * guesses: a new spelling must be approved as an alias before it can match.
 */
export function normalizeNurixCounterpartyAlias(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/ـ/g, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[()\[\]{}.,،\-_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

export function resolveNurixCounterpartyAlias(value: string, definitions: readonly NurixCounterpartyAliasDefinition[]): NurixCounterpartyResolution {
  const normalized = normalizeNurixCounterpartyAlias(value);
  if (!normalized) return { status: 'REVIEW_REQUIRED', reason: 'NO_EXPLICIT_ALIAS' };
  const matches = definitions.filter((definition) => normalizeNurixCounterpartyAlias(definition.alias) === normalized);
  const keys = new Set(matches.map((match) => match.canonicalKey));
  if (keys.size !== 1) return { status: 'REVIEW_REQUIRED', reason: matches.length ? 'AMBIGUOUS_ALIAS' : 'NO_EXPLICIT_ALIAS' };
  const match = matches[0]!;
  return { status: 'MATCHED', canonicalKey: match.canonicalKey, kind: match.kind, aliasKind: match.aliasKind };
}

/** Known aliases are a reviewable seed, not an automatic fuzzy matcher. */
export const NURIX_COUNTERPARTY_ALIAS_SEED: readonly NurixCounterpartyAliasDefinition[] = [
  { canonicalKey: 'SAUDI_ELECTRICITY', canonicalNameAr: 'الشركة السعودية للكهرباء', canonicalNameEn: 'Saudi Electricity Company', kind: 'UTILITY_PROVIDER', alias: 'الشركة السعودية للكهرباء', aliasKind: 'CANONICAL' },
  { canonicalKey: 'SAUDI_ELECTRICITY', canonicalNameAr: 'الشركة السعودية للكهرباء', canonicalNameEn: 'Saudi Electricity Company', kind: 'UTILITY_PROVIDER', alias: 'Saudi Electricity Company', aliasKind: 'CANONICAL' },
  { canonicalKey: 'SAUDI_ELECTRICITY', canonicalNameAr: 'الشركة السعودية للكهرباء', canonicalNameEn: 'Saudi Electricity Company', kind: 'UTILITY_PROVIDER', alias: 'SEC', aliasKind: 'ABBREVIATION' },
  { canonicalKey: 'STC', canonicalNameAr: 'شركة الاتصالات السعودية', canonicalNameEn: 'Saudi Telecom Company', kind: 'UTILITY_PROVIDER', alias: 'الاتصالات السعودية (STC)', aliasKind: 'TRADE_NAME' },
  { canonicalKey: 'STC', canonicalNameAr: 'شركة الاتصالات السعودية', canonicalNameEn: 'Saudi Telecom Company', kind: 'UTILITY_PROVIDER', alias: 'Saudi Telecom Company (STC)', aliasKind: 'CANONICAL' },
  { canonicalKey: 'GOV_PASSPORTS', canonicalNameAr: 'المديرية العامة للجوازات', canonicalNameEn: 'General Directorate of Passports', kind: 'GOVERNMENT_AUTHORITY', alias: 'المديرية العامة للجوازات', aliasKind: 'CANONICAL' },
  { canonicalKey: 'GOV_ZATCA', canonicalNameAr: 'هيئة الزكاة والضريبة والجمارك', canonicalNameEn: 'Zakat, Tax and Customs Authority', kind: 'GOVERNMENT_AUTHORITY', alias: 'هيئة الزكاة والدخل', aliasKind: 'FORMER_NAME' },
  { canonicalKey: 'GOV_ZATCA', canonicalNameAr: 'هيئة الزكاة والضريبة والجمارك', canonicalNameEn: 'Zakat, Tax and Customs Authority', kind: 'GOVERNMENT_AUTHORITY', alias: 'ZATCA', aliasKind: 'ABBREVIATION' },
  { canonicalKey: 'GOV_MHRSD', canonicalNameAr: 'وزارة الموارد البشرية والتنمية الاجتماعية', canonicalNameEn: 'Ministry of Human Resources and Social Development', kind: 'GOVERNMENT_AUTHORITY', alias: 'وزارة الموارد البشرية والتنمية الاجتماعية', aliasKind: 'CANONICAL' },
  { canonicalKey: 'GOV_MOMRAH', canonicalNameAr: 'وزارة البلديات والإسكان', canonicalNameEn: 'Ministry of Municipal and Rural Affairs and Housing', kind: 'GOVERNMENT_AUTHORITY', alias: 'وزارة البلديات والإسكان', aliasKind: 'CANONICAL' },
  { canonicalKey: 'GOV_MOMRAH', canonicalNameAr: 'وزارة البلديات والإسكان', canonicalNameEn: 'Ministry of Municipal and Rural Affairs and Housing', kind: 'GOVERNMENT_AUTHORITY', alias: 'وزارة البلدية', aliasKind: 'FORMER_NAME' },
  { canonicalKey: 'GOV_MOJ', canonicalNameAr: 'وزارة العدل', canonicalNameEn: 'Ministry of Justice', kind: 'GOVERNMENT_AUTHORITY', alias: 'وزارة العدل', aliasKind: 'CANONICAL' },
  { canonicalKey: 'GOV_MOC', canonicalNameAr: 'وزارة التجارة', canonicalNameEn: 'Ministry of Commerce', kind: 'GOVERNMENT_AUTHORITY', alias: 'وزارة التجارة', aliasKind: 'CANONICAL' },
  { canonicalKey: 'GOV_PLATFORM_MUDAD', canonicalNameAr: 'منصة مدد', canonicalNameEn: 'Mudad Platform', kind: 'GOVERNMENT_PLATFORM', alias: 'منصة مدد', aliasKind: 'CANONICAL' },
  { canonicalKey: 'GOV_PLATFORM_MUQEEM', canonicalNameAr: 'منصة مقيم', canonicalNameEn: 'Muqeem Platform', kind: 'GOVERNMENT_PLATFORM', alias: 'منصة مقيم', aliasKind: 'CANONICAL' },
];

export function assertNurixCounterpartyAliasSeedIsSafe(definitions: readonly NurixCounterpartyAliasDefinition[] = NURIX_COUNTERPARTY_ALIAS_SEED): void {
  const seen = new Map<string, string>();
  for (const definition of definitions) {
    if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(definition.canonicalKey)) throw new Error('INVALID_COUNTERPARTY_CANONICAL_KEY');
    const alias = normalizeNurixCounterpartyAlias(definition.alias);
    if (!alias) throw new Error('EMPTY_COUNTERPARTY_ALIAS');
    const prior = seen.get(alias);
    if (prior && prior !== definition.canonicalKey) throw new Error('AMBIGUOUS_COUNTERPARTY_ALIAS_SEED');
    seen.set(alias, definition.canonicalKey);
  }
}
