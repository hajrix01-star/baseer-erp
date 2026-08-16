import { formatMoney, formatNumber } from "./number-format";
import type { Closing, Vault } from "./daily-sales-client";

type WhatsAppLanguage = "ar" | "en";

const scopeLabels = {
  ar: { MORNING: "شفت صباحي", EVENING: "شفت مسائي", ALL: "يوم كامل" },
  en: { MORNING: "Morning shift", EVENING: "Evening shift", ALL: "Full day" },
} as const;

export function buildDailySalesWhatsAppText({
  language,
  businessDate,
  closings,
  vaults,
}: {
  language: WhatsAppLanguage;
  businessDate: string;
  closings: readonly Closing[];
  vaults: readonly Vault[];
}): string {
  const posted = closings.filter(
    (closing) =>
      closing.status === "POSTED" &&
      closing.businessDate.slice(0, 10) === businessDate,
  );
  const labels = scopeLabels[language];
  const total = posted.reduce(
    (sum, closing) => sum + Number(closing.grossAmount),
    0,
  );
  const customers = posted.reduce(
    (sum, closing) => sum + closing.customerCount,
    0,
  );
  const lines = [
    language === "ar" ? "ملخص مبيعات اليوم" : "Daily sales summary",
    businessDate,
    "",
  ];

  for (const scope of ["MORNING", "EVENING", "ALL"] as const) {
    const group = posted.filter((closing) => closing.scope === scope);
    if (group.length === 0) continue;
    const amount = group.reduce(
      (sum, closing) => sum + Number(closing.grossAmount),
      0,
    );
    const groupCustomers = group.reduce(
      (sum, closing) => sum + closing.customerCount,
      0,
    );
    const average = groupCustomers > 0 ? amount / groupCustomers : 0;
    lines.push(
      language === "ar"
        ? `${labels[scope]}: ${formatMoney(amount)} | ${formatNumber(groupCustomers)} عميل | متوسط ${formatMoney(average)}`
        : `${labels[scope]}: ${formatMoney(amount)} | ${formatNumber(groupCustomers)} customers | Average ${formatMoney(average)}`,
    );
  }

  lines.push(
    "",
    language === "ar"
      ? `الإجمالي: ${formatMoney(total)}`
      : `Total: ${formatMoney(total)}`,
    language === "ar"
      ? `العملاء: ${formatNumber(customers)}`
      : `Customers: ${formatNumber(customers)}`,
    language === "ar"
      ? `متوسط العميل: ${formatMoney(customers > 0 ? total / customers : 0)}`
      : `Customer average: ${formatMoney(customers > 0 ? total / customers : 0)}`,
  );

  const vaultNames = new Map(
    vaults.map((vault) => [
      vault.id,
      language === "ar" ? vault.nameAr : vault.nameEn,
    ]),
  );
  const collection = new Map<string, number>();
  for (const closing of posted) {
    for (const allocation of closing.allocations) {
      collection.set(
        allocation.vaultId,
        (collection.get(allocation.vaultId) ?? 0) +
          Number(allocation.grossAmount),
      );
    }
  }
  const collectionText = [...collection.entries()]
    .filter(([, amount]) => amount > 0)
    .map(
      ([vaultId, amount]) =>
        `${vaultNames.get(vaultId) ?? vaultId}: ${formatMoney(amount)}`,
    )
    .join(" | ");
  if (collectionText)
    lines.push(
      "",
      language === "ar"
        ? `التحصيل: ${collectionText}`
        : `Collections: ${collectionText}`,
    );

  return lines.join("\n");
}

/** Opens WhatsApp's compose screen only. The user reviews and sends the message in WhatsApp. */
export function openDailySalesWhatsApp(text: string): void {
  window.open(
    `https://wa.me/?text=${encodeURIComponent(text)}`,
    "_blank",
    "noopener,noreferrer",
  );
}
