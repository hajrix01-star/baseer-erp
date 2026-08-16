import {
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  createAdministrationUser,
  resetAdministrationUserPassword,
  updateAdministrationUserStatus,
  withdrawAdministrationMembership,
} from "./administration-client";
import {
  AdministrationUserAvatar,
  type UserAvatarKind,
} from "./administration-user-avatar";
import type { AdministrationOverview } from "./administration-types";
import type { ActiveSession } from "./daily-sales-client";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";

type Props = {
  session: ActiveSession;
  overview: AdministrationOverview;
  owner: boolean;
  onDone: () => Promise<void>;
  onError: (error: unknown) => void;
};
type User = AdministrationOverview["users"][number];
type DialogMode = "create" | "manage" | null;

export function AdministrationUsersPanel({
  session,
  overview,
  owner,
  onDone,
  onError,
}: Props) {
  const [mode, setMode] = useState<DialogMode>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selectedUser =
    overview.users.find((user) => user.id === selectedUserId) ?? null;
  const close = () => {
    setMode(null);
    setSelectedUserId(null);
  };
  const openUser = (user: User) => {
    setSelectedUserId(user.id);
    setMode("manage");
  };

  return (
    <section className="administration-section administration-users-section">
      <header className="administration-section-heading">
        <div>
          <h3>المستخدمون</h3>
          <p>
            اختر بطاقة المستخدم لعرض وصوله وإدارته. تعطيل المستخدم ينهي جلساته
            النشطة فوراً.
          </p>
        </div>
        {owner && (
          <button
            className="daily-sales-primary"
            type="button"
            onClick={() => setMode("create")}
          >
            + إضافة موظف
          </button>
        )}
      </header>
      <div className="administration-user-cards">
        {overview.users.map((user) => (
          <button
            className="administration-user-card"
            type="button"
            key={user.id}
            onClick={() => openUser(user)}
          >
            <AdministrationUserAvatar
              name={user.nameAr}
              kind={user.avatarKind}
              large
            />
            <span className="administration-user-card__body">
              <strong>{user.nameAr}</strong>
              <small>{user.nameEn}</small>
              <span>{user.login}</span>
              <em
                className={
                  user.status === "ACTIVE" ? "is-active" : "is-disabled"
                }
              >
                {user.status === "ACTIVE" ? "نشط" : "مُعطّل"}
              </em>
            </span>
            <span className="administration-user-card__access">
              {user.memberships.length
                ? `${user.memberships.length} شركة`
                : "غير مرتبط بشركة"}{" "}
              ←
            </span>
          </button>
        ))}
      </div>
      {mode === "create" && (
        <CreateUserDialog
          session={session}
          overview={overview}
          onDone={onDone}
          onError={onError}
          onClose={close}
        />
      )}
      {mode === "manage" && selectedUser && (
        <ManageUserDialog
          session={session}
          user={selectedUser}
          owner={owner}
          onDone={onDone}
          onError={onError}
          onClose={close}
        />
      )}
    </section>
  );
}

function CreateUserDialog({
  session,
  overview,
  onDone,
  onError,
  onClose,
}: Pick<Props, "session" | "overview" | "onDone" | "onError"> & {
  onClose: () => void;
}) {
  const [login, setLogin] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [password, setPassword] = useState("");
  const [companyId, setCompanyId] = useState(overview.companies[0]?.id ?? "");
  const [roleId, setRoleId] = useState(overview.roles[0]?.id ?? "");
  const [avatarKind, setAvatarKind] = useState<UserAvatarKind>("INITIALS");
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogFocusTrap({ open: true, saving: busy, onClose });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await createAdministrationUser(session, {
        login,
        nameAr,
        nameEn,
        password,
        companyId,
        roleId,
        avatarKind,
      });
      await onDone();
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="إضافة موظف"
      intro="أنشئ دخوله، ثم حدّد الشركة والدور. الصلاحيات الفعلية يفحصها الخادم لكل طلب."
      busy={busy}
      dialogRef={dialogRef}
      onClose={onClose}
    >
      <form
        className="administration-dialog-form"
        onSubmit={(event) => void save(event)}
      >
        <AvatarPicker
          value={avatarKind}
          onChange={setAvatarKind}
          previewName={nameAr || "الموظف"}
        />
        <label>
          اسم المستخدم أو البريد الإلكتروني
          <input
            required
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            placeholder="ahmed أو ahmed@example.com"
            autoComplete="username"
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
        <label>
          كلمة المرور الأولية
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
          <small>6 خانات على الأقل، بأي مزيج تختاره.</small>
        </label>
        <label>
          الشركة
          <select
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
          >
            {overview.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.nameAr}
              </option>
            ))}
          </select>
        </label>
        <label>
          الدور
          <select
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
          >
            {overview.roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.nameAr}
              </option>
            ))}
          </select>
        </label>
        <footer>
          <button
            className="daily-sales-secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            إلغاء
          </button>
          <button className="daily-sales-primary" disabled={busy}>
            {busy ? "جارٍ الحفظ…" : "حفظ الموظف"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function ManageUserDialog({
  session,
  user,
  owner,
  onDone,
  onError,
  onClose,
}: {
  session: ActiveSession;
  user: User;
  owner: boolean;
  onDone: () => Promise<void>;
  onError: (error: unknown) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [replacementPassword, setReplacementPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogFocusTrap({ open: true, saving: busy, onClose });
  const run = async (action: () => Promise<unknown>) => {
    if (!owner || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await action();
      setReason("");
      setReplacementPassword("");
      await onDone();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={user.nameAr}
      intro="بطاقة وصول المستخدم. كل تغيير حساس يحتاج سبباً موثقاً وينهي الجلسات عند الحاجة."
      busy={busy}
      dialogRef={dialogRef}
      onClose={onClose}
    >
      <section className="administration-user-profile">
        <AdministrationUserAvatar
          name={user.nameAr}
          kind={user.avatarKind}
          large
        />
        <div>
          <strong>{user.nameAr}</strong>
          <span>{user.login}</span>
          <em
            className={user.status === "ACTIVE" ? "is-active" : "is-disabled"}
          >
            {user.status === "ACTIVE" ? "نشط" : "مُعطّل"}
          </em>
        </div>
      </section>
      <div className="administration-dialog-form">
        <label>
          سبب التغيير
          <input
            minLength={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="مثال: تعديل تكليف العمل"
          />
        </label>
        <fieldset className="administration-access-list">
          <legend>الوصول إلى الشركات</legend>
          {user.memberships.length ? (
            user.memberships.map((membership) => (
              <div key={membership.companyId}>
                <span>
                  <strong>{membership.companyNameAr}</strong>
                  <small>{membership.roleNameAr}</small>
                </span>
                {owner && (
                  <button
                    className="daily-sales-danger"
                    disabled={busy || reason.trim().length < 3}
                    type="button"
                    onClick={() =>
                      void run(() =>
                        withdrawAdministrationMembership(
                          session,
                          user.id,
                          membership.companyId,
                          reason,
                        ),
                      )
                    }
                  >
                    سحب الوصول
                  </button>
                )}
              </div>
            ))
          ) : (
            <p>لا توجد شركات مرتبطة بهذا المستخدم.</p>
          )}
        </fieldset>
        {owner && (
          <section className="administration-sensitive-actions">
            <button
              className="daily-sales-secondary"
              disabled={busy || reason.trim().length < 3}
              type="button"
              onClick={() =>
                void run(() =>
                  updateAdministrationUserStatus(
                    session,
                    user.id,
                    user.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                    reason,
                  ),
                )
              }
            >
              {user.status === "ACTIVE" ? "تعطيل المستخدم" : "تفعيل المستخدم"}
            </button>
            {user.status === "ACTIVE" && (
              <>
                <label>
                  كلمة مرور جديدة
                  <input
                    type="password"
                    minLength={6}
                    value={replacementPassword}
                    onChange={(event) =>
                      setReplacementPassword(event.target.value)
                    }
                    placeholder="6 خانات على الأقل"
                  />
                </label>
                <button
                  className="daily-sales-secondary"
                  disabled={
                    busy ||
                    reason.trim().length < 3 ||
                    replacementPassword.length < 6
                  }
                  type="button"
                  onClick={() =>
                    void run(() =>
                      resetAdministrationUserPassword(
                        session,
                        user.id,
                        replacementPassword,
                        reason,
                      ),
                    )
                  }
                >
                  إعادة ضبط كلمة المرور
                </button>
              </>
            )}
          </section>
        )}
        <footer>
          <button
            className="daily-sales-secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            إغلاق
          </button>
        </footer>
      </div>
    </Dialog>
  );
}

function AvatarPicker({
  value,
  onChange,
  previewName,
}: {
  value: UserAvatarKind;
  onChange: (value: UserAvatarKind) => void;
  previewName: string;
}) {
  return (
    <fieldset className="administration-avatar-picker">
      <legend>الصورة الرمزية</legend>
      <div>
        {(["INITIALS", "MALE", "FEMALE"] as const).map((kind) => (
          <button
            className={value === kind ? "is-selected" : ""}
            key={kind}
            type="button"
            onClick={() => onChange(kind)}
          >
            <AdministrationUserAvatar name={previewName} kind={kind} large />
            <span>
              {kind === "INITIALS"
                ? "حرف الاسم"
                : kind === "MALE"
                  ? "رجل"
                  : "امرأة"}
            </span>
          </button>
        ))}
      </div>
      <small>
        رفع صورة شخصية سيُتاح بعد تشغيل خدمة الملفات والتخزين الآمن؛ لا نخزن
        الصورة في المتصفح.
      </small>
    </fieldset>
  );
}

function Dialog({
  title,
  intro,
  busy,
  dialogRef,
  onClose,
  children,
}: {
  title: string;
  intro: string;
  busy: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <div
      className="daily-sales-dialog-backdrop"
      role="presentation"
      onMouseDown={close}
    >
      <section
        ref={dialogRef}
        className="daily-sales-dialog administration-user-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="daily-sales-dialog__header">
          <div>
            <p className="eyebrow">إدارة المستخدمين</p>
            <h3>{title}</h3>
            <p>{intro}</p>
          </div>
          <button
            className="daily-sales-secondary"
            type="button"
            onClick={close}
            disabled={busy}
          >
            إغلاق
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
