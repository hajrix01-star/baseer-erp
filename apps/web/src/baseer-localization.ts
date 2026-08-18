import type { BaseerLanguage } from "./baseer-ui-copy";

export type LocalizedName = {
  nameAr: string;
  nameEn?: string | null;
};

/**
 * Names are business data. We never invent an English translation for migrated
 * records; a visible pending marker makes the missing translation actionable.
 */
export function displayName(language: BaseerLanguage, value: LocalizedName, options?: { fallback?: string }) {
  if (language === "ar") return value.nameAr;
  const english = value.nameEn?.trim();
  return english || options?.fallback || `${value.nameAr} (translation pending)`;
}

export function localizedEnum(language: BaseerLanguage, value: "CASH" | "BANK" | "APP" | "PAID" | "PAYABLE" | "PURCHASE" | "EXPENSE" | "SALE" | "ACTIVE" | "ARCHIVED") {
  const ar = {
    CASH: "نقد", BANK: "بنك", APP: "تطبيق",
    PAID: "مدفوع", PAYABLE: "آجل",
    PURCHASE: "مشتريات", EXPENSE: "مصروفات", SALE: "مبيعات",
    ACTIVE: "نشط", ARCHIVED: "مؤرشف",
  } as const;
  const en = {
    CASH: "Cash", BANK: "Bank", APP: "App",
    PAID: "Paid", PAYABLE: "Payable",
    PURCHASE: "Purchases", EXPENSE: "Expenses", SALE: "Sales",
    ACTIVE: "Active", ARCHIVED: "Archived",
  } as const;
  return language === "ar" ? ar[value] : en[value];
}