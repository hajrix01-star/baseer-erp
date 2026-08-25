import { defineLocalizedCopy, type BaseerLanguage } from "./baseer-ui-copy";

export const appCopy = defineLocalizedCopy({
  ar: {
    choose: "ماذا تريد أن تنجز؟",    search: "ابحث عن موديول…",
    noResults: "لا توجد نتيجة مطابقة.",
    recent: "الأخيرة",    currentModule: "الموديول الحالي",
    allModules: "كل الموديولات",
    sections: "الأقسام",
    switchToEnglish: "EN",
    switchToArabic: "AR",
    themePicker: "اختيار الثيم",
    appearance: "المظهر",
    appearanceLight: "فاتح",
    appearanceDark: "ليلي",
    appearanceSystem: "حسب الجهاز",
    close: "إغلاق",
    loadingPurchases: "جارٍ تحميل المشتريات…",
    loadingFinanceSetup: "جارٍ تحميل إعدادات المالية…",
    loadingVaults: "جارٍ تحميل الخزائن…",
    loadingExpensesObligations: "جارٍ تحميل المصروفات والالتزامات…",
    loadingAdministration: "جارٍ تحميل الإدارة…",
    loading: "جارٍ التحميل…",
    checkingAccess: "جارٍ التحقق من صلاحيات الوصول…",
    welcome: (section: string) => `مرحبًا بك في ${section}`,
  },
  en: {
    choose: "What do you want to do?",    search: "Search a module…",
    noResults: "No matching result.",
    recent: "Recent",    currentModule: "Current module",
    allModules: "All modules",
    sections: "Sections",
    switchToEnglish: "EN",
    switchToArabic: "AR",
    themePicker: "Choose theme",
    appearance: "Appearance",
    appearanceLight: "Light",
    appearanceDark: "Dark",
    appearanceSystem: "Use device setting",
    close: "Close",
    loadingPurchases: "Loading purchases…",
    loadingFinanceSetup: "Loading finance setup…",
    loadingVaults: "Loading vaults…",
    loadingExpensesObligations: "Loading expenses & obligations…",
    loadingAdministration: "Loading administration…",
    loading: "Loading…",
    checkingAccess: "Checking access permissions…",
    welcome: (section: string) => `Welcome to ${section}`,
  },
});

export function appText(language: BaseerLanguage) {
  return appCopy[language];
}
