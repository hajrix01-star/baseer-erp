type Language = "ar" | "en";

export type HrJobTitleSeed = {
  id: string;
  groupAr: string;
  groupEn: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
};

/** Default job-title suggestions for new employees; exceptional titles remain supported. */
export const HR_JOB_TITLE_SEED: readonly HrJobTitleSeed[] = [
  { id: "general-manager", groupAr: "الإدارة", groupEn: "Leadership", nameAr: "مدير عام", nameEn: "General Manager", sortOrder: 10 },
  { id: "showroom-manager", groupAr: "المعارض والمبيعات", groupEn: "Showroom & sales", nameAr: "مدير معرض", nameEn: "Showroom Manager", sortOrder: 20 },
  { id: "showroom-supervisor", groupAr: "المعارض والمبيعات", groupEn: "Showroom & sales", nameAr: "مشرف معرض", nameEn: "Showroom Supervisor", sortOrder: 30 },
  { id: "sales-associate", groupAr: "المعارض والمبيعات", groupEn: "Showroom & sales", nameAr: "بائع", nameEn: "Sales Associate", sortOrder: 40 },
  { id: "purchasing-representative", groupAr: "المشتريات والتشغيل", groupEn: "Purchasing & operations", nameAr: "مندوب مشتريات", nameEn: "Purchasing Representative", sortOrder: 50 },
  { id: "driver", groupAr: "المشتريات والتشغيل", groupEn: "Purchasing & operations", nameAr: "سائق", nameEn: "Driver", sortOrder: 60 },
  { id: "worker", groupAr: "المشتريات والتشغيل", groupEn: "Purchasing & operations", nameAr: "عامل", nameEn: "Worker", sortOrder: 70 },
  { id: "chef", groupAr: "الضيافة والمطبخ", groupEn: "Hospitality & kitchen", nameAr: "شيف", nameEn: "Chef", sortOrder: 80 },
  { id: "kitchen-worker", groupAr: "الضيافة والمطبخ", groupEn: "Hospitality & kitchen", nameAr: "عامل مطبخ", nameEn: "Kitchen Worker", sortOrder: 90 },
  { id: "waiter", groupAr: "الضيافة والمطبخ", groupEn: "Hospitality & kitchen", nameAr: "ويتر", nameEn: "Waiter", sortOrder: 100 },
  { id: "barista", groupAr: "الضيافة والمطبخ", groupEn: "Hospitality & kitchen", nameAr: "باريستا", nameEn: "Barista", sortOrder: 110 },
];

export function HrJobTitleSuggestions({ id, language }: { id: string; language: Language }) {
  return <datalist id={id}>{HR_JOB_TITLE_SEED.map((title) => <option key={title.id} value={language === "ar" ? title.nameAr : title.nameEn} label={language === "ar" ? title.groupAr : title.groupEn} />)}</datalist>;
}
