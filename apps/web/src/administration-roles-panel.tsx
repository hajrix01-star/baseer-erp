import { useState, type FormEvent } from "react";

import { createAdministrationRole } from "./administration-client";
import type { AdministrationOverview } from "./administration-types";
import type { ActiveSession } from "./daily-sales-client";

type Props = {
  session: ActiveSession;
  overview: AdministrationOverview;
  owner: boolean;
  onDone: () => Promise<void>;
  onError: (error: unknown) => void;
};
type Permission = AdministrationOverview["permissions"][number];
type PermissionSection = { title: string; match: (code: string) => boolean };
const permissionModules: ReadonlyArray<{
  key: string;
  title: string;
  sections: readonly PermissionSection[];
}> = [
  {
    key: "administration",
    title: "الإدارة",
    sections: [
      {
        title: "الشركات",
        match: (code) => code.startsWith("administration.companies"),
      },
      {
        title: "المستخدمون",
        match: (code) => code.startsWith("administration.users"),
      },
      {
        title: "الأدوار والصلاحيات",
        match: (code) => code.startsWith("administration.roles"),
      },
    ],
  },
  {
    key: "finance",
    title: "المالية",
    sections: [
      {
        title: "التهيئة والبيانات الأساسية",
        match: (code) => /finance\.(setup|configuration|foundation)/.test(code),
      },
      {
        title: "الفترات والخزائن",
        match: (code) => /finance\.(periods|vaults)/.test(code),
      },
      {
        title: "الموردون والالتزامات",
        match: (code) => /finance\.(suppliers|supplier_dues)/.test(code),
      },
      { title: "القروض", match: (code) => code.startsWith("finance.loans") },
    ],
  },
  {
    key: "operations",
    title: "العمليات والمبيعات",
    sections: [
      {
        title: "سجل المبيعات",
        match: (code) => /finance\.daily_sales\.(read|history)/.test(code),
      },
      {
        title: "تقفيل المبيعات",
        match: (code) =>
          /finance\.daily_sales\.(create|correct|reverse|write)/.test(code),
      },
      {
        title: "تقويم التشغيل",
        match: (code) => code.startsWith("finance.operational_calendar"),
      },
    ],
  },
  {
    key: "platform",
    title: "المنصة",
    sections: [
      {
        title: "الملفات والمستندات",
        match: (code) => code.startsWith("platform.files"),
      },
      {
        title: "التشغيل والتاريخ",
        match: (code) => /platform\.(business-date|observability)/.test(code),
      },
      {
        title: "الطباعة والتصدير",
        match: (code) => code.startsWith("platform.output"),
      },
    ],
  },
  {
    key: "ai",
    title: "بصيرة والذكاء",
    sections: [
      { title: "استخدام بصيرة", match: (code) => code === "platform.ai.use" },
      {
        title: "مزود الذكاء",
        match: (code) => /platform\.ai\.(configuration|provider)/.test(code),
      },
      {
        title: "هوية بصيرة",
        match: (code) => /platform\.ai\.(identity|system_identity)/.test(code),
      },
    ],
  },
];

export function AdministrationRolesPanel({
  session,
  overview,
  owner,
  onDone,
  onError,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setEditing(false);
    setNameAr("");
    setNameEn("");
    setCode("");
    setSelected([]);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!owner) return;
    setBusy(true);
    try {
      await createAdministrationRole(session, {
        code,
        nameAr,
        nameEn,
        permissionCodes: selected,
      });
      await onDone();
      reset();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (code: string, checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...new Set([...current, code])]
        : current.filter((item) => item !== code),
    );
  if (editing)
    return (
      <section className="administration-section administration-role-editor">
        <header className="administration-section-heading">
          <div>
            <p className="eyebrow">الأدوار والصلاحيات</p>
            <h3>إضافة دور مخصص</h3>
            <p>
              حدد الصلاحيات حسب الموديول والقسم. خانات الاختيار لا تمنح أي وصول
              وحدها؛ الخادم يفحصها عند كل طلب.
            </p>
          </div>
          <button
            className="daily-sales-secondary"
            type="button"
            onClick={reset}
            disabled={busy}
          >
            ← العودة إلى الأدوار
          </button>
        </header>
        <form
          className="administration-role-form"
          onSubmit={(event) => void submit(event)}
        >
          <div className="administration-role-basics">
            <label>
              رمز الدور
              <input
                required
                pattern="[A-Z][A-Z0-9_]*"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="CUSTOM_SALES_ROLE"
              />
            </label>
            <label>
              الاسم بالعربية
              <input
                required
                value={nameAr}
                onChange={(event) => setNameAr(event.target.value)}
              />
            </label>
            <label>
              الاسم بالإنجليزية
              <input
                required
                value={nameEn}
                onChange={(event) => setNameEn(event.target.value)}
              />
            </label>
          </div>
          <fieldset className="administration-permission-picker">
            <legend>
              الصلاحيات المحددة <small>{selected.length}</small>
            </legend>
            {permissionModules.map((module) => (
              <PermissionModule
                key={module.key}
                title={module.title}
                sections={module.sections}
                permissions={overview.permissions}
                selected={selected}
                onToggle={toggle}
              />
            ))}
          </fieldset>
          <footer className="administration-role-editor__footer">
            <button
              className="daily-sales-secondary"
              type="button"
              onClick={reset}
              disabled={busy}
            >
              إلغاء
            </button>
            <button
              className="daily-sales-primary"
              disabled={busy || !selected.length}
            >
              {busy ? "جارٍ الحفظ…" : "حفظ الدور"}
            </button>
          </footer>
        </form>
      </section>
    );
  return (
    <section className="administration-section administration-roles-section">
      <header className="administration-section-heading">
        <div>
          <h3>الأدوار والصلاحيات</h3>
          <p>
            القوالب النظامية محمية. أضف دوراً مخصصاً عندما تحتاج صلاحيات مختلفة
            لموظف أو فريق.
          </p>
        </div>
        {owner && (
          <button
            className="daily-sales-primary"
            type="button"
            onClick={() => setEditing(true)}
          >
            + إضافة دور
          </button>
        )}
      </header>
      <div className="administration-role-cards">
        {overview.roles.map((role) => (
          <article key={role.id}>
            <span
              className={
                role.isSystem
                  ? "administration-role-card__system"
                  : "administration-role-card__custom"
              }
            >
              {role.isSystem ? "قالب نظام" : "دور مخصص"}
            </span>
            <strong>{role.nameAr}</strong>
            <small>{role.nameEn}</small>
            <p>{role.permissionCodes.length} صلاحية مفعلة</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PermissionModule({
  title,
  sections,
  permissions,
  selected,
  onToggle,
}: {
  title: string;
  sections: readonly PermissionSection[];
  permissions: Permission[];
  selected: string[];
  onToggle: (permissionCode: string, checked: boolean) => void;
}) {
  const visible = sections
    .map((section) => ({
      ...section,
      permissions: permissions.filter((permission) =>
        section.match(permission.code),
      ),
    }))
    .filter((section) => section.permissions.length > 0);
  if (!visible.length) return null;
  const count = visible.reduce(
    (total, section) => total + section.permissions.length,
    0,
  );
  return (
    <section className="administration-permission-module">
      <header>
        <h5>{title}</h5>
        <span>{count} صلاحية</span>
      </header>
      <div className="administration-permission-sections">
        {visible.map((section) => (
          <section
            className="administration-permission-section"
            key={section.title}
          >
            <h6>{section.title}</h6>
            <div>
              {section.permissions.map((permission) => (
                <label
                  key={permission.code}
                  className={
                    permission.risk === "sensitive" ? "is-sensitive" : ""
                  }
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(permission.code)}
                    onChange={(event) =>
                      onToggle(permission.code, event.target.checked)
                    }
                  />
                  <span>{permission.nameAr}</span>
                  {permission.risk === "sensitive" && <small>حساس</small>}
                </label>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
