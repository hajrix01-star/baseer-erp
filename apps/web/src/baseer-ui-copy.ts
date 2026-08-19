export type BaseerLanguage = "ar" | "en";

type CopyValue = string | ((...args: never[]) => string);
type CopyRecord = Record<string, CopyValue>;
type SameKeys<Arabic extends CopyRecord, English extends CopyRecord> =
  Exclude<keyof Arabic, keyof English> extends never
    ? Exclude<keyof English, keyof Arabic> extends never
      ? unknown
      : never
    : never;

/**
 * Keeps Arabic and English dictionaries structurally identical at compile time
 * while preserving each locale's inferred value types.
 */
export function defineLocalizedCopy<
  const Arabic extends CopyRecord,
  const English extends CopyRecord,
>(copy: { ar: Arabic; en: English } & SameKeys<Arabic, English>) {
  return copy;
}

export const baseerUiCopy = defineLocalizedCopy({
  ar: {
    close: "إغلاق",
    cancel: "إلغاء",
    processing: "جارٍ التنفيذ…",
    unavailable: "غير مصرح بهذا القسم.",
    loading: "جارٍ التحميل…",
    arabic: "العربية",
    english: "English",
    signInAndChooseCompany: "تسجيل الدخول واختيار الشركة", filters: "الفلاتر", activeFilters: "الفلاتر المطبقة", removeFilter: "إزالة الفلتر", clearFilters: "مسح الكل", previous: "السابق", next: "التالي", leaveApproved: "معتمدة", leaveReturned: "عاد للعمل",
  },
  en: {
    close: "Close",
    cancel: "Cancel",
    processing: "Processing…",
    unavailable: "No access to this section.",
    loading: "Loading…",
    arabic: "Arabic",
    english: "English",
    signInAndChooseCompany: "Sign in and choose company", filters: "Filters", activeFilters: "Applied filters", removeFilter: "Remove filter", clearFilters: "Clear all", previous: "Previous", next: "Next", leaveApproved: "Approved", leaveReturned: "Returned",
  },
});

export function uiCopy(language: BaseerLanguage) {
  return baseerUiCopy[language];
}
