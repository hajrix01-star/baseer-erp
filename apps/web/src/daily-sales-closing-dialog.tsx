import { type FormEvent } from "react";

import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";
import { BaseerDatePicker } from "./baseer-date-picker";
import { iso, riyadhToday } from "./baseer-period-filter";
import { formatMoney } from "./number-format";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";
import { useDailySalesPreview } from "./use-daily-sales-preview";
import type {
  ActiveSession,
  Closing,
  DailySalesEntryMode,
  DailySalesScope,
  DailySalesShiftForms,
  DayOffReason,
  FormState,
  Vault,
} from "./daily-sales-client";

type Props = {
  language: DailySalesLanguage;
  open: boolean;
  editing: Closing | null;
  vaults: Vault[];
  forms: DailySalesShiftForms;
  selectedScopes: readonly DailySalesScope[];
  session: ActiveSession | null;
  mode: DailySalesEntryMode;
  dayOffReason: DayOffReason;
  dayOffNote: string;
  saving: boolean;
  maxBusinessDate?: string;
  allowDayOff: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFormsChange: (forms: DailySalesShiftForms) => void;
  onSelectedScopesChange: (scopes: DailySalesScope[]) => void;
  onModeChange: (mode: DailySalesEntryMode) => void;
  onDayOffReasonChange: (reason: DayOffReason) => void;
  onDayOffNoteChange: (note: string) => void;
};

const scopeOrder: DailySalesScope[] = ["MORNING", "EVENING", "ALL"];

function ShiftCard({
  language,
  session,
  open,
  form,
  vaults,
  onChange,
}: {
  language: DailySalesLanguage;
  session: ActiveSession | null;
  open: boolean;
  form: FormState;
  vaults: Vault[];
  onChange: (form: FormState) => void;
}) {
  const copy = dailySalesText[language];
  const { preview } = useDailySalesPreview({
    open,
    session,
    mode: "CLOSING",
    form,
  });
  const updateAmount = (vaultId: string, grossAmount: string) =>
    onChange({
      ...form,
      allocations: form.allocations.map((allocation) =>
        allocation.vaultId === vaultId
          ? { ...allocation, grossAmount }
          : allocation,
      ),
    });
  const title =
    form.scope === "MORNING"
      ? copy.morning
      : form.scope === "EVENING"
        ? copy.evening
        : copy.all;
  const customerCount = Number(form.customerCount) || 0;
  const localGrossAmount = form.allocations.reduce(
    (total, allocation) => total + (Number(allocation.grossAmount) || 0),
    0,
  );
  const displayGrossAmount = preview
    ? Number(preview.grossAmount)
    : localGrossAmount;
  const average =
    customerCount > 0 && displayGrossAmount > 0
      ? displayGrossAmount / customerCount
      : null;

  return (
    <section className="daily-sales-dialog__shift-card">
      <h4>{title}</h4>
      <div className="daily-sales-dialog__entry-fields">
        <label className="daily-sales-dialog__customer-field">
          <span>{copy.customers}</span>
          <input
            type="number"
            min="0"
            step="1"
            value={form.customerCount}
            onChange={(event) =>
              onChange({ ...form, customerCount: event.target.value })
            }
            placeholder={language === "ar" ? "أدخل العدد" : "Enter count"}
            required
          />
        </label>
        <label className="daily-sales-dialog__handover-field">
          <span>{copy.cashHandover}</span>
          <input
            inputMode="decimal"
            value={form.cashHandoverAmount}
            onChange={(event) =>
              onChange({ ...form, cashHandoverAmount: event.target.value })
            }
            placeholder={language === "ar" ? "اختياري" : "Optional"}
          />
        </label>
      </div>
      <fieldset className="daily-sales-dialog__channels">
        <legend>{copy.channels}</legend>
        <div className="daily-sales-dialog__vault-grid">
          {vaults.map((vault) => {
            const allocation = form.allocations.find(
              (item) => item.vaultId === vault.id,
            );
            const name = language === "ar" ? vault.nameAr : vault.nameEn;
            return (
              <label className="daily-sales-dialog__vault" key={vault.id}>
                <span>{name}</span>
                <input
                  aria-label={`${name} ${copy.amount}`}
                  inputMode="decimal"
                  value={allocation?.grossAmount ?? ""}
                  onChange={(event) =>
                    updateAmount(vault.id, event.target.value)
                  }
                  placeholder={
                    language === "ar" ? "أدخل المبلغ" : "Enter amount"
                  }
                />
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className="daily-sales-dialog__wide">
        <span>{copy.notes}</span>
        <textarea
          value={form.notes}
          onChange={(event) => onChange({ ...form, notes: event.target.value })}
          maxLength={2_000}
          placeholder={
            language === "ar"
              ? "أي ملاحظات على مبيعات اليوم…"
              : "Optional notes…"
          }
        />
      </label>
      <output className="daily-sales-dialog__summary" aria-live="polite">
        <span>
          <small>{copy.entryTotal}</small>
          <strong dir="ltr">
            {displayGrossAmount !== null && displayGrossAmount > 0
              ? formatMoney(String(displayGrossAmount))
              : copy.previewUnavailable}
          </strong>
        </span>
        <span>
          <small>{copy.customers}</small>
          <strong>{customerCount || "—"}</strong>
        </span>
        <span>
          <small>
            {language === "ar" ? "معدل العميل" : "Average customer"}
          </small>
          <strong dir="ltr">
            {average === null ? "—" : formatMoney(String(average))}
          </strong>
        </span>
      </output>

    </section>
  );
}
export function DailySalesClosingDialog({
  language,
  open,
  editing,
  vaults,
  forms,
  selectedScopes,
  session,
  mode,
  dayOffReason,
  dayOffNote,
  saving,
  maxBusinessDate,
  allowDayOff,
  onClose,
  onSubmit,
  onFormsChange,
  onSelectedScopesChange,
  onModeChange,
  onDayOffReasonChange,
  onDayOffNoteChange,
}: Props) {
  const copy = dailySalesText[language];
  const dialogRef = useDialogFocusTrap({ open, saving, onClose });
  if (!open) return null;
  const isDayOff = !editing && mode === "DAY_OFF";
  const activeScopes = editing ? [editing.scope] : selectedScopes;
  const businessDate = forms[activeScopes[0] ?? "ALL"].businessDate;
  const today = riyadhToday();
  const maximumEntryDate = maxBusinessDate ?? iso(today.year, today.month, today.day);
  const setDate = (value: string) =>
    onFormsChange({
      ...forms,
      MORNING: { ...forms.MORNING, businessDate: value },
      EVENING: { ...forms.EVENING, businessDate: value },
      ALL: { ...forms.ALL, businessDate: value },
    });
  const setScope = (scope: DailySalesScope) => {
    if (scope === "ALL") return onSelectedScopesChange(["ALL"]);
    const next = selectedScopes.includes(scope)
      ? selectedScopes.filter((item) => item !== scope)
      : [...selectedScopes.filter((item) => item !== "ALL"), scope];
    onSelectedScopesChange(
      next.length ? scopeOrder.filter((item) => next.includes(item)) : [scope],
    );
  };
  const close = () => {
    if (!saving) onClose();
  };

  return (
    <div
      className="daily-sales-dialog-backdrop"
      role="presentation"
      onMouseDown={close}
    >
      <section
        ref={dialogRef}
        className={`daily-sales-dialog daily-sales-dialog--noorix ${activeScopes.length === 2 ? "daily-sales-dialog--batch" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-sales-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="daily-sales-dialog__header">
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h3 id="daily-sales-dialog-title">
              {editing
                ? `${copy.edit}: ${editing.documentNumber}`
                : isDayOff
                  ? copy.dayOffTitle
                  : copy.create}
            </h3>
            <p>{isDayOff ? copy.dayOffIntro : copy.entryIntro}</p>
          </div>
        </header>
        <form className="daily-sales-dialog__form" onSubmit={onSubmit}>
          {!editing && (
            <>
              <div
                className="daily-sales-dialog__mode"
                role="group"
                aria-label={copy.entryMode}
              >
                <button
                  type="button"
                  className={mode === "CLOSING" ? "is-selected" : ""}
                  onClick={() => onModeChange("CLOSING")}
                  disabled={saving}
                >
                  {copy.create}
                </button>
                {allowDayOff && (
                  <button
                    type="button"
                    className={mode === "DAY_OFF" ? "is-selected" : ""}
                    onClick={() => onModeChange("DAY_OFF")}
                    disabled={saving}
                  >
                    {copy.dayOffAction}
                  </button>
                )}
              </div>
              <div className="daily-sales-dialog__date">
                <BaseerDatePicker language={language} label={copy.date} max={maximumEntryDate} value={businessDate} onChange={setDate} disabled={saving} />
              </div>
              {!isDayOff && (
                <fieldset className="daily-sales-dialog__scope-picker">
                  <legend>{copy.scope}</legend>
                  {scopeOrder.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      className={
                        selectedScopes.includes(scope) ? "is-selected" : ""
                      }
                      onClick={() => setScope(scope)}
                      disabled={saving}
                    >
                      {scope === "MORNING"
                        ? copy.morning
                        : scope === "EVENING"
                          ? copy.evening
                          : copy.all}
                    </button>
                  ))}
                </fieldset>
              )}
            </>
          )}
          {isDayOff ? (
            <section className="daily-sales-dialog__day-off">
              <strong>{copy.dayOffNoMoney}</strong>
              <small>{copy.dayOffNoMoneyHint}</small>
              <label>
                <span>{copy.dayOffReason}</span>
                <select
                  value={dayOffReason}
                  onChange={(event) =>
                    onDayOffReasonChange(event.target.value as DayOffReason)
                  }
                >
                  <option value="WEEKLY_CLOSURE">{copy.WEEKLY_CLOSURE}</option>
                  <option value="HOLIDAY">{copy.HOLIDAY}</option>
                  <option value="MAINTENANCE">{copy.MAINTENANCE}</option>
                  <option value="EMERGENCY">{copy.EMERGENCY}</option>
                  <option value="OTHER">{copy.OTHER}</option>
                </select>
              </label>
              <label>
                <span>{copy.dayOffNote}</span>
                <textarea
                  value={dayOffNote}
                  onChange={(event) => onDayOffNoteChange(event.target.value)}
                  maxLength={1_000}
                  required={dayOffReason === "OTHER"}
                />
              </label>
            </section>
          ) : (
            <div className="daily-sales-dialog__shift-stack">
              {activeScopes.map((scope) => (
                <ShiftCard
                  key={scope}
                  language={language}
                  session={session}
                  open={open}
                  form={forms[scope]}
                  vaults={vaults}
                  onChange={(form) =>
                    onFormsChange({ ...forms, [scope]: form })
                  }
                />
              ))}
            </div>
          )}
          <footer className="daily-sales-dialog__actions">
            <button
              className="daily-sales-secondary"
              type="button"
              onClick={close}
              disabled={saving}
            >
              {copy.cancelEdit}
            </button>
            <button
              className="daily-sales-primary"
              disabled={saving}
              type="submit"
            >
              {saving
                ? copy.saving
                : isDayOff
                  ? copy.saveDayOff
                  : editing
                    ? copy.correct
                    : copy.saveAndSend}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
