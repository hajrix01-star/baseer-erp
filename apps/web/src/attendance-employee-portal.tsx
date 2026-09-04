import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

import { BaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerBrand } from "./baseer-brand";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerTextInput } from "./baseer-text-input";
import { attendanceEmployeePortalCompanyLogoUrl, createAttendanceEmployeePortalSession, getAttendanceEmployeePortalPresentation, getAttendanceEmployeePortalProfile, recordAttendance, type AttendanceEmployeePortalPresentation, type AttendanceEmployeePortalProfile, type AttendanceEmployeePortalSession, type AttendanceRecordReceipt } from "./attendance-client";
import { requestId } from "./daily-sales-client";
import { formatDate, formatTime, normalizeBaseerNumericInput } from "./number-format";
import "./attendance-pwa.css";

type Language = "ar" | "en";
type QrPayload = { companyId: string; branchId: string };
type PortalAccess = Pick<AttendanceEmployeePortalSession, "accessToken" | "expiresAt"> & { profile: AttendanceEmployeePortalProfile };
type PortalIntent = "ACCOUNT" | "RECORD" | null;

function employeePortalScope() {
  const query = window.location.hash.includes("?") ? window.location.hash.slice(window.location.hash.indexOf("?") + 1) : "";
  const values = new URLSearchParams(query);
  const companyId = values.get("company"); const tenantId = values.get("tenant");
  return companyId && tenantId && /^[0-9a-f-]{36}$/i.test(companyId) && /^[0-9a-f-]{36}$/i.test(tenantId) ? { companyId, tenantId } : null;
}

function readQrPayload(token: string): QrPayload | null {
  try {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) return null;
    const padded = body.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(body.length / 4) * 4, "=");
    const value = JSON.parse(atob(padded)) as Partial<QrPayload>;
    if (!value.companyId || !value.branchId || !/^[0-9a-f-]{36}$/i.test(value.companyId) || !/^[0-9a-f-]{36}$/i.test(value.branchId)) return null;
    return { companyId: value.companyId, branchId: value.branchId };
  } catch { return null; }
}

function currentLocation(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }));
}

function secureAttendanceMessage(ar: boolean, locationEnabled: boolean) {
  return locationEnabled
    ? (ar ? "يتطلب تسجيل الحضور اتصالاً آمناً عبر HTTPS حتى تعمل الكاميرا والموقع عند تفعيله. افتح رابط الموظف المنشور عبر HTTPS." : "Attendance recording needs a secure HTTPS connection for camera and, when enabled, location access.")
    : (ar ? "يتطلب تسجيل الحضور اتصالاً آمناً عبر HTTPS حتى تعمل الكاميرا. افتح رابط الموظف المنشور عبر HTTPS." : "Attendance recording needs a secure HTTPS connection for camera access.");
}

function messageFor(error: unknown, ar: boolean, locationEnabled = true) {
  if (window.location.protocol !== "https:") return secureAttendanceMessage(ar, locationEnabled);
  if (error instanceof BaseerApiError) {
    if (error.status === 0) return ar ? "تعذر التحقق بسبب انقطاع الإنترنت. أعد المحاولة." : "Verification needs an internet connection. Try again.";
    if (error.status === 403) return ar ? "تعذر التحقق من الكود أو انتهت الجلسة. أعد إدخال الكود." : "The code could not be verified or the session expired. Enter the code again.";
    if (error.status === 400) return ar ? "دقة الموقع غير كافية أو بيانات العملية غير صحيحة." : "Location accuracy is not sufficient or the request is invalid.";
    if (error.status === 409) return ar ? "لا يمكن إتمام العملية الآن. تحقق من سجل الحضور أو أعد مسح QR الجديد." : "The operation cannot be completed now. Check the attendance record or scan the refreshed QR.";
    if (error.status === 429) return ar ? "تم تقييد المحاولات مؤقتاً. انتظر ثم أعد المحاولة." : "Attempts are temporarily limited. Please wait and try again.";
  }
  if (error instanceof GeolocationPositionError) return error.code === error.PERMISSION_DENIED ? (ar ? "يجب السماح بالموقع الدقيق لتسجيل الحضور." : "Allow precise location to record attendance.") : (ar ? "تعذر تحديد الموقع بدقة. انتقل قرب المدخل وأعد المحاولة." : "Location is unavailable. Move near the entrance and try again.");
  const errorName = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (errorName === "NotAllowedError") return locationEnabled ? (ar ? "لم تسمح للمتصفح باستخدام الكاميرا أو الموقع. فعّل الصلاحية ثم أعد المحاولة." : "Camera or location permission was not granted. Allow it and try again.") : (ar ? "لم تسمح للمتصفح باستخدام الكاميرا. فعّل الصلاحية ثم أعد المحاولة." : "Camera permission was not granted. Allow it and try again.");
  return ar ? "تعذر إتمام العملية. أعد المحاولة." : "The operation could not be completed. Try again.";
}

function sourceLabel(source: AttendanceEmployeePortalProfile["schedule"][number]["source"], ar: boolean) {
  return source === "ROSTER" ? (ar ? "جدول معتمد" : "Approved roster") : source === "EXCEPTION" ? (ar ? "استثناء" : "Exception") : source === "WEEKLY_ADJUSTMENT" ? (ar ? "راحة أو نصف دوام" : "Rest or half day") : source === "TEMPLATE" ? (ar ? "قالب دوام" : "Work template") : (ar ? "لا يوجد دوام" : "No schedule");
}

function dayLabel(date: string, language: Language) { return formatDate(date, language); }

export function AttendanceEmployeePortal({ language: initialLanguage }: { language: Language }) {
  const [language, setLanguage] = useState<Language>(() => {
    try { const saved = localStorage.getItem("baseer.attendance.employee.language"); return saved === "ar" || saved === "en" ? saved : initialLanguage; } catch { return initialLanguage; }
  });
  const ar = language === "ar";
  const scope = employeePortalScope();
  const companyId = scope?.companyId ?? null;
  const tenantId = scope?.tenantId ?? null;
  const storageKey = scope ? `baseer.attendance.employee.portal.${scope.tenantId}.${scope.companyId}` : null;
  const video = useRef<HTMLVideoElement>(null);
  const [portal, setPortal] = useState<PortalAccess | null>(null);
  const [presentation, setPresentation] = useState<AttendanceEmployeePortalPresentation | null>(null);
  const [showCompanyLogo, setShowCompanyLogo] = useState(false);
  const [intent, setIntent] = useState<PortalIntent>(null);
  const [pin, setPin] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<AttendanceRecordReceipt | null>(null);

  useEffect(() => { try { localStorage.setItem("baseer.attendance.employee.language", language); } catch { /* Preference storage is optional. */ } }, [language]);

  useEffect(() => {
    if (!tenantId || !companyId) { setPresentation(null); setShowCompanyLogo(false); return; }
    let active = true;
    void getAttendanceEmployeePortalPresentation(tenantId, companyId)
      .then((value) => { if (active) { setPresentation(value); setShowCompanyLogo(value.hasCompanyLogo); } })
      .catch(() => { if (active) { setPresentation(null); setShowCompanyLogo(false); } });
    return () => { active = false; };
  }, [tenantId, companyId]);

  useEffect(() => {
    if (!storageKey) return;
    const saved = sessionStorage.getItem(storageKey);
    if (!saved) return;
    try {
      const access = JSON.parse(saved) as Pick<PortalAccess, "accessToken" | "expiresAt">;
      if (!access.accessToken || !access.expiresAt || new Date(access.expiresAt).valueOf() <= Date.now()) { sessionStorage.removeItem(storageKey); return; }
      void getAttendanceEmployeePortalProfile(access.accessToken).then((profile) => setPortal({ ...access, profile })).catch(() => sessionStorage.removeItem(storageKey));
    } catch { sessionStorage.removeItem(storageKey); }
  }, [storageKey]);

  const closeIntent = () => { if (!busy) { setIntent(null); setPin(""); } };
  const startIntent = (next: Exclude<PortalIntent, null>) => {
    setNotice(null); setReceipt(null);
    if (!scope) { setNotice(ar ? "رابط صفحة الموظف غير مكتمل. استخدم الرابط الصادر من إعدادات الحضور." : "The employee portal link is incomplete. Use the link issued from Attendance settings."); return; }
    if (next === "RECORD" && window.location.protocol !== "https:") { setNotice(secureAttendanceMessage(ar, portal?.profile.locationEnabled ?? true)); return; }
    if (next === "RECORD" && portal) { setScannerOpen(true); return; }
    setIntent(next);
  };
  const openPortal = async () => {
    if (!/^\d{4}$/.test(pin) || !intent) { setNotice(ar ? "أدخل كودك المكوّن من 4 أرقام." : "Enter your four-digit code."); return; }
    setBusy(true); setNotice(null);
    try {
      const next = await createAttendanceEmployeePortalSession(tenantId, companyId, pin);
      const access: PortalAccess = next;
      setPortal(access); if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify({ accessToken: access.accessToken, expiresAt: access.expiresAt }));
      const nextIntent = intent; setIntent(null); setPin("");
      if (nextIntent === "RECORD") setScannerOpen(true);
    } catch (error) {
      setNotice(error instanceof BaseerApiError && error.status === 403
        ? (ar ? "الكود غير صحيح أو غير مُعيّن لهذا الموظف. أعد المحاولة." : "The code is incorrect or has not been assigned to an employee. Try again.")
        : messageFor(error, ar));
    }
    finally { setBusy(false); }
  };
  const recordScannedQr = async (qrToken: string) => {
    const payload = readQrPayload(qrToken);
    const resolvedCompanyId = portal?.profile.companyId ?? companyId;
    if (!payload || !portal || !tenantId || !resolvedCompanyId || payload.companyId !== resolvedCompanyId) { setNotice(ar ? "رمز QR لا يخص منشأتك." : "This QR does not belong to your company."); setScannerOpen(false); return; }
    const locationEnabled = portal.profile.locationEnabled;
    if (locationEnabled && !navigator.geolocation) { setNotice(ar ? "الموقع غير مدعوم في هذا الجهاز." : "Location is not supported on this device."); setScannerOpen(false); return; }
    setScannerOpen(false); setBusy(true); setNotice(null);
    try {
      const position = locationEnabled ? await currentLocation() : null;
      const next = await recordAttendance({ tenantId, companyId: resolvedCompanyId, branchId: payload.branchId, qrToken, portalToken: portal.accessToken, ...(position ? { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy } : {}), idempotencyKey: requestId() });
      setReceipt(next);
      const profile = await getAttendanceEmployeePortalProfile(portal.accessToken);
      setPortal((current) => current ? { ...current, profile } : current);
    } catch (error) { setNotice(messageFor(error, ar, locationEnabled)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!scannerOpen || !portal) return;
    const element = video.current;
    if (!element || !navigator.mediaDevices?.getUserMedia) { setNotice(ar ? "يتطلب مسح QR صلاحية الكاميرا في المتصفح." : "QR scanning requires browser camera permission."); setScannerOpen(false); return; }
    const scanner = new QrScanner(element, (result) => { const token = result.data.trim(); if (token && readQrPayload(token)) void recordScannedQr(token); }, { preferredCamera: "environment", maxScansPerSecond: 4, returnDetailedScanResult: true });
    void scanner.start().catch((error: unknown) => { setNotice(messageFor(error, ar, portal.profile.locationEnabled)); setScannerOpen(false); });
    return () => scanner.destroy();
  }, [ar, portal, scannerOpen]);

  const signOut = () => { if (storageKey) sessionStorage.removeItem(storageKey); setPortal(null); setReceipt(null); setNotice(null); };
  const operationLabel = portal?.profile.state === "IN_PROGRESS" ? (ar ? "تسجيل انصراف" : "Check out") : (ar ? "تسجيل حضور" : "Check in");
  const commitmentScore = portal?.profile.commitment.score ?? null;
  const commitmentTone = commitmentScore === null ? "neutral" : commitmentScore >= 95 ? "good" : commitmentScore >= 85 ? "watch" : "attention";

  return <main className="attendance-pwa" dir={ar ? "rtl" : "ltr"}>
    <section className="attendance-pwa__card" aria-live="polite">
      <header className="attendance-pwa__topbar"><div className="attendance-pwa__identity">{showCompanyLogo && tenantId && companyId ? <img className="attendance-pwa__company-logo" src={attendanceEmployeePortalCompanyLogoUrl(tenantId, companyId)} alt={ar ? presentation?.companyNameAr ?? "" : presentation?.companyNameEn ?? presentation?.companyNameAr ?? ""} onError={() => setShowCompanyLogo(false)} /> : <BaseerBrand className="attendance-pwa__brand" />}{presentation ? <span>{ar ? presentation.companyNameAr : presentation.companyNameEn}</span> : null}</div><button className="attendance-pwa__language" type="button" onClick={() => setLanguage((current) => current === "ar" ? "en" : "ar")} aria-label={ar ? "Switch to English" : "التبديل إلى العربية"}>{ar ? "English" : "العربية"}</button></header>
      {portal ? <><header className="attendance-pwa__employee-heading"><div><span>{ar ? "حسابي" : "My account"}</span><h1>{ar ? portal.profile.employeeNameAr : portal.profile.employeeNameEn ?? portal.profile.employeeNameAr}</h1><p dir="ltr">{portal.profile.employeeNumber}</p></div><BaseerButton type="button" variant="quiet" onClick={signOut}>{ar ? "خروج" : "Sign out"}</BaseerButton></header>
        <section className={`attendance-pwa__commitment is-${commitmentTone}`} aria-label={ar ? "تقييم الالتزام الشهري" : "Monthly commitment score"}>
          <div className="attendance-pwa__commitment-ring" style={{ "--attendance-commitment": `${commitmentScore ?? 0}%` } as React.CSSProperties}><strong>{commitmentScore === null ? "—" : `${commitmentScore}%`}</strong></div>
          <div><span>{ar ? "تقييم الدوام" : "Attendance score"}</span><h2>{ar ? "التزام هذا الشهر" : "This month's commitment"}</h2><p>{commitmentScore === null ? (ar ? "يظهر التقييم بعد أول يوم دوام مكتمل." : "It appears after the first completed workday.") : (ar ? `مبني على ${portal.profile.commitment.evaluatedDays} يوم دوام مكتمل.` : `Based on ${portal.profile.commitment.evaluatedDays} completed workdays.`)}</p></div>
        </section>
        {receipt ? <div className="attendance-pwa__success" role="status"><strong>{receipt.operation === "CHECK_IN" ? (ar ? "تم تسجيل الحضور" : "Check-in recorded") : (ar ? "تم تسجيل الانصراف" : "Check-out recorded")}</strong><span>{formatTime(receipt.occurredAt, language, "Asia/Riyadh")}</span><BaseerButton type="button" onClick={() => setReceipt(null)}>{ar ? "العودة للحساب" : "Back to account"}</BaseerButton></div> : <BaseerButton className="attendance-pwa__operation" type="button" disabled={busy} onClick={() => startIntent("RECORD")}>{busy ? (ar ? "جارٍ التحقق…" : "Verifying…") : operationLabel}</BaseerButton>}
        <section className="attendance-pwa__schedule" aria-label={ar ? "دوام الأسبوع" : "Week schedule"}><header><span>{ar ? "دوامي" : "My schedule"}</span><small>{ar ? "الأيام السبعة القادمة" : "Next seven days"}</small></header><ul>{portal.profile.schedule.map((day) => <li key={day.businessDate}><div><b>{dayLabel(day.businessDate, language)}</b><small>{sourceLabel(day.source, ar)}</small></div><strong>{day.periods.length ? day.periods.map((period) => `${period.startTime}–${period.endTime}`).join(" · ") : (ar ? "راحة" : "Rest")}</strong></li>)}</ul></section>
      </> : <><div className="attendance-pwa__welcome"><span>{ar ? "بوابة الموظف" : "Employee portal"}</span><h1>{ar ? "الحضور والانصراف" : "Attendance"}</h1><p>{ar ? "سجّل حضورك وانصرافك أو ادخل إلى حسابك بأمان." : "Securely record attendance or open your account."}</p></div><div className="attendance-pwa__entry-actions"><BaseerButton className="attendance-pwa__operation" type="button" onClick={() => startIntent("RECORD")}>{ar ? "تسجيل حضور أو انصراف" : "Check in or out"}</BaseerButton><BaseerButton type="button" variant="secondary" onClick={() => startIntent("ACCOUNT")}>{ar ? "دخول حسابي" : "Open my account"}</BaseerButton></div></>}
      {notice ? <p className="attendance-pwa__notice" role="alert">{notice}</p> : null}
    </section>
    <BaseerDialog open={intent !== null} title={intent === "RECORD" ? (ar ? "أدخل كودك ثم امسح QR" : "Enter your code, then scan QR") : (ar ? "دخول حسابي" : "Open my account")} language={language} className="attendance-pwa__pin-dialog" busy={busy} onClose={closeIntent} footer={<BaseerButton variant="primary" type="submit" form="attendance-employee-code" disabled={busy}>{busy ? (ar ? "جارٍ التحقق…" : "Verifying…") : intent === "RECORD" ? (ar ? "متابعة إلى الكاميرا" : "Continue to camera") : (ar ? "دخول" : "Open account")}</BaseerButton>}><form id="attendance-employee-code" className="attendance-pwa__pin-form" onSubmit={(event) => { event.preventDefault(); void openPortal(); }}><label>{ar ? "الكود الشخصي" : "Personal code"}<BaseerTextInput dir="ltr" autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]*" type="password" maxLength={4} value={pin} onChange={(event) => setPin(normalizeBaseerNumericInput(event.target.value, { allowNegative: false }).replace(/\D/g, "").slice(0, 4))} disabled={busy} /></label></form></BaseerDialog>
    {scannerOpen ? <BaseerDialog open title={ar ? "امسح رمز QR داخل الفرع" : "Scan the QR inside the branch"} language={language} className="attendance-pwa__scanner-dialog" onClose={() => setScannerOpen(false)} footer={<BaseerButton type="button" variant="secondary" onClick={() => setScannerOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton>}><video ref={video} autoPlay muted playsInline /></BaseerDialog> : null}
  </main>;
}
