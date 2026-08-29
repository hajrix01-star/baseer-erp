import { useEffect, useRef, useState } from "react";

import "./hr-employee-directory-grid.css";

import { BaseerMoney } from "./baseer-money";
import { BaseerCardButton } from "./baseer-card";
import { BaseerStatusBadge } from "./baseer-status-badge";
import { getAttendanceEmployeeSchedule } from "./attendance-client";
import { activeSession } from "./daily-sales-client";
import { type HrEmployee } from "./hr-client";
import { getCachedHrEmployeePhotoBlob } from "./hr-employee-photo-cache";
import { riyadhBusinessDate } from "./number-format";

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
  const avatarRef = useRef<HTMLSpanElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    setShouldLoad(false);
    if (!employee.profilePhotoVersionId) return;
    const element = avatarRef.current;
    if (!element || typeof IntersectionObserver === "undefined") { setShouldLoad(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: "160px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [employee.id, employee.profilePhotoVersionId]);

  useEffect(() => {
    setPhotoUrl((current) => { if (current) URL.revokeObjectURL(current); return null; });
    if (!shouldLoad || !employee.profilePhotoVersionId) return;
    const session = activeSession();
    if (!session) return;
    let active = true;
    let url: string | null = null;
    void getCachedHrEmployeePhotoBlob(session, employee.profilePhotoVersionId)
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setPhotoUrl(url);
      })
      .catch(() => { if (active) setPhotoUrl(null); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [employee.profilePhotoVersionId, shouldLoad]);

  return <span ref={avatarRef} className="hr-employee-directory-card__avatar" aria-hidden="true">{photoUrl ? <img src={photoUrl} alt="" /> : initials(name)}</span>;
}

/** A compact directory view that deliberately exposes the same fields as the employee table. */
export function HrEmployeeDirectoryGrid({ employees, language, onOpen }: { employees: readonly HrEmployee[]; language: Language; onOpen: (employee: HrEmployee) => void }) {
  const ar = language === "ar";
  const [scheduleNameByEmployee, setScheduleNameByEmployee] = useState<Record<string, string>>({});
  const employeeIds = employees.map((employee) => employee.id).join(",");

  useEffect(() => {
    const session = activeSession();
    if (!session || !employees.length) { setScheduleNameByEmployee({}); return; }
    let active = true;
    const effectiveDate = riyadhBusinessDate();
    void Promise.all(employees.map(async (employee) => {
      try {
        const schedule = await getAttendanceEmployeeSchedule(session, employee.id);
        const assignment = schedule.assignments.filter((item) => item.effectiveFrom <= effectiveDate).sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
        const activeAdjustments = schedule.weeklyAdjustments.filter((item) => item.effectiveFrom <= effectiveDate);
        const permanentRoster = [...new Set(activeAdjustments.map((item) => item.effectiveFrom))].find((effectiveFrom) => new Set(activeAdjustments.filter((item) => item.effectiveFrom === effectiveFrom).map((item) => item.dayOfWeek)).size === 7);
        return [employee.id, permanentRoster ? (ar ? `دوام مخصص · ${permanentRoster}` : `Custom schedule · ${permanentRoster}`) : assignment ? (ar ? assignment.templateNameAr : assignment.templateNameEn ?? assignment.templateNameAr) : ""] as const;
      } catch { return [employee.id, ""] as const; }
    })).then((entries) => { if (active) setScheduleNameByEmployee(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [ar, employeeIds]);

  return <div className="hr-employee-directory-grid" role="list" aria-label={ar ? "بطاقات الموظفين" : "Employee cards"}>
    {employees.map((employee) => {
      const name = ar ? employee.nameAr : employee.nameEn ?? employee.nameAr;
      return <BaseerCardButton key={employee.id} type="button" className="hr-employee-directory-card" role="listitem" onClick={() => onOpen(employee)}>
        <header>
          <HrEmployeeDirectoryAvatar employee={employee} name={name} />
          <span className="hr-employee-directory-card__identity"><strong>{name}</strong><bdi>{employee.employeeNumber}</bdi></span>
          <BaseerStatusBadge tone={statusTone(employee.status)}>{statusLabel(language, employee.status)}</BaseerStatusBadge>
        </header>
        <dl>
          <div><dt>{ar ? "المسمى الوظيفي" : "Job title"}</dt><dd>{employee.jobTitle ?? "—"}</dd></div>
          <div><dt>{ar ? "تاريخ الانضمام" : "Hire date"}</dt><dd dir="ltr">{employee.hireDate}</dd></div>
          <div><dt>{ar ? "شفت الدوام" : "Work shift"}</dt><dd>{scheduleNameByEmployee[employee.id] || "—"}</dd></div>
          <div><dt>{ar ? "الراتب الشهري" : "Monthly salary"}</dt><dd>{employee.currentMonthlyGross ? <BaseerMoney value={employee.currentMonthlyGross} language={language} /> : "—"}</dd></div>
        </dl>
        <footer>{ar ? "فتح ملف الموظف" : "Open employee file"}<span aria-hidden="true">←</span></footer>
      </BaseerCardButton>;
    })}
  </div>;
}
