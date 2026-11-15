import { useTranslation } from "react-i18next";
import type { AiProposal } from "@/types";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

/**
 * The proposal summary shown on the AI receipt (design doc 11, §4.2).
 *
 * Since the entry is written before this renders, the block is no longer a
 * "check before saving" gate — it is the record of what the AI decided, next to
 * the buttons that undo or correct it.
 *
 * The warnings block is still the point of this component: every "guessed on
 * your behalf" decision (fuzzy account match, new category, default-account
 * fallback) must be visible, because undo only helps if the user notices.
 */
export function ProposalReview({
  proposal,
  className,
}: {
  proposal: AiProposal;
  className?: string;
}) {
  const { t } = useTranslation();

  const actionLabel =
    proposal.action === "create_account"
      ? t("quickAdd.createAccountAction")
      : t(`quickAdd.${proposal.action}`);

  const lines: string[] = [];
  if (proposal.action === "create_account") {
    if (proposal.accountPath) {
      lines.push(
        `${proposal.accountPath}${proposal.accountKind ? ` · ${proposal.accountKind === "liability" ? t("quickAdd.liabilityAccount") : t("quickAdd.assetAccount")}` : ""}`,
      );
    }
    if (proposal.openingBalance) {
      lines.push(
        `${t("ai.review.openingBalance")} ¥${proposal.openingBalance}`,
      );
    }
  } else {
    if (proposal.amount) {
      lines.push(`¥${proposal.amount}`);
    }
    const ends = [
      proposal.sourceAccount?.name,
      proposal.destinationAccount?.name,
    ].filter(Boolean);
    if (ends.length > 0) {
      lines.push(ends.join(" → "));
    }
    if (proposal.categoryName) {
      lines.push(`${t("transactions.category")}：${proposal.categoryName}`);
    }
  }
  lines.push(proposal.date);

  return (
    <div
      data-testid="proposal-review"
      className={cn("rounded-md border border-border p-3 space-y-2", className)}
    >
      <p className="text-sm font-medium">
        {t("ai.review.proposed")}
        <span className="text-muted-foreground font-normal"> · </span>
        {actionLabel}
      </p>
      {proposal.description && (
        <p className="text-sm text-muted-foreground">{proposal.description}</p>
      )}
      <ul className="text-sm font-mono text-muted-foreground space-y-0.5">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {proposal.warnings.length > 0 && (
        <ul
          data-testid="proposal-warnings"
          className="text-xs text-signal space-y-1"
        >
          {proposal.warnings.map((warning, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 translate-y-0.5" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
