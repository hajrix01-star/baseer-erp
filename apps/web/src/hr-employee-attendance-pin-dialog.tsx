import { useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerTextInput } from "./baseer-form-fields";
import { activeSession, requestId } from "./daily-sales-client";
import { setAttendanceEmployeePin } from "./attendance-client";

type Language = "ar" | "en";

/** PIN management lives with the employee record; the persisted PIN is never returned or displayed. */
export function HrEmployeeAttendancePinDialog({ open, language, employeeId, employeeName, onClose, onSaved, onError }: { open: boolean; language: Language; employeeId: string; employeeName: string; onClose: () => void; onSaved: () => Promise<void> | void; onError: (message: string) => void }) {
  const ar = language === "ar"; const [pin, setPin] = useState(""); const [busy, setBusy] = useState(false);
  const close = () => { if (busy) return; setPin(""); onClose(); };
  const save = async (event: React.FormEvent) => { event.preventDefault(); const session = activeSession(); if (!session || busy) return; if (!/^\d{4}$/.test(pin)) { onError(ar ? "أدخل كود حضور من 4 أرقام." : "Enter a four-digit attendance PIN."); return; } setBusy(true); try { await setAttendanceEmployeePin(session, { employeeId, pin, idempotencyKey: requestId() }); setPin(""); await onSaved(); onClose(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "حفظ كود الحضور" : "Saving attendance PIN")); } finally { setBusy(false); } };
  return <BaseerFormDialog open={open} title={ar ? "تعيين أو تغيير كود الحضور" : "Set or change attendance PIN"} language={language} formId="hr-employee-attendance-pin" submitLabel={ar ? "حفظ الكود" : "Save PIN"} onClose={close} busy={busy}><form id="hr-employee-attendance-pin" className="baseer-form" onSubmit={save}><label>{ar ? "الموظف" : "Employee"}<BaseerTextInput readOnly value={employeeName} /></label><label>{ar ? "كود الحضور من 4 أرقام" : "Four-digit attendance PIN"}<BaseerTextInput required autoFocus inputMode="numeric" maxLength={4} dir="ltr" type="password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} /></label><p>{ar ? "لا يظهر الكود بعد الحفظ ولا يمكن استعادته. يمكنك فقط تعيين كود جديد عند الحاجة." : "The PIN is not shown or recoverable after saving. You can only assign a new PIN when needed."}</p></form></BaseerFormDialog>;
}
