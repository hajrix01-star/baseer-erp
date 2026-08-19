import { useEffect, useState } from "react";

import "./hr-employee-directory-grid.css";

import { BaseerMoney } from "./baseer-money";
import { BaseerStatusBadge } from "./baseer-status-badge";
import { activeSession } from "./daily-sales-client";
import { downloadHrEmployeeDocumentVersion, type HrEmployee } from "./hr-client";

type Language = "ar" | "en";

const initials = (name: string) => name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "—";
const statusLabel = (language: Language, status: HrEmployee["status"]) => ({
  ACTIVE: language === "ar" ? "نشط" : "Active",
  ON_LEAVE: language === "ar" ? "في إجازة" : "On leave",
  TERMINATED: language === "ar" ? "منتهٍ" : "Terminated",
  ARCHIVED: language === "ar" ? "مؤرشف" : "Archived",
})[status];
const statusTone = (status: HrEmployee["status"]) => status === "ACTIVE" ? "success" as const : status === "ON_LEAVE" ? "warning" as const : "neutral" as const;

function HrEmployeeDirectoryAvatar({ employee, name }: { employee: HrEmployee; name: string }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!employee.profilePhotoVersionId) { setPhotoUrl(null); return; }
    const session = activeSession();
    if (!session) return;
    let active = true;
    let url: string | null = null;
    void downloadHrEmployeeDocumentVersion(session, employee.profilePhotoVersionId)
      .then(({ blob }) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setPhotoUrl(url);
      })
      .catch(() => { if (active) setPhotoUrl(null); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [employee.profilePhotoVersionId]);

  return <span className="hr-employee-directory-card__avatar" aria-hidden="true">{photoUrl ? <img src={photoUrl} alt="" /> : initials(name)}</span>;
}

/** A compact directory view that deliberately exposes the same fields as the employee table. */
export function HrEmployeeDirectoryGrid({ employees, language, onOpen }: { employees: readonly HrEmployee[]; language: Language; onOpen: (employee: HrEmployee) => void }) {
  const ar = language === "ar";
  return <div className="hr-employee-directory-grid" role="list" aria-label={ar ? "بطاقات الموظفين" : "Employee cards"}>
    {employees.map((employee) => {
      const name = ar ? employee.nameAr : employee.nameEn ?? employee.nameAr;
      return <button key={employee.id} type="button" className="hr-employee-directory-card" role="listitem" onClick={() => onOpen(employee)}>
        <header>
          <HrEmployeeDirectoryAvatar employee={employee} name={name} />
          <span className="hr-employee-directory-card__identity"><strong>{name}</strong><bdi>{employee.employeeNumber}</bdi></span>
          <BaseerStatusBadge tone={statusTone(employee.status)}>{statusLabel(language, employee.status)}</BaseerStatusBadge>
        </header>
        <dl>
          <div><dt>{ar ? "المسمى الوظيفي" : "Job title"}</dt><dd>{employee.jobTitle ?? "—"}</dd></div>
          <div><dt>{ar ? "تاريخ الانضمام" : "Hire date"}</dt><dd dir="ltr">{employee.hireDate}</dd></div>
          <div><dt>{ar ? "الراتب الشهري" : "Monthly salary"}</dt><dd>{employee.currentMonthlyGross ? <BaseerMoney value={employee.currentMonthlyGross} language={language} /> : "—"}</dd></div>
        </dl>
        <footer>{ar ? "فتح ملف الموظف" : "Open employee file"}<span aria-hidden="true">←</span></footer>
      </button>;
    })}
  </div>;
}
