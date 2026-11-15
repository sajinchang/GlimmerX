import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  Loader2,
  PencilLine,
  Undo2,
  XCircle,
} from "lucide-react";

import type { AiProposal } from "@/types";
import { cn } from "@/lib/utils";
import { formatAmountString } from "@/utils/format";
import { formatDateShort, todayLocalDate } from "@/utils/date";

/** The direction word, in the same vocabulary the quick-add form uses. */
const DIRECTION_KEY: Record<AiProposal["action"], string> = {
  expense: "quickAdd.expense",
  income: "quickAdd.income",
  transfer: "quickAdd.transfer",
  create_account: "quickAdd.createAccountAction",
};

/**
 * What the AI decided, as a receipt rather than a debug dump.
 *
 * The entry is already in the ledger when this renders (design doc 25, §4.2), so
 * the card is not a gate — it is the record plus the two ways out (undo, edit).
 * `state` only changes the status line: the layout is identical while the write
 * is in flight, so nothing jumps when it lands.
 */
export function AiReceiptCard({
  proposal,
  state,
  onUndo,
  undoPending = false,
  onEdit,
}: {
  proposal: AiProposal;
  state: "saving" | "saved";
  /** Required once there is something to undo or correct (`saved`). */
  onUndo?: () => void;
  undoPending?: boolean;
  onEdit?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const saved = state === "saved";

  // "已记入账本 · 14:32": the time is what makes it read as a receipt and not
  // as a form. Computed once per transition, not per render.
  const clock = useMemo(
    () =>
      saved
        ? new Date().toLocaleTimeString(i18n.language, {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "",
    [saved, i18n.language],
  );

  // Expense money leaves the source account towards the category; income
  // arrives from it. Falling back to the category keeps one line for both.
  const flow = [
    proposal.sourceAccount?.name,
    proposal.destinationAccount?.name ?? proposal.categoryName,
  ]
    .filter(Boolean)
    .join(" → ");
  const extraCategory =
    proposal.destinationAccount && proposal.categoryName
      ? proposal.categoryName
      : null;

  const dateLabel =
    proposal.date === todayLocalDate()
      ? t("ai.date.today")
      : formatDateShort(proposal.date);

  return (
    <div
      data-testid="ai-receipt"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs tracking-wide text-muted-foreground uppercase">
          {t(DIRECTION_KEY[proposal.action])}
        </span>
        <span className="font-mono text-2xl leading-none">
          {formatAmountString(proposal.amount)}
        </span>
      </div>

      {proposal.description && (
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {proposal.description}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {flow}
          {extraCategory && (
            <span className="text-muted-foreground/70"> · {extraCategory}</span>
          )}
        </span>
        <span className="shrink-0">{dateLabel}</span>
      </div>

      {/* Above the status line on purpose: undo only helps if the guess was
          noticed, so the guesses are read before "saved". */}
      {proposal.warnings.length > 0 && (
        <ul
          data-testid="ai-receipt-warnings"
          className="space-y-1 border-l-2 border-signal pl-2.5 text-xs text-signal"
        >
          {proposal.warnings.map((warning, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 translate-y-px" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <span
          role="status"
          data-testid="ai-receipt-status"
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          {saved ? (
            <>
              <Check className="h-3.5 w-3.5" />
              {t("ai.receipt.saved")}
              {clock && (
                <span className="text-muted-foreground/70">· {clock}</span>
              )}
            </>
          ) : (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("ai.receipt.saving")}
            </>
          )}
        </span>

        {saved && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onUndo}
              disabled={undoPending}
              aria-keyshortcuts="Meta+Z Control+Z"
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground",
                "hover:bg-accent hover:text-foreground disabled:opacity-50",
              )}
            >
              <Undo2 className="h-3.5 w-3.5" />
              {t("ai.receipt.undo")}
              <kbd
                aria-hidden="true"
                className="ml-0.5 hidden font-mono text-[10px] text-muted-foreground/70 sm:inline"
              >
                {t("ai.receipt.undoHint")}
              </kbd>
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PencilLine className="h-3.5 w-3.5" />
              {t("ai.receipt.edit")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Failure, with the one thing that matters stated first: whether anything was
 * written. "Parse failed" and "write failed" mean opposite things to someone
 * looking at their ledger, so they never share a message.
 */
export function AiErrorCard({
  kind,
  message,
  onRephrase,
  onRetry,
  onManual,
}: {
  kind: "parse" | "write";
  message: string;
  onRephrase: () => void;
  onRetry: () => void;
  onManual: () => void;
}) {
  const { t } = useTranslation();
  const parseFailed = kind === "parse";

  return (
    <div
      data-testid="ai-error"
      role="alert"
      className="space-y-2 rounded-lg border border-border bg-card p-4"
    >
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <XCircle className="h-4 w-4 text-destructive" />
        {parseFailed ? t("ai.error.parseTitle") : t("ai.error.writeTitle")}
      </p>
      <p className="text-xs break-words text-muted-foreground">{message}</p>
      <div className="flex items-center gap-3 pt-0.5 text-xs">
        {parseFailed ? (
          <button
            type="button"
            onClick={onRephrase}
            className="text-foreground underline underline-offset-2 hover:text-signal"
          >
            {t("ai.error.rephrase")}
          </button>
        ) : (
          <button
            type="button"
            onClick={onRetry}
            className="text-foreground underline underline-offset-2 hover:text-signal"
          >
            {t("ai.error.retry")}
          </button>
        )}
        <button
          type="button"
          onClick={onManual}
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {t("ai.error.manual")}
        </button>
      </div>
    </div>
  );
}

/**
 * Placeholder while the sentence is being parsed.
 *
 * Sized like a receipt on purpose: the card that replaces it is the same
 * height, so the dialog does not resize when the answer arrives.
 */
export function AiCardSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="ai-card-skeleton"
      aria-busy="true"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t("ai.recognizing")}
        </span>
        <span className="h-6 w-20 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-3.5 w-1/2 animate-pulse rounded bg-muted" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      <div className="border-t border-border pt-3">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
