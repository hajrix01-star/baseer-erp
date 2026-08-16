import { type FormEvent } from "react";
import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";
import { formatMoney } from "./number-format";
import type {
  Closing,
  DailySalesEntryMode,
  DailySalesPreview,
  DayOffReason,
  FormState,
  Vault,
} from "./daily-sales-client";

type DailySalesClosingDialogProps = {
  language: DailySalesLanguage;
  open: boolean;
  editing: Closing | null;
  vaults: Vault[];
  form: FormState;
  mode: DailySalesEntryMode;
  dayOffReason: DayOffReason;
  dayOffNote: string;
  saving: boolean;
  preview: DailySalesPreview | null;
  previewLoading: boolean;
  maxBusinessDate?: string;
  allowDayOff: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (form: FormState) => void;
  onModeChange: (mode: DailySalesEntryMode) => void;
  onDayOffReasonChange: (reason: DayOffReason) => void;
  onDayOffNoteChange: (note: string) => void;
};

export function DailySalesClosingDialog({
  language,
  open,
  editing,
  vaults,
  form,
  mode,
  dayOffReason,
  dayOffNote,
  saving,
  preview,
  previewLoading,
  maxBusinessDate,
  allowDayOff,
  onClose,
  onSubmit,
  onChange,
  onModeChange,
  onDayOffReasonChange,
  onDayOffNoteChange,
}: DailySalesClosingDialogProps) {
  const copy = dailySalesText[language];
  const dialogRef = useDialogFocusTrap({ open, saving, onClose });

  if (!open) return null;
  const updateAmount = (vaultId: string, grossAmount: string) =>
    onChange({
      ...form,
      allocations: form.allocations.map((allocation) =>
        allocation.vaultId === vaultId
          ? { ...allocation, grossAmount }
          : allocation,
      ),
    });
  const close = () => {
    if (!saving) onClose();
  };
  const isDayOff = !editing && mode === "DAY_OFF";

  return (
    <div
      className="daily-sales-dialog-backdrop"
      role="presentation"
      onMouseDown={close}
    >
      <section
        ref={dialogRef}
        className="daily-sales-dialog"
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
                ? `${copy.correct}: ${editing.documentNumber}`
                : isDayOff
                  ? copy.dayOffTitle
                  : copy.create}
            </h3>
            <p>{isDayOff ? copy.dayOffIntro : copy.entryIntro}</p>
          </div>
          <button
            className="daily-sales-secondary"
            type="button"
            onClick={close}
            disabled={saving}
          >
            {copy.closeDialog}
          </button>
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
              <label>
                <span>{copy.date}</span>
                <input
                  type="date"
                  value={form.businessDate}
                  max={maxBusinessDate}
                  onChange={(event) =>
                    onChange({ ...form, businessDate: event.target.value })
                  }
                  required
                />
                <small>{copy.dateHint}</small>
              </label>
              {!isDayOff && (
                <fieldset className="daily-sales-dialog__scope-picker">
                  <legend>{copy.scope}</legend>
                  {(
                    [
                      ["MORNING", copy.morning],
                      ["EVENING", copy.evening],
                      ["ALL", copy.all],
                    ] as const
                  ).map(([scope, label]) => (
                    <button
                      key={scope}
                      type="button"
                      className={form.scope === scope ? "is-selected" : ""}
                      onClick={() => onChange({ ...form, scope })}
                      disabled={saving}
                    >
                      {label}
                    </button>
                  ))}
                  <small>{copy.scopeHint}</small>
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
            <>
              <label>
                <span>{copy.customers}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.customerCount}
                  onChange={(event) =>
                    onChange({ ...form, customerCount: event.target.value })
                  }
                  required
                />
              </label>
              <fieldset>
                <legend>{copy.channels}</legend>
                <div className="daily-sales-dialog__vault-grid">
                  {vaults.map((vault) => {
                    const allocation = form.allocations.find(
                      (item) => item.vaultId === vault.id,
                    );
                    return (
                      <label
                        className="daily-sales-dialog__vault"
                        key={vault.id}
                      >
                        <span>
                          {language === "ar" ? vault.nameAr : vault.nameEn}
                          <small>{copy[vault.type]}</small>
                        </span>
                        <input
                          aria-label={`${language === "ar" ? vault.nameAr : vault.nameEn} ${copy.amount}`}
                          inputMode="decimal"
                          value={allocation?.grossAmount ?? ""}
                          onChange={(event) =>
                            updateAmount(vault.id, event.target.value)
                          }
                          placeholder="0.00"
                        />
                      </label>
                    );
                  })}
                </div>
                <output
                  className="daily-sales-dialog__total"
                  aria-live="polite"
                >
                  <span>{copy.entryTotal}</span>
                  <strong dir="ltr">
                    {previewLoading
                      ? copy.previewLoading
                      : preview
                        ? formatMoney(preview.grossAmount)
                        : copy.previewUnavailable}
                  </strong>
                  <small>{copy.entryTotalHint}</small>
                </output>
              </fieldset>
              <section className="daily-sales-dialog__handover">
                <label>
                  <span>{copy.cashHandover}</span>
                  <input
                    inputMode="decimal"
                    value={form.cashHandoverAmount}
                    onChange={(event) =>
                      onChange({
                        ...form,
                        cashHandoverAmount: event.target.value,
                      })
                    }
                    placeholder="0.0000"
                  />
                </label>
                <label>
                  <span>{copy.cashVault}</span>
                  <select
                    value={form.cashHandoverVaultId}
                    onChange={(event) =>
                      onChange({
                        ...form,
                        cashHandoverVaultId: event.target.value,
                      })
                    }
                  >
                    {vaults
                      .filter((vault) => vault.type === "CASH")
                      .map((vault) => (
                        <option key={vault.id} value={vault.id}>
                          {language === "ar" ? vault.nameAr : vault.nameEn}
                        </option>
                      ))}
                  </select>
                </label>
                <small>{copy.recordedHint}</small>
              </section>
              <label className="daily-sales-dialog__wide">
                <span>{copy.notes}</span>
                <textarea
                  value={form.notes}
                  onChange={(event) =>
                    onChange({ ...form, notes: event.target.value })
                  }
                  maxLength={2_000}
                />
              </label>
            </>
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
                    : copy.create}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
