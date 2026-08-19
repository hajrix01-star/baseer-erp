import type { ReactNode } from "react";
import { formatMoney } from "./number-format";

export function formatBaseerMoney(value: string | number, _language: "ar" | "en", currency = "SAR") {
  return formatMoney(value, currency);
}

export function BaseerMoney({ value, language, currency = "SAR", className }: { value: string | number; language: "ar" | "en"; currency?: string; className?: string }) {
  return <bdi className={["baseer-money", className].filter(Boolean).join(" ")} dir="ltr">{formatBaseerMoney(value, language, currency) as ReactNode}</bdi>;
}
