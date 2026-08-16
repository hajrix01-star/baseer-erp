import { useCallback, useEffect, useMemo, useState } from "react";
import { dailySalesText, type DailySalesLanguage } from "./daily-sales-copy";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { DailySalesClosingDialog } from "./daily-sales-closing-dialog";
import { DailySalesReversalDialog } from "./daily-sales-reversal-dialog";
import { presentBaseerApiError } from "./baseer-api-error";
import { DailySalesHistory } from "./daily-sales-history";
import { DailySalesInsights } from "./daily-sales-insights";
import { useDailySalesPreview } from "./use-daily-sales-preview";
import {
  buildDailySalesWhatsAppText,
  openDailySalesWhatsApp,
} from "./daily-sales-whatsapp";
import {
  activeSession,
  api,
  initialForm,
  initialFormForVaults,
  monthRange,
  requestId,
  type ActiveSession,
  type CashHandoverReport,
  type Closing,
  type DailySalesWorkspaceReceipt,
  type DailySalesEntryMode,
  type DayOffReason,
  type FormState,
  type ShiftSummary,
  type Vault,
} from "./daily-sales-client";

export function DailySalesWorkspace({
  language,
}: {
  language: DailySalesLanguage;
}) {
  const copy = dailySalesText[language];
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const range = useMemo(monthRange, []);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [permissionCodes, setPermissionCodes] = useState<string[]>([]);
  const [closings, setClosings] = useState<Closing[]>([]);
  const [historyLimit, setHistoryLimit] = useState<number | null>(null);
  const [entryDate, setEntryDate] = useState<string | null>(null);
  const [cashHandover, setCashHandover] = useState<CashHandoverReport | null>(
    null,
  );
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary[]>([]);
  const [form, setForm] = useState<FormState>(initialForm());
  const [editing, setEditing] = useState<Closing | null>(null);
  const [entryMode, setEntryMode] = useState<DailySalesEntryMode>("CLOSING");
  const [dayOffReason, setDayOffReason] =
    useState<DayOffReason>("WEEKLY_CLOSURE");
  const [dayOffNote, setDayOffNote] = useState("");
  const [status, setStatus] = useState<{
    kind: "success" | "error" | "idle";
    message: string;
  }>({ kind: "idle", message: "" });
  const [saving, setSaving] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [reversalTarget, setReversalTarget] = useState<Closing | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const { preview, previewLoading, clearPreview } = useDailySalesPreview({
    open: entryOpen,
    session,
    mode: entryMode,
    form,
  });

  const load = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) return;
    const query = `fromBusinessDate=${range.from}&toBusinessDate=${range.to}`;
    const workspace = await api<DailySalesWorkspaceReceipt>(
      current,
      `/finance/daily-sales/workspace?${query}`,
    );
    setVaults(workspace.vaults);
    setPermissionCodes(workspace.permissionCodes);
    setEntryDate(workspace.entryDate.businessDate);
    setClosings(workspace.closings);
    setHistoryLimit(workspace.historyLimit);
    setCashHandover(workspace.cashHandovers);
    setShiftSummary(workspace.shifts);
    setForm((currentForm) =>
      currentForm.allocations[0]?.vaultId
        ? currentForm
        : initialFormForVaults(workspace.vaults),
    );
    setStatus({ kind: "success", message: copy.loaded });
  }, [copy.loaded, range.from, range.to]);

  useEffect(() => {
    void load().catch((error) =>
      setStatus({
        kind: "error",
        message: presentBaseerApiError(error, language, copy.error),
      }),
    );
  }, [copy.error, load]);

  const resetDialog = () => {
    setEditing(null);
    setEntryMode("CLOSING");
    setDayOffReason("WEEKLY_CLOSURE");
    setDayOffNote("");
    setForm(initialFormForVaults(vaults));
    clearPreview();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session || saving) return;
    if (
      entryMode === "DAY_OFF" &&
      dayOffReason === "OTHER" &&
      !dayOffNote.trim()
    ) {
      setStatus({ kind: "error", message: copy.dayOffNoteRequired });
      return;
    }
    if (
      entryMode === "CLOSING" &&
      !form.allocations.some(
        (allocation) => allocation.grossAmount.trim().length > 0,
      )
    ) {
      setStatus({ kind: "error", message: copy.enterAmount });
      return;
    }
    setSaving(true);
    setStatus({ kind: "idle", message: "" });
    try {
      if (entryMode === "DAY_OFF") {
        const note = `DAY_OFF: ${dayOffReason}${dayOffNote.trim() ? ` â€” ${dayOffNote.trim()}` : ""}`;
        await api(session, "/finance/operational-calendar/days", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessDate: form.businessDate,
            status: "CLOSED",
            source: dayOffReason === "HOLIDAY" ? "HOLIDAY" : "MANUAL",
            note,
            idempotencyKey: requestId(),
          }),
        });
        setEntryOpen(false);
        resetDialog();
        await load();
        setStatus({ kind: "success", message: copy.dayOffSuccess });
        return;
      }

      const body = {
        customerCount: Number(form.customerCount),
        allocations: form.allocations.filter(
          (allocation) => allocation.grossAmount.trim().length > 0,
        ),
        ...(form.cashHandoverAmount
          ? {
              cashHandoverAmount: form.cashHandoverAmount,
              cashHandoverVaultId: form.cashHandoverVaultId,
            }
          : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        idempotencyKey: requestId(),
      };
      if (editing) {
        await api(session, "/finance/daily-sales/closings/correct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, closingId: editing.closingId }),
        });
      } else {
        await api(session, "/finance/daily-sales/closings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...body,
            businessDate: form.businessDate,
            scope: form.scope,
          }),
        });
      }
      if (!editing) {
        try {
          const dayQuery = `fromBusinessDate=${form.businessDate}&toBusinessDate=${form.businessDate}`;
          const day = await api<{ closings: Closing[] }>(
            session,
            `/finance/daily-sales/closings?${dayQuery}`,
          );
          openDailySalesWhatsApp(
            buildDailySalesWhatsAppText({
              language,
              businessDate: form.businessDate,
              closings: day.closings,
              vaults,
            }),
          );
        } catch {
          // Sharing is optional and must never make a successfully posted summary look failed.
        }
      }
      setEntryOpen(false);
      resetDialog();
      await load();
      setStatus({ kind: "success", message: copy.success });
    } catch {
      setStatus({ kind: "error", message: copy.error });
    } finally {
      setSaving(false);
    }
  };

  const permissions = new Set(permissionCodes);
  const hasPermission = (code: string) => permissions.has(code);
  const canCreate =
    hasPermission("finance.daily_sales.create") ||
    hasPermission("finance.daily_sales.write");
  const canCorrect =
    hasPermission("finance.daily_sales.correct") ||
    hasPermission("finance.daily_sales.write");
  const canReverse =
    hasPermission("finance.daily_sales.reverse") ||
    hasPermission("finance.daily_sales.write");
  const canManageOperationalDay =
    hasPermission("finance.operational_calendar.manage") ||
    hasPermission("finance.daily_sales.write");
  const canReadManagementReports = hasPermission(
    "finance.daily_sales.history.read_all",
  );
  const selectForCorrection = (closing: Closing) => {
    setEditing(closing);
    setEntryMode("CLOSING");
    const seeded = initialFormForVaults(vaults);
    const savedAmounts = new Map(
      closing.allocations.map((allocation) => [
        allocation.vaultId,
        allocation.grossAmount,
      ]),
    );
    setForm({
      ...seeded,
      businessDate: closing.businessDate.slice(0, 10),
      scope: closing.scope,
      customerCount: String(closing.customerCount),
      allocations: seeded.allocations.map((allocation) => ({
        ...allocation,
        grossAmount: savedAmounts.get(allocation.vaultId) ?? "",
      })),
      cashHandoverAmount: closing.cashHandoverAmount ?? "",
      cashHandoverVaultId:
        closing.cashHandoverVaultId ?? seeded.cashHandoverVaultId,
      notes: closing.notes ?? "",
    });
    setEntryOpen(true);
  };

  const requestReversal = (closing: Closing) => {
    if (!saving) {
      setReversalTarget(closing);
      setReversalReason("");
    }
  };

  const closeReversal = () => {
    if (!saving) {
      setReversalTarget(null);
      setReversalReason("");
    }
  };

  const reverse = async () => {
    if (
      !session ||
      saving ||
      !reversalTarget ||
      reversalReason.trim().length < 3
    )
      return;
    setSaving(true);
    try {
      await api(session, "/finance/daily-sales/closings/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closingId: reversalTarget.closingId,
          businessDate: reversalTarget.businessDate,
          reason: reversalReason.trim(),
          idempotencyKey: requestId(),
        }),
      });
      closeReversal();
      await load();
      setStatus({ kind: "success", message: copy.success });
    } catch (error) {
      setStatus({
        kind: "error",
        message: presentBaseerApiError(error, language, copy.error),
      });
    } finally {
      setSaving(false);
    }
  };

  const openEntryForDate = (
    businessDate?: string,
    mode: DailySalesEntryMode = "CLOSING",
  ) => {
    setEditing(null);
    setEntryMode(mode);
    setDayOffReason("WEEKLY_CLOSURE");
    setDayOffNote("");
    setForm({
      ...initialFormForVaults(vaults),
      ...(businessDate ? { businessDate } : {}),
    });
    setEntryOpen(true);
  };

  if (!session) return <DailySalesSignIn language={language} />;
  return (
    <section className="daily-sales-shell">
      <header className="daily-sales-heading">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        <div className="daily-sales-heading__actions">
          {canCreate && (
            <button
              className="daily-sales-primary"
              type="button"
              onClick={() => openEntryForDate()}
            >
              {copy.create}
            </button>
          )}
          <button
            className="daily-sales-secondary"
            type="button"
            onClick={() => void load()}
          >
            {copy.refresh}
          </button>
        </div>
      </header>
      <p className="daily-sales-source">{copy.serverOnly}</p>
      {status.kind !== "idle" && (
        <p className={`daily-sales-message ${status.kind}`}>{status.message}</p>
      )}
      {vaults.length === 0 && (
        <p className="daily-sales-message error">{copy.emptyChannels}</p>
      )}
      <DailySalesClosingDialog
        language={language}
        open={entryOpen}
        editing={editing}
        vaults={vaults}
        form={form}
        mode={entryMode}
        dayOffReason={dayOffReason}
        dayOffNote={dayOffNote}
        saving={saving}
        preview={preview}
        previewLoading={previewLoading}
        maxBusinessDate={entryDate ?? undefined}
        allowDayOff={canManageOperationalDay}
        onClose={() => {
          setEntryOpen(false);
          resetDialog();
        }}
        onSubmit={submit}
        onChange={setForm}
        onModeChange={(mode) => {
          setEntryMode(mode);
          clearPreview();
        }}
        onDayOffReasonChange={setDayOffReason}
        onDayOffNoteChange={setDayOffNote}
      />
      {canReadManagementReports && (
        <DailySalesInsights
          language={language}
          shifts={shiftSummary}
          cashHandover={cashHandover}
        />
      )}{" "}
      <DailySalesReversalDialog
        language={language}
        closing={reversalTarget}
        reason={reversalReason}
        saving={saving}
        onReasonChange={setReversalReason}
        onClose={closeReversal}
        onConfirm={() => void reverse()}
      />{" "}
      <DailySalesHistory
        language={language}
        closings={closings}
        historyLimit={historyLimit}
        canCorrect={canCorrect}
        canReverse={canReverse}
        onCorrect={selectForCorrection}
        onReverse={requestReversal}
      />
    </section>
  );
}
