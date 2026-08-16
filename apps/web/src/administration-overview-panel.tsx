import type { AdministrationOverview } from "./administration-types";

export function AdministrationOverviewPanel({ overview }: { overview: AdministrationOverview }) {
  return <div className="administration-grid">
    <article><span>الشركات النشطة</span><strong>{overview.companies.filter((company) => company.status === "ACTIVE").length}</strong></article>
    <article><span>المستخدمون النشطون</span><strong>{overview.users.filter((user) => user.status === "ACTIVE").length}</strong></article>
    <article><span>الأدوار</span><strong>{overview.roles.length}</strong></article>
    <article><span>صلاحيات معتمدة</span><strong>{overview.permissions.length}</strong></article>
    <section className="administration-wide">
      <h3>قواعد الإدارة</h3>
      <p>المستخدم يرتبط بالشركة عبر دور واضح. الصلاحيات من كتالوج النظام، وتعطيل المستخدم أو سحب عضويته يلغي جلساته فورًا.</p>
    </section>
  </div>;
}