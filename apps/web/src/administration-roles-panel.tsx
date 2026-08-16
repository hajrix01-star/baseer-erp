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
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!owner) return;
    try {
      await createAdministrationRole(session, {
        code,
        nameAr,
        nameEn,
        permissionCodes: selected,
      });
      setNameAr("");
      setNameEn("");
      setCode("");
      setSelected([]);
      await onDone();
    } catch (error) {
      onError(error);
    }
  };
  const togglePermission = (permissionCode: string, checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...current, permissionCode]
        : current.filter((code) => code !== permissionCode),
    );

  return (
    <div className="administration-section">
      <h3>الأدوار والصلاحيات</h3>
      <p className="administration-copy">
        اختر صلاحيات الدور من الموديولات والأقسام أدناه. الصلاحية تُفحص من
        الخادم، وخانة الاختيار لا تمنح وصولًا وحدها.
      </p>
      <div className="administration-list">
        {overview.roles.map((role) => (
          <article key={role.id}>
            <strong>
              {role.nameAr}
              {role.isSystem ? " · قالب نظام" : ""}
            </strong>
            <span>{role.permissionCodes.length} صلاحية</span>
            <small>{role.permissionCodes.join("، ")}</small>
          </article>
        ))}
      </div>
      {owner && (
        <form
          className="administration-form"
          onSubmit={(event) => void submit(event)}
        >
          <h4>دور مخصص</h4>
          <label>
            رمز الدور
            <input
              required
              pattern="[A-Z][A-Z0-9_]*"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            الاسم بالعربي
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
          <fieldset className="administration-permission-picker">
            <legend>
              الصلاحيات حسب الموديول والقسم{" "}
              <small>{selected.length} محددة</small>
            </legend>
            {permissionModules.map((module) => (
              <PermissionModule
                key={module.key}
                title={module.title}
                sections={module.sections}
                permissions={overview.permissions}
                selected={selected}
                onToggle={togglePermission}
              />
            ))}
          </fieldset>
          <button className="daily-sales-primary" disabled={!selected.length}>
            حفظ الدور
          </button>
        </form>
      )}
    </div>
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
  const visibleSections = sections
    .map((section) => ({
      ...section,
      permissions: permissions.filter((permission) =>
        section.match(permission.code),
      ),
    }))
    .filter((section) => section.permissions.length > 0);
  if (!visibleSections.length) return null;
  const count = visibleSections.reduce(
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
        {visibleSections.map((section) => (
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
