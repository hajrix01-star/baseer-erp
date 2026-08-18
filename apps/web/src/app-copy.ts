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
    close: "إغلاق",
    loadingPurchases: "جارٍ تحميل المشتريات…",
    loadingFinanceSetup: "جارٍ تحميل إعدادات المالية…",
    loadingVaults: "جارٍ تحميل الخزائن…",
    loadingExpensesObligations: "جارٍ تحميل المصروفات والالتزامات…",
    loadingAdministration: "جارٍ تحميل الإدارة…",
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
    close: "Close",
    loadingPurchases: "Loading purchases…",
    loadingFinanceSetup: "Loading finance setup…",
    loadingVaults: "Loading vaults…",
    loadingExpensesObligations: "Loading expenses & obligations…",
    loadingAdministration: "Loading administration…",
    welcome: (section: string) => `Welcome to ${section}`,
  },
});

export function appText(language: BaseerLanguage) {
  return appCopy[language];
}
