export type HrCopy = Record<string, string>;

export const hrCopy = {
  ar: {
    title: "الموارد البشرية", employees: "الموظفون", services: "الإقامات والخدمات", employeeFile: "ملف الموظف", addEmployee: "إضافة موظف", addService: "إضافة خدمة", loading: "جارٍ تحميل بيانات الموارد البشرية…", noEmployees: "لا يوجد موظفون مسجلون لهذه الشركة.", noServices: "لا توجد خدمات مسجلة.", noMovements: "لا توجد حركات مالية لهذا الموظف.", employeeNumber: "رقم الموظف", employeeName: "اسم الموظف", jobTitle: "المهنة", status: "الحالة", hireDate: "تاريخ الانضمام", monthlySalary: "الراتب الشهري", email: "البريد الإلكتروني", phone: "الجوال", notes: "ملاحظات", save: "حفظ", cancel: "إلغاء", active: "نشط", onLeave: "في إجازة", terminated: "منتهٍ", archived: "مؤرشف", serviceType: "نوع الخدمة", referenceNumber: "الرقم المرجعي", issueDate: "تاريخ الإصدار", expiryDate: "تاريخ الانتهاء", supplier: "المورد", financialCategory: "البند المالي", serviceSaved: "تم حفظ خدمة الموظف.", employeeSaved: "تم حفظ الموظف.", employeeUpdated: "تم تحديث ملف الموظف.", financialRecord: "السجل المالي للموظف", movementType: "نوع الحركة", date: "التاريخ", amount: "المبلغ", sourceReference: "مرجع العملية", loadMore: "تحميل المزيد", personalDetails: "بيانات الموظف", createEmployee: "إنشاء موظف", createService: "إنشاء خدمة", issueServiceCost: "إصدار تكلفة الخدمة", serviceCostIssued: "تم إصدار تكلفة الخدمة وقيدها.", selectEmployee: "اختر الموظف", selectSupplier: "اختر المورد", selectCategory: "اختر البند", selectVault: "اختر الخزينة", invoiceNumber: "رقم فاتورة المورد", invoiceMissingReason: "سبب عدم وجود الفاتورة", taxable: "خاضعة للضريبة", overview: "نظرة الموارد البشرية", payrollPending: "هذا المسار سيبنى بعد اعتماد سياسة الرواتب؛ لا يُسجل كخدمة موظف.", iqama: "تجديد إقامة", transfer: "نقل كفالة", visa: "تأشيرة خروج وعودة", ticket: "تذكرة سفر", medical: "تأمين طبي", health: "شهادة صحية", other: "خدمة أخرى", draft: "مسودة", issued: "صادرة", cancelled: "ملغاة", serviceCost: "تكلفة خدمة", payrollAccrual: "استحقاق راتب", payrollPayment: "سداد راتب", advanceIssued: "سلفة موظف", advanceSettlement: "تسوية سلفة", employeeServiceHint: "تسجل الخدمة أولاً، ثم تصدر تكلفتها كمصروف مستقل مرتبط بملف الموظف.", advances: "السلف", deductions: "الخصومات", administrativeDeductions: "الخصومات الإدارية", addAdministrativeDeduction: "إضافة خصم إداري", deductionDescription: "سبب الخصم", deductionNumber: "رقم الخصم", plannedPayrollDate: "موعد تطبيقه في الرواتب", deductionSaved: "تم حفظ الخصم الإداري؛ لن يؤثر مالياً حتى تطبيقه في الرواتب.", deductionDeferred: "تم تأجيل الخصم الإداري للموعد المحدد.", deductionCancelled: "تم إلغاء الخصم الإداري وحفظ السبب.", deferDeduction: "تأجيل الخصم", cancelDeduction: "إلغاء الخصم", addAdvance: "إصدار سلفة", settleAdvance: "سداد السلفة", deferAdvance: "تأجيل الرصيد", nextSettlementDate: "موعد التحصيل التالي", deferralReason: "سبب التأجيل", settlementAmount: "مبلغ السداد", settlementSaved: "تم تسجيل سداد السلفة وتحديث رصيدها.", deferralSaved: "تم تأجيل موعد تحصيل الرصيد المتبقي.", advanceNumber: "رقم السلفة", originalAmount: "مبلغ السلفة", remainingAmount: "الرصيد المتبقي", advanceSaved: "تم إصدار السلفة وقيدها كذمة على الموظف.", advancePolicy: "السلفة ذمة على الموظف؛ الخصم الإداري أو التأديبي ليس تسويةً للسلفة.", advancePending: "تسوية السلفة عبر مسير الرواتب ستضاف لاحقاً؛ أما السداد المباشر أو تأجيل الرصيد فمساران مستقلان ومتاحان هنا.",
    editEmployee: "تعديل الموظف",
    englishName: "الاسم بالإنجليزية",
    terminationDate: "تاريخ انتهاء الخدمة",
    deductionOpen: "مفتوح",
    deductionPartiallyApplied: "مطبق جزئياً",
    deductionApplied: "مطبق",
    deductionDeferredStatus: "مؤجل",
    salaryIncrease: "زيادة راتب",
    salaryDecrease: "تخفيض راتب",
    promotionSalaryIncrease: "ترقية وزيادة راتب",
    initialSalaryOrEdit: "الراتب الأول / تعديل",
    monthlyPayroll: "راتب الشهر",
    compensationRequiredForSalaryLetter: "يمكن إصدار شهادة خدمة الآن. أما خطاب تعريف الراتب فيحتاج راتباً سارياً.",
    setSalary: "تحديد الراتب",
    employeePhotoLoadFailed: "تعذر تحميل صورة الموظف.",
    employeePhotoSaveFailed: "تعذر حفظ صورة الموظف.",
    loadingPayrollSettlements: "جارٍ تحميل الرواتب والتسويات…",
    loadingLeaveHistory: "جارٍ تحميل سجل الإجازات…",
    loadingServicesCompliance: "جارٍ تحميل الخدمات والامتثال…",
  },
  en: {
    title: "Human resources", employees: "Employees", services: "Residencies & services", employeeFile: "Employee file", addEmployee: "Add employee", addService: "Add service", loading: "Loading HR data…", noEmployees: "No employees are registered for this company.", noServices: "No services are recorded.", noMovements: "No financial movements exist for this employee.", employeeNumber: "Employee no.", employeeName: "Employee", jobTitle: "Profession", status: "Status", hireDate: "Joining date", monthlySalary: "Monthly salary", email: "Email", phone: "Phone", notes: "Notes", save: "Save", cancel: "Cancel", active: "Active", onLeave: "On leave", terminated: "Terminated", archived: "Archived", serviceType: "Service type", referenceNumber: "Reference no.", issueDate: "Issue date", expiryDate: "Expiry date", supplier: "Supplier", financialCategory: "Financial category", serviceSaved: "Employee service saved.", employeeSaved: "Employee saved.", employeeUpdated: "Employee file updated.", financialRecord: "Employee financial record", movementType: "Movement type", date: "Date", amount: "Amount", sourceReference: "Source reference", loadMore: "Load more", personalDetails: "Employee details", createEmployee: "Create employee", createService: "Create service", issueServiceCost: "Issue service cost", serviceCostIssued: "Service cost was issued and posted.", selectEmployee: "Select employee", selectSupplier: "Select supplier", selectCategory: "Select category", selectVault: "Select vault", invoiceNumber: "Supplier invoice no.", invoiceMissingReason: "Invoice missing reason", taxable: "Taxable", overview: "HR overview", payrollPending: "This workflow will be built after the payroll policy is approved; it is not an employee service.", iqama: "Iqama renewal", transfer: "Sponsorship transfer", visa: "Exit/re-entry visa", ticket: "Flight ticket", medical: "Medical insurance", health: "Health certificate", other: "Other service", draft: "Draft", issued: "Issued", cancelled: "Cancelled", serviceCost: "Service cost", payrollAccrual: "Payroll accrual", payrollPayment: "Payroll payment", advanceIssued: "Employee advance", advanceSettlement: "Advance settlement", employeeServiceHint: "Record the service first, then issue its cost as a separate expense linked to the employee file.", advances: "Advances", deductions: "Deductions", administrativeDeductions: "Administrative deductions", addAdministrativeDeduction: "Add administrative deduction", deductionDescription: "Deduction reason", deductionNumber: "Deduction no.", plannedPayrollDate: "Planned payroll date", deductionSaved: "The administrative deduction was saved; it has no financial effect until payroll applies it.", deductionDeferred: "The administrative deduction was deferred to the selected date.", deductionCancelled: "The administrative deduction was cancelled and its reason was recorded.", deferDeduction: "Defer deduction", cancelDeduction: "Cancel deduction", addAdvance: "Issue advance", settleAdvance: "Record repayment", deferAdvance: "Defer balance", nextSettlementDate: "Next collection date", deferralReason: "Deferral reason", settlementAmount: "Repayment amount", settlementSaved: "The advance repayment was recorded and its balance updated.", deferralSaved: "The remaining balance collection date was deferred.", advanceNumber: "Advance no.", originalAmount: "Advance amount", remainingAmount: "Remaining balance", advanceSaved: "The employee advance was issued and posted as a receivable.", advancePolicy: "An advance is receivable from the employee; an administrative or disciplinary deduction never settles it.", advancePending: "Payroll settlement will be added later; direct repayment and balance deferral are separate workflows available here.",
    editEmployee: "Edit employee",
    englishName: "English name",
    terminationDate: "Termination date",
    deductionOpen: "Open",
    deductionPartiallyApplied: "Partially applied",
    deductionApplied: "Applied",
    deductionDeferredStatus: "Deferred",
    salaryIncrease: "Salary increase",
    salaryDecrease: "Salary decrease",
    promotionSalaryIncrease: "Promotion and salary increase",
    initialSalaryOrEdit: "Initial salary / edit",
    monthlyPayroll: "Monthly payroll",
    compensationRequiredForSalaryLetter: "You can issue a service certificate now. Set the current salary before issuing a salary certificate.",
    setSalary: "Set salary",
    employeePhotoLoadFailed: "Employee photo could not be loaded.",
    employeePhotoSaveFailed: "Employee photo could not be saved.",
    loadingPayrollSettlements: "Loading payroll and settlements…",
    loadingLeaveHistory: "Loading leave history…",
    loadingServicesCompliance: "Loading services and compliance…",
  },
} as const;

export function hrText(language: "ar" | "en"): HrCopy { return hrCopy[language]; }

const enumLabels = {
  ar: {
    IQAMA_ISSUANCE: "إصدار إقامة", IQAMA_RENEWAL: "تجديد إقامة", SPONSORSHIP_TRANSFER: "نقل كفالة", EXIT_REENTRY_VISA: "تأشيرة خروج وعودة", FLIGHT_TICKET: "تذكرة سفر", MEDICAL_INSURANCE: "تأمين طبي", HEALTH_CERTIFICATE: "شهادة صحية", OTHER: "خدمة أخرى",
    SERVICE_COST: "تكلفة خدمة", PAYROLL_ACCRUAL: "استحقاق راتب", PAYROLL_PAYMENT: "سداد راتب", ADVANCE_ISSUED: "إصدار سلفة", ADVANCE_SETTLEMENT: "تسوية سلفة", FINAL_SETTLEMENT_ACCRUAL: "استحقاق مخالصة", FINAL_SETTLEMENT_PAYMENT: "سداد مخالصة",
    DRAFT: "مسودة", APPROVED: "معتمد", PARTIALLY_PAID: "مسدد جزئياً", PAID: "مسدد", REVERSED: "ملغى", CANCELLED: "ملغى", ISSUED: "مصدر", PARTIALLY_SETTLED: "مسدد جزئياً", SETTLED: "مسدد", OPEN: "مفتوح", PARTIALLY_APPLIED: "مطبق جزئياً", APPLIED: "مطبق", DEFERRED: "مؤجل",
  },
  en: {
    IQAMA_ISSUANCE: "Iqama issuance", IQAMA_RENEWAL: "Iqama renewal", SPONSORSHIP_TRANSFER: "Sponsorship transfer", EXIT_REENTRY_VISA: "Exit/re-entry visa", FLIGHT_TICKET: "Flight ticket", MEDICAL_INSURANCE: "Medical insurance", HEALTH_CERTIFICATE: "Health certificate", OTHER: "Other service",
    SERVICE_COST: "Service cost", PAYROLL_ACCRUAL: "Payroll accrual", PAYROLL_PAYMENT: "Payroll payment", ADVANCE_ISSUED: "Advance issued", ADVANCE_SETTLEMENT: "Advance settlement", FINAL_SETTLEMENT_ACCRUAL: "Final-settlement accrual", FINAL_SETTLEMENT_PAYMENT: "Final-settlement payment",
    DRAFT: "Draft", APPROVED: "Approved", PARTIALLY_PAID: "Partially paid", PAID: "Paid", REVERSED: "Cancelled", CANCELLED: "Cancelled", ISSUED: "Issued", PARTIALLY_SETTLED: "Partially settled", SETTLED: "Settled", OPEN: "Open", PARTIALLY_APPLIED: "Partially applied", APPLIED: "Applied", DEFERRED: "Deferred",
  },
} as const;

/** One presentation boundary for API enum values used throughout HR. */
export function hrEnumLabel(language: "ar" | "en", value: string): string {
  return (enumLabels[language] as Record<string, string>)[value] ?? value;
}
