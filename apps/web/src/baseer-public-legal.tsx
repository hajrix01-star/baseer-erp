import { useState } from "react";
import { BaseerBrand } from "./baseer-brand";
import { BaseerCard } from "./baseer-card";

export type PublicLegalDocument = "privacy" | "terms";
type Language = "ar" | "en";

type LegalSection = Readonly<{
  title: string;
  paragraphs?: readonly string[];
  items?: readonly string[];
}>;

type LegalCopy = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  updated: string;
  draftNotice: string;
  languageLabel: string;
  arabicLabel: string;
  englishLabel: string;
  switchLanguage: string;
  supportLabel: string;
  otherDocumentLabel: string;
  otherDocumentHref: string;
  sections: readonly LegalSection[];
}>;

const legalCopy: Readonly<Record<PublicLegalDocument, Readonly<Record<Language, LegalCopy>>>> = {
  privacy: {
    ar: {
      eyebrow: "Baseer ERP · الخصوصية",
      title: "سياسة الخصوصية",
      description: "تشرح هذه السياسة كيف يعالج Baseer ERP بيانات التكاملات الاختيارية، ومنها Google Business، عند تفعيلها بموافقة صريحة.",
      updated: "آخر تحديث: 5 سبتمبر 2026",
      draftNotice: "هذه الصفحة توضح حدود معالجة بيانات التكاملات الاختيارية في Baseer ERP.",
      languageLabel: "اللغة",
      arabicLabel: "العربية",
      englishLabel: "English",
      switchLanguage: "English",
      supportLabel: "الدعم: arz1.restaurant@gmail.com",
      otherDocumentLabel: "شروط الاستخدام",
      otherDocumentHref: "/terms",
      sections: [
        { title: "نطاق السياسة", paragraphs: ["تنطبق هذه السياسة على صفحات Baseer ERP العامة وعلى التكاملات التي يفعّلها مالك الشركة من داخل النظام. لا تبدأ الصفحات العامة جلسة ERP ولا تطلب بيانات تسجيل الدخول."] },
        { title: "البيانات التي قد نعالجها", items: ["بيانات تعريف حساب Google والصلاحيات التي يوافق عليها المستخدم صراحة.", "معرفات حسابات ومواقع Google Business التي يختارها المستخدم صراحةً.", "بيانات أداء أو مراجعات Google Business ضمن حدود Google وسياسات الاحتفاظ المعتمدة.", "سجلات تدقيق منقحة عن نجاح الاتصال أو فشله؛ لا تحتوي token أو client secret أو نص مراجعة كامل."] },
        { title: "الغرض والحدود", items: ["عرض مؤشرات السمعة والأداء بشكل مفهوم، مع فصلها عن الحقائق المالية وقيود ERP.", "إتاحة اختيار حساب أو موقع Google Business صراحةً؛ لا نختار مورداً تلقائياً بالاسم.", "الحفاظ على Google Ads للقراءة فقط؛ لا ننشئ حملات أو نغيّر إنفاقاً أو ميزانية.", "لا ينشر Baseer رداً آلياً على تقييم إلا وفق سياسة معتمدة وموافقة صريحة خاصة بالموقع."] },
        { title: "الحماية والاحتفاظ", paragraphs: ["تُعالج أسرار OAuth والتفويضات على الخادم فقط وبعزل الشركة وتشفير مناسب. لا تُعرض في المتصفح أو السجل أو واجهة المستخدم.", "لا ننقل refresh tokens من التطبيق السابق. يعاد التفويض لكل شركة. ويُحدّ محتوى مراجعات Google المخزن مؤقتاً بالمدة التي تسمح بها سياسات Google، مع فصل سجل التدقيق عن النص."] },
        { title: "التحكم والحقوق", paragraphs: ["يمكن لمالك الشركة فصل التكامل وإيقافه. عند الفصل يوقف Baseer استخدام التفويض وفق مسار الإبطال المعتمد. لطلبات الخصوصية أو الدعم تواصل عبر arz1.restaurant@gmail.com."] },
      ],
    },
    en: {
      eyebrow: "Baseer ERP · Privacy",
      title: "Privacy Policy",
      description: "This policy explains how Baseer ERP handles optional integration data, including Google Business data, when an owner explicitly enables it.",
      updated: "Last updated: 5 September 2026",
      draftNotice: "This page explains the boundaries for processing optional integration data in Baseer ERP.",
      languageLabel: "Language",
      arabicLabel: "العربية",
      englishLabel: "English",
      switchLanguage: "العربية",
      supportLabel: "Support: arz1.restaurant@gmail.com",
      otherDocumentLabel: "Terms of Use",
      otherDocumentHref: "/terms",
      sections: [
        { title: "Scope", paragraphs: ["This policy applies to Baseer ERP public pages and integrations enabled by a company owner inside the system. Public pages do not start an ERP session or request sign-in data."] },
        { title: "Data we may process", items: ["Google account identity and permissions expressly granted by the user.", "Google Business account and location identifiers explicitly selected by the user.", "Google Business performance or review data within Google policy and approved retention limits.", "Redacted audit records of connection success or failure; they never contain a token, client secret, or a full review text."] },
        { title: "Purpose and limits", items: ["Present reputation and performance indicators clearly, separately from financial facts and ERP journal entries.", "Let a user explicitly choose a Google Business account or location; Baseer does not match a resource by name automatically.", "Keep Google Ads read-only; Baseer does not create campaigns or change spend or budgets.", "Never publish an automated review reply without an approved policy and express, location-specific consent."] },
        { title: "Protection and retention", paragraphs: ["OAuth secrets and grants are handled server-side only, with company isolation and appropriate encryption. They are not displayed in the browser, logs, or user interface.", "Baseer does not import refresh tokens from the legacy application. Each company authorizes again. Cached Google review content is limited to the period allowed by Google policy, separately from audit records."] },
        { title: "Control and rights", paragraphs: ["A company owner can disconnect and stop an integration. Once disconnected, Baseer stops using the authorization through its approved revocation path. For privacy requests or support, contact arz1.restaurant@gmail.com."] },
      ],
    },
  },
  terms: {
    ar: {
      eyebrow: "Baseer ERP · الشروط",
      title: "شروط الاستخدام",
      description: "تحدد هذه الشروط الحدود التشغيلية لاستخدام Baseer ERP وتكاملاته الاختيارية مع Google.",
      updated: "آخر تحديث: 5 سبتمبر 2026",
      draftNotice: "توضح هذه الصفحة حدود استخدام التكاملات الاختيارية في Baseer ERP.",
      languageLabel: "اللغة",
      arabicLabel: "العربية",
      englishLabel: "English",
      switchLanguage: "English",
      supportLabel: "الدعم: arz1.restaurant@gmail.com",
      otherDocumentLabel: "سياسة الخصوصية",
      otherDocumentHref: "/privacy",
      sections: [
        { title: "الاستخدام المصرح", paragraphs: ["يستخدم Baseer ERP موظفون وملاك مخولون لإدارة عمليات شركتهم. يلتزم كل مستخدم بصلاحياته وبالسياسات المعتمدة لدى جهته."] },
        { title: "ربط Google", items: ["ربط Google Business اختياري ويتم بموافقة المستخدم المخول واختياره الصريح للحساب أو الموقع.", "لا يجوز مشاركة التفويض أو استخدامه لشركة أخرى أو نقل token من تطبيق سابق.", "يبقى Google Ads في Baseer للقراءة فقط؛ لا يسمح النظام بتعديل حملات أو ميزانيات أو عروض أسعار."] },
        { title: "المراجعات والردود", paragraphs: ["الرد الآلي ليس مفعلاً افتراضياً. لا يعمل إلا ضمن سياسة سمعة معتمدة وموافقة صريحة محددة للموقع، مع إحالة التقييمات الحساسة للمراجعة البشرية حسب السياسة."] },
        { title: "المحتوى والمسؤولية", paragraphs: ["تظل بيانات Google خاضعة لشروط Google وسياساتها. مؤشرات Baseer تشرح بيانات المزوّد ولا تمثل وحدها قيداً مالياً أو التزاماً أو قراراً محاسبياً. يتحقق المستخدم المخول من القرارات التجارية قبل تنفيذها."] },
        { title: "التغييرات والتواصل", paragraphs: ["يسجل Baseer التغييرات الجوهرية في هذه الوثيقة قبل سريانها. للتواصل بشأن الشروط أو الدعم استخدم arz1.restaurant@gmail.com."] },
      ],
    },
    en: {
      eyebrow: "Baseer ERP · Terms",
      title: "Terms of Use",
      description: "These terms define the operational boundaries for using Baseer ERP and its optional Google integrations.",
      updated: "Last updated: 5 September 2026",
      draftNotice: "This page explains the boundaries for using optional integrations in Baseer ERP.",
      languageLabel: "Language",
      arabicLabel: "العربية",
      englishLabel: "English",
      switchLanguage: "العربية",
      supportLabel: "Support: arz1.restaurant@gmail.com",
      otherDocumentLabel: "Privacy Policy",
      otherDocumentHref: "/privacy",
      sections: [
        { title: "Authorized use", paragraphs: ["Baseer ERP is used by authorized employees and owners to manage their company's operations. Each user must act within assigned permissions and their organization's approved policies."] },
        { title: "Connecting Google", items: ["Google Business connection is optional and requires an authorized user's consent and explicit account or location selection.", "An authorization must not be shared, used for another company, or transferred from a legacy application.", "Google Ads remains read-only in Baseer; the system does not change campaigns, budgets, or bids."] },
        { title: "Reviews and replies", paragraphs: ["Automated replies are not enabled by default. They may operate only under an approved reputation policy and explicit, location-specific consent, with sensitive ratings routed for human review under that policy."] },
        { title: "Content and responsibility", paragraphs: ["Google data remains subject to Google terms and policies. Baseer indicators explain provider data; they do not by themselves create a financial posting, obligation, or accounting decision. An authorized user must validate business decisions before acting on them."] },
        { title: "Changes and contact", paragraphs: ["Baseer records material changes to this document before they take effect. For terms questions or support, use arz1.restaurant@gmail.com."] },
      ],
    },
  },
};

export function publicLegalDocumentForPathname(pathname: string): PublicLegalDocument | null {
  const normalised = pathname.replace(/\/+$/, "") || "/";
  if (normalised === "/privacy") return "privacy";
  if (normalised === "/terms") return "terms";
  return null;
}

export function BaseerPublicLegalPage({ document }: Readonly<{ document: PublicLegalDocument }>) {
  const [language, setLanguage] = useState<Language>("ar");
  const copy = legalCopy[document][language];
  const direction = language === "ar" ? "rtl" : "ltr";

  return <main className="baseer-public-legal" dir={direction} lang={language}>
    <header className="baseer-public-legal__header">
      <a className="baseer-public-legal__brand" href="/" aria-label="Baseer ERP"><BaseerBrand /></a>
      <div className="baseer-public-legal__language" aria-label={copy.languageLabel}>
        <button type="button" aria-pressed={language === "ar"} onClick={() => setLanguage("ar")}>{copy.arabicLabel}</button>
        <button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>{copy.englishLabel}</button>
      </div>
    </header>

    <div className="baseer-public-legal__content">
      <BaseerCard className="baseer-public-legal__hero" variant="surface" contextIcon={false}>
        <p className="baseer-public-legal__eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="baseer-public-legal__description">{copy.description}</p>
        <p className="baseer-public-legal__updated">{copy.updated}</p>
      </BaseerCard>

      <aside className="baseer-public-legal__notice" role="note">{copy.draftNotice}</aside>

      <article className="baseer-public-legal__document" aria-label={copy.title}>
        {copy.sections.map((section) => <section key={section.title}>
          <h2>{section.title}</h2>
          {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {section.items ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        </section>)}
      </article>

      <footer className="baseer-public-legal__footer">
        <a href="mailto:arz1.restaurant@gmail.com">{copy.supportLabel}</a>
        <a href={copy.otherDocumentHref}>{copy.otherDocumentLabel}</a>
        <button type="button" onClick={() => setLanguage(language === "ar" ? "en" : "ar")}>{copy.switchLanguage}</button>
      </footer>
    </div>
  </main>;
}
