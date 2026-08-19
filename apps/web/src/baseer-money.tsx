import type { ReactNode } from "react";

export function formatBaseerMoney(value: string | number, language: "ar" | "en", currency = "SAR") {
  const amount = Number(value);
  const formatted = (Number.isFinite(amount) ? amount : 0).toLocaleString(language === "ar" ? "ar-SA" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currency}`;
}

export function BaseerMoney({ value, language, currency = "SAR", className }: { value: string | number; language: "ar" | "en"; currency?: string; className?: string }) {
  return <bdi className={["baseer-money", className].filter(Boolean).join(" ")} dir="ltr">{formatBaseerMoney(value, language, currency) as ReactNode}</bdi>;
}
