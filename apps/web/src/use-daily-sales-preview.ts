import { useEffect, useState } from "react";

import {
  api,
  type ActiveSession,
  type DailySalesEntryMode,
  type DailySalesPreview,
  type FormState,
} from "./daily-sales-client";

export function useDailySalesPreview({
  open,
  session,
  mode,
  form,
}: {
  open: boolean;
  session: ActiveSession | null;
  mode: DailySalesEntryMode;
  form: FormState;
}) {
  const [preview, setPreview] = useState<DailySalesPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    if (!open || !session || mode === "DAY_OFF") {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    const allocations = form.allocations.filter((allocation) => allocation.grossAmount.trim().length > 0);
    if (!allocations.length) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPreviewLoading(true);
      void api<DailySalesPreview>(session, "/finance/daily-sales/closings/preview", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessDate: form.businessDate,
          scope: form.scope,
          customerCount: Number(form.customerCount) || 0,
          allocations,
          ...(form.cashHandoverAmount ? { cashHandoverAmount: form.cashHandoverAmount, cashHandoverVaultId: form.cashHandoverVaultId } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        }),
      }).then((result) => {
        if (!controller.signal.aborted) setPreview(result);
      }).catch(() => {
        if (!controller.signal.aborted) setPreview(null);
      }).finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [form, mode, open, session]);
  return { preview, previewLoading, clearPreview: () => setPreview(null) };
}