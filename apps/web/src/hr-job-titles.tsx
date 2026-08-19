import { useEffect, useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerSearchSelect } from "./baseer-search-select";
import "./hr-job-titles.css";

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

export function HrJobTitleSelect({ id, language, value, required, disabled, allowCustom = true, onChange }: { id: string; language: Language; value: string; required?: boolean; disabled?: boolean; allowCustom?: boolean; onChange: (value: string) => void }) {
  const ar = language === "ar";
  const customOptionId = "__custom_job_title__";
  const selectedTitle = useMemo(() => HR_JOB_TITLE_SEED.find((title) => title.nameAr === value || title.nameEn === value), [value]);
  const [custom, setCustom] = useState(() => Boolean(allowCustom && value && !selectedTitle));
  useEffect(() => { if (selectedTitle) setCustom(false); }, [selectedTitle]);
  const options = useMemo(() => [
    ...HR_JOB_TITLE_SEED.map((title) => ({ id: title.id, label: ar ? title.nameAr : title.nameEn, description: ar ? title.groupAr : title.groupEn })),
    ...(allowCustom ? [{ id: customOptionId, label: ar ? "مسمى مخصص" : "Custom title", description: ar ? "إدخال مسمى غير موجود في القائمة" : "Enter a title not in the list" }] : []),
  ], [allowCustom, ar]);
  const choose = (titleId: string) => {
    if (titleId === customOptionId) {
      setCustom(true);
      onChange("");
      return;
    }
    const title = HR_JOB_TITLE_SEED.find((entry) => entry.id === titleId);
    if (!title) return;
    setCustom(false);
    onChange(ar ? title.nameAr : title.nameEn);
  };
  return <div className="hr-job-title-select">{custom && allowCustom ? <div className="hr-job-title-select__custom"><input id={id} required={required} disabled={disabled} value={value} placeholder={ar ? "اكتب المسمى الوظيفي" : "Enter job title"} onChange={(event) => onChange(event.target.value)} /><BaseerButton type="button" variant="quiet" disabled={disabled} onClick={() => { setCustom(false); onChange(""); }}>{ar ? "اختيار مسمى معتمد" : "Choose an approved title"}</BaseerButton></div> : <BaseerSearchSelect id={id} label={ar ? "المسمى الوظيفي" : "Job title"} value={selectedTitle?.id ?? ""} options={options} placeholder={ar ? "اختر مسمى وظيفياً" : "Select a job title"} required={required} disabled={disabled} className="hr-job-title-select__input" menuClassName="hr-job-title-select__menu" onChange={choose} />}</div>;
}
