export type NoorixCategoryMappingDecision = 'DIRECT' | 'SEMANTIC' | 'REVIEW_REQUIRED';

export type NoorixCategoryResolution = Readonly<{
  sourceCode: string;
  decision: NoorixCategoryMappingDecision;
  targetCode?: string;
  reasonAr: string;
}>;

// These are source baseline category *leaf* codes from Noorix. An importer must
// still resolve the resulting category in the target company and verify that it
// is active, belongs to that company and is a posting category before writing.
const DIRECT_CODES = new Set([
  'P1-1', 'P1-2', 'P1-3', 'P1-4', 'P1-5', 'P1-6',
  'P2-1', 'P2-2', 'P2-3',
  'P3-1', 'P3-2', 'P3-3',
  'P4-1', 'P4-2', 'P4-3', 'P4-4',
  'E2-1', 'E2-2', 'E2-3', 'E2-4', 'E2-5', 'E2-6', 'E2-7', 'E2-10', 'E2-11',
  'E3-1',
  'E4-1', 'E4-2',
  'E5-1', 'E5-2', 'E5-3',
  'E6-1', 'E6-2',
  'E7-1', 'E7-2', 'E7-3', 'E7-4', 'E7-5',
  'E8-1', 'E8-2', 'E8-3', 'E8-4', 'E8-5', 'E8-6',
]);

const SEMANTIC_MAPPINGS: Readonly<Record<string, Omit<NoorixCategoryResolution, 'sourceCode'>>> = {
  // Noorix separates these utilities. BASEER defaults to one small-company
  // posting category; the original source code remains on the import receipt.
  'E3-2': { decision: 'SEMANTIC', targetCode: 'UTIL-001', reasonAr: 'كهرباء نوركس تُرحّل إلى مرافق وخدمات في بصير.' },
  'E3-3': { decision: 'SEMANTIC', targetCode: 'UTIL-001', reasonAr: 'اتصالات نوركس تُرحّل إلى مرافق وخدمات في بصير.' },
  'E3-4': { decision: 'SEMANTIC', targetCode: 'UTIL-001', reasonAr: 'مياه نوركس تُرحّل إلى مرافق وخدمات في بصير.' },
  'E3-5': { decision: 'SEMANTIC', targetCode: 'UTIL-001', reasonAr: 'غاز نوركس يُرحّل إلى مرافق وخدمات في بصير.' },
  'E9-3': { decision: 'SEMANTIC', targetCode: 'E4-2', reasonAr: 'التأمينات الاجتماعية تُطابق بند التأمينات في بصير.' },
  // There is no safe default for travel or medical insurance. They must be
  // selected by the owner or mapped to an approved company-specific category.
  'E9-1': { decision: 'REVIEW_REQUIRED', reasonAr: 'تذاكر السفر تحتاج تعييناً صريحاً قبل الترحيل.' },
  'E9-2': { decision: 'REVIEW_REQUIRED', reasonAr: 'التأمين الطبي يحتاج تعييناً صريحاً قبل الترحيل.' },
};

export function resolveNoorixCategoryCode(sourceCode: string): NoorixCategoryResolution {
  const normalized = sourceCode.trim().toUpperCase();
  if (DIRECT_CODES.has(normalized)) {
    return { sourceCode: normalized, decision: 'DIRECT', targetCode: normalized, reasonAr: 'رمز ورقة نهائي متطابق بين نوركس وبصير.' };
  }

  const semantic = SEMANTIC_MAPPINGS[normalized];
  if (semantic) {
    return { sourceCode: normalized, ...semantic };
  }

  return {
    sourceCode: normalized,
    decision: 'REVIEW_REQUIRED',
    reasonAr: 'لا يوجد تعيين تلقائي آمن؛ يلزم اختيار بند بصير نهائي ومفعل داخل الشركة.',
  };
}