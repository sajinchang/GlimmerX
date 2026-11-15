import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  aiParseTransaction,
  accountCreate,
  quickAddTransaction,
  transactionDelete,
} from "@/utils/api";
import { translateErrorMessage } from "@/utils/errorTranslation";
import { invalidateLedger } from "@/lib/invalidateLedger";
import type {
  AiProposal,
  QuickAddInitial,
  QuickAddInput,
  TransactionDto,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QuickAddDialog } from "@/components/transactions/QuickAddDialog";
import { ProposalReview } from "@/components/transactions/ProposalReview";
import { Sparkles, Loader2 } from "lucide-react";

interface AiInputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

/**
 * `receipt` is not a confirmation step: by the time it appears the transaction
 * is already in the ledger (design doc 25, §4.2). It exists so the user can see
 * what was written, undo it, or correct it — "optimistic write + undo" replaces
 * the old blocking confirmation card.
 */
type Stage = "input" | "receipt" | "edit" | "confirmAccount";

/** Map an AI proposal onto the QuickAddDialog prefill / edit form. */
function toQuickAddInitial(proposal: AiProposal): QuickAddInitial {
  return {
    mode: proposal.action as QuickAddInitial["mode"],
    amount: proposal.amount ?? "",
    sourceAccountId: proposal.sourceAccount?.id,
    sourceAccountName: proposal.sourceAccount?.name,
    destinationAccountId: proposal.destinationAccount?.id,
    destinationAccountName: proposal.destinationAccount?.name,
    categoryName: proposal.categoryName,
    description: proposal.description,
    date: proposal.date,
    warnings: proposal.warnings,
  };
}

/** The same mapping, as the semantic input the write commands take. */
function toQuickAddInput(proposal: AiProposal): QuickAddInput {
  return {
    mode: proposal.action as QuickAddInput["mode"],
    amount: proposal.amount ?? "",
    sourceAccountId: proposal.sourceAccount?.id,
    destinationAccountId: proposal.destinationAccount?.id,
    categoryName: proposal.categoryName,
    description: proposal.description,
    date: proposal.date,
  };
}

export function AiInputDialog({
  open,
  onOpenChange,
  onSuccess,
}: AiInputDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("input");
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  // What actually landed in the ledger; the receipt describes this, not the
  // proposal, because the two can differ (trimmed name, resolved category).
  const [committed, setCommitted] = useState<TransactionDto | null>(null);
  // Editable fields for the create_account confirmation card.
  const [accountPath, setAccountPath] = useState("");
  const [accountKind, setAccountKind] = useState<"asset" | "liability">(
    "asset",
  );
  const [openingBalance, setOpeningBalance] = useState("");

  useEffect(() => {
    if (!open) {
      setText("");
      setSubmitError(null);
      setStage("input");
      setProposal(null);
      setCommitted(null);
      setAccountPath("");
      setAccountKind("asset");
      setOpeningBalance("");
    }
  }, [open]);

  /**
   * Writing straight away is the point: no state to persist, no countdown, no
   * recovery after a crash. A failure leaves nothing behind.
   */
  const commitMutation = useMutation({
    mutationFn: (result: AiProposal) =>
      quickAddTransaction(toQuickAddInput(result)),
    onSuccess: (transaction, result) => {
      setProposal(result);
      setCommitted(transaction);
      setStage("receipt");
      invalidateLedger(queryClient);
      onSuccess?.();
    },
    onError: (err) => {
      // Nothing was written, so we can simply fall back to the input stage.
      setSubmitError(translateErrorMessage(err, t));
      setStage("input");
    },
  });

  const parseMutation = useMutation({
    mutationFn: (input: string) => aiParseTransaction(input),
    onSuccess: (result) => {
      setSubmitError(null);
      if (result.action === "create_account") {
        // The one exception: an account cannot be un-created cheaply, so it
        // still asks before writing (§4.2 risk table).
        setProposal(result);
        setAccountPath(result.accountPath ?? "");
        setAccountKind(
          result.accountKind === "liability" ? "liability" : "asset",
        );
        setOpeningBalance(result.openingBalance ?? "");
        setStage("confirmAccount");
        return;
      }
      commitMutation.mutate(result);
    },
    onError: (err) => {
      setSubmitError(translateErrorMessage(err, t));
    },
  });

  const undoMutation = useMutation({
    mutationFn: (id: string) => transactionDelete(id),
    onSuccess: () => {
      invalidateLedger(queryClient);
      toast.success(t("ai.receipt.undoSuccess"));
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(
        `${t("ai.receipt.undoFailed")}: ${translateErrorMessage(err, t)}`,
      );
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: (input: Parameters<typeof accountCreate>[0]) =>
      accountCreate(input),
    onSuccess: () => {
      invalidateLedger(queryClient);
      toast.success(t("ai.success"));
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err) => {
      setSubmitError(translateErrorMessage(err, t));
    },
  });

  const busy = parseMutation.isPending || commitMutation.isPending;
  const canSubmit = text.trim().length > 0 && !busy;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    parseMutation.mutate(text.trim());
  };

  const canConfirmAccount =
    accountPath.trim().length > 0 && !createAccountMutation.isPending;

  const confirmCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirmAccount) return;
    createAccountMutation.mutate({
      name: accountPath.trim(),
      initial_balance: openingBalance.trim() || undefined,
      initial_balance_date: proposal?.date,
      description: proposal?.description || undefined,
    });
  };

  const backToInput = () => {
    setStage("input");
    setProposal(null);
    setCommitted(null);
    setSubmitError(null);
  };

  return (
    <>
      <Dialog
        open={
          open &&
          (stage === "input" ||
            stage === "receipt" ||
            stage === "confirmAccount")
        }
        onOpenChange={onOpenChange}
      >
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              {stage === "input" && t("ai.title")}
              {stage === "receipt" && t("ai.receipt.title")}
              {stage === "confirmAccount" && t("ai.review.title")}
            </DialogTitle>
          </DialogHeader>

          {stage === "input" && (
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t("ai.inputPlaceholder")}
                  className="min-h-[80px] resize-none"
                  autoFocus
                  disabled={busy}
                />

                {submitError && (
                  <p className="text-sm text-destructive">{submitError}</p>
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={!canSubmit}>
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("ai.recognizing")}
                    </>
                  ) : (
                    t("ai.button")
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}

          {stage === "receipt" && proposal && committed && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("ai.receipt.saved")}
              </p>

              <ProposalReview proposal={proposal} />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => undoMutation.mutate(committed.id)}
                  disabled={undoMutation.isPending}
                >
                  {t("ai.receipt.undo")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStage("edit")}
                >
                  {t("ai.receipt.issue")}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    // Nothing to do — the entry is already saved.
                    onOpenChange(false);
                  }}
                >
                  {t("ai.receipt.done")}
                </Button>
              </DialogFooter>
            </div>
          )}

          {stage === "confirmAccount" && proposal && (
            <form onSubmit={confirmCreateAccount}>
              <div className="space-y-4">
                <ProposalReview proposal={proposal} />

                <div className="space-y-2">
                  <Label htmlFor="ai-account-path">
                    {t("ai.review.accountPath")}
                  </Label>
                  <Input
                    id="ai-account-path"
                    value={accountPath}
                    onChange={(e) => setAccountPath(e.target.value)}
                    placeholder="Assets/支付宝"
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("ai.review.accountKind")}</Label>
                  <Select
                    value={accountKind}
                    onValueChange={(v) =>
                      setAccountKind(v === "liability" ? "liability" : "asset")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asset">
                        {t("quickAdd.assetAccount")}
                      </SelectItem>
                      <SelectItem value="liability">
                        {t("quickAdd.liabilityAccount")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-opening-balance">
                    {t("ai.review.openingBalance")}
                    <span className="text-muted-foreground text-xs ml-1">
                      ({t("common.optional")})
                    </span>
                  </Label>
                  <Input
                    id="ai-opening-balance"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                    className="font-mono"
                  />
                </div>

                {submitError && (
                  <p className="text-sm text-destructive">{submitError}</p>
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={backToInput}
                  disabled={createAccountMutation.isPending}
                >
                  {t("ai.review.back")}
                </Button>
                <Button type="submit" disabled={!canConfirmAccount}>
                  {createAccountMutation.isPending
                    ? t("common.processing")
                    : t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {stage === "edit" && proposal && committed && (
        <QuickAddDialog
          open={open}
          variant="review"
          initial={toQuickAddInitial(proposal)}
          replaceId={committed.id}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setStage("receipt");
          }}
          onSuccess={() => {
            // The entry was replaced in place; there is nothing left to review.
            toast.success(t("ai.success"));
            onOpenChange(false);
            onSuccess?.();
          }}
        />
      )}
    </>
  );
}
