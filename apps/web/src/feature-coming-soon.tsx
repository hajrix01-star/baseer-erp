import { defineLocalizedCopy, type BaseerLanguage } from "./baseer-ui-copy";

const copy = defineLocalizedCopy({
  ar: {
    hajriTaxTitle: "Hajri Tax",
    hajriTaxMessage: "هذه الخدمة قيد البناء وستتوفر لاحقاً. لا توجد إجراءات أو بيانات متاحة في هذه الصفحة حالياً.",
    backupTitle: "النسخ الاحتياطي",
    backupMessage: "حالة النسخ الاحتياطي ستتوفر بعد اكتمال إعداد التخزين والاستعادة. لا توجد إجراءات نسخ احتياطي متاحة من هذه الصفحة حالياً.",
    comingSoon: "قيد البناء",
  },
  en: {
    hajriTaxTitle: "Hajri Tax",
    hajriTaxMessage: "This service is under construction and will be available later. No actions or data are available on this page yet.",
    backupTitle: "Backup",
    backupMessage: "Backup status will be available after storage and recovery setup is complete. No backup actions are available on this page yet.",
    comingSoon: "Coming soon",
  },
});

export function FeatureComingSoon({ language, feature }: { language: BaseerLanguage; feature: "hajriTax" | "backup" }) {
  const text = copy[language];
  const title = feature === "hajriTax" ? text.hajriTaxTitle : text.backupTitle;
  const message = feature === "hajriTax" ? text.hajriTaxMessage : text.backupMessage;
  return <section className="hero-panel" aria-labelledby={`coming-soon-${feature}`}><div><span className="eyebrow">{title}</span><h2 id={`coming-soon-${feature}`}>{text.comingSoon}</h2><p>{message}</p></div></section>;
}
