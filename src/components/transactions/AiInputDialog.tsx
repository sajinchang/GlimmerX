import { useCallback, useEffect, useRef, useState } from "react";
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
import { formatAmountString } from "@/utils/format";
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
import {
  AiCardSkeleton,
  AiErrorCard,
  AiReceiptCard,
} from "@/components/transactions/AiReceiptCard";
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
 *
 * The phases below all share one promise: **the input never disappears**. A
 * wrong parse used to force the user out of the dialog and start over; now the
 * sentence stays put, so "undo and say it differently" is two clicks.
 */
type Phase = "idle" | "parsing" | "saving" | "saved" | "accountConfirm";

type Failure = { kind: "parse" | "write"; message: string };

/** Example sentences, shown only while the box is empty. */
const EXAMPLE_KEYS = [
  "ai.examples.expense",
  "ai.examples.date",
  "ai.examples.income",
];

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Mutation callbacks can settle after the dialog is gone; they need to know
  // which dialog they are talking to without re-reading a stale `open`.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
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
  // The two side doors: the full edit form, and the manual form used when the
  // AI cannot read the sentence at all.
  const [editing, setEditing] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  // Reset on *every* open/close, not just close. A mutation can settle after
  // the dialog was dismissed (the write still lands, which is the point of the
  // optimistic flow); if that state survived, the next session would open with
  // a receipt nobody asked for — and Ctrl+Z would then delete an entry the user
  // cannot see.
  useEffect(() => {
    setText("");
    setPhase("idle");
    setFailure(null);
    setProposal(null);
    setCommitted(null);
    setAccountPath("");
    setAccountKind("asset");
    setOpeningBalance("");
    setEditing(false);
    setManualOpen(false);
  }, [open]);

  const focusInput = useCallback(() => {
    // A tick of delay: the dialog's own focus trap settles first.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const removeEntry = useCallback(
    async (id: string) => {
      await transactionDelete(id);
      invalidateLedger(queryClient);
    },
    [queryClient],
  );

  /** "已记入 ¥18.50 午饭" for the entry a proposal describes. */
  const savedMessage = (source: AiProposal | null) =>
    t("ai.receipt.toastSaved", {
      amount: formatAmountString(source?.amount),
      description: source?.description ?? "",
    }).trim();

  /**
   * Undo must outlive the dialog: someone who closes the receipt and notices the
   * mistake a second later gets the same escape hatch in the toast.
   *
   * All three write paths use this — the AI entry, the manual form, and a
   * replacement — so "every write can be taken back" is one function, not three
   * copies that can drift. The message is the caller's, because only it knows
   * what was written.
   */
  const offerUndoInToast = (transaction: TransactionDto, message: string) => {
    toast.success(message, {
      duration: 8000,
      action: {
        label: t("ai.receipt.undo"),
        onClick: () => {
          removeEntry(transaction.id)
            .then(() => toast.success(t("ai.receipt.undoSuccess")))
            .catch((err) =>
              toast.error(
                `${t("ai.receipt.undoFailed")}: ${translateErrorMessage(err, t)}`,
              ),
            );
        },
      },
    });
  };

  const commitMutation = useMutation({
    mutationFn: (result: AiProposal) =>
      quickAddTransaction(toQuickAddInput(result)),
    onSuccess: (transaction, result) => {
      invalidateLedger(queryClient);
      if (!openRef.current) {
        // Dismissed mid-write. The entry is in the ledger all the same, so the
        // undo offer goes to the toast instead of a receipt nobody will see.
        offerUndoInToast(transaction, savedMessage(result));
        onSuccess?.();
        return;
      }
      setCommitted(transaction);
      setPhase("saved");
      onSuccess?.();
    },
    onError: (err) => {
      // Nothing was written. Keep the proposal so "retry" does not need the AI
      // round trip again.
      setFailure({ kind: "write", message: translateErrorMessage(err, t) });
      setPhase("idle");
    },
  });

  const parseMutation = useMutation({
    mutationFn: (input: string) => aiParseTransaction(input),
    onMutate: () => {
      setFailure(null);
      setPhase("parsing");
    },
    onSuccess: (result) => {
      setProposal(result);
      if (result.action === "create_account") {
        // The one exception: an account cannot be un-created cheaply, so it
        // still asks before writing (§4.2 risk table).
        setAccountPath(result.accountPath ?? "");
        setAccountKind(
          result.accountKind === "liability" ? "liability" : "asset",
        );
        setOpeningBalance(result.openingBalance ?? "");
        setPhase("accountConfirm");
        return;
      }
      // The card renders from `proposal` before the write resolves, so the user
      // sees what is about to land instead of a flash of nothing.
      setPhase("saving");
      commitMutation.mutate(result);
    },
    onError: (err) => {
      setFailure({ kind: "parse", message: translateErrorMessage(err, t) });
      setPhase("idle");
    },
  });

  const undoMutation = useMutation({
    mutationFn: (id: string) => removeEntry(id),
    onSuccess: () => {
      // Back to writing with the sentence intact: "say it differently" is the
      // usual next step after an undo, not "start over".
      setCommitted(null);
      setProposal(null);
      setFailure(null);
      setPhase("idle");
      toast.success(t("ai.receipt.undoSuccess"));
      focusInput();
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
      setFailure({ kind: "write", message: translateErrorMessage(err, t) });
    },
  });

  const busy = parseMutation.isPending || commitMutation.isPending;
  const canSubmit = text.trim().length > 0 && !busy;

  /**
   * Recording a second sentence retires the receipt that is on screen, so its
   * undo moves to the toast. Without this the previous entry would lose its
   * only escape hatch the moment the user types the next one.
   */
  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    if (phase === "saved" && committed)
      offerUndoInToast(committed, savedMessage(proposal));
    parseMutation.mutate(value);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && phase === "saved" && committed) {
      offerUndoInToast(committed, savedMessage(proposal));
    }
    onOpenChange(next);
  };

  // ⌘Z / Ctrl+Z on the receipt is the same action as the button. The mutation
  // object itself is unstable, so the listener depends on its parts: otherwise
  // it is torn down and re-added on every render.
  const { mutate: undoEntry, isPending: undoPending } = undoMutation;
  useEffect(() => {
    if (!open || phase !== "saved" || !committed || !proposal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (!undoPending) undoEntry(committed.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, phase, committed, proposal, undoEntry, undoPending]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter keeps inserting newlines (this is free text, sometimes two
    // sentences); ⌘/Ctrl+Enter is the submit, as the hint says.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
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
    setPhase("idle");
    setProposal(null);
    setCommitted(null);
    setFailure(null);
    focusInput();
  };

  return (
    <>
      <Dialog
        open={open && !editing && !manualOpen}
        onOpenChange={handleOpenChange}
      >
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              {phase === "accountConfirm"
                ? t("ai.review.title")
                : t("ai.title")}
            </DialogTitle>
          </DialogHeader>

          {phase === "accountConfirm" && proposal ? (
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

                {failure && (
                  <p className="text-sm text-destructive">{failure.message}</p>
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
                    : t("ai.review.createAccount")}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              {/* Composer stays mounted in every phase: it is the exit ramp
                  from a wrong receipt (undo → edit the sentence → again). */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
                className="space-y-3"
              >
                <Textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("ai.inputPlaceholder")}
                  className="min-h-[72px] resize-none"
                  autoFocus
                  disabled={busy}
                  aria-label={t("ai.title")}
                />

                {phase === "idle" && !failure && text.trim() === "" && (
                  <div className="flex flex-wrap gap-1.5">
                    {EXAMPLE_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setText(t(key));
                          focusInput();
                        }}
                        className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-signal hover:text-foreground"
                      >
                        {t(key)}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-muted-foreground">
                    {t("ai.submitHint")}
                  </span>
                  <Button
                    type="submit"
                    // While the receipt is up, "record another" must not compete
                    // with the single primary action ("好了").
                    variant={
                      phase === "saved" && proposal ? "outline" : "default"
                    }
                    disabled={!canSubmit}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("ai.recognizing")}
                      </>
                    ) : (
                      t("ai.button")
                    )}
                  </Button>
                </div>
              </form>

              {phase === "parsing" && <AiCardSkeleton />}

              {phase === "saving" && proposal && (
                <AiReceiptCard proposal={proposal} state="saving" />
              )}

              {phase === "saved" && proposal && committed && (
                <AiReceiptCard
                  proposal={proposal}
                  state="saved"
                  undoPending={undoPending}
                  onUndo={() => undoEntry(committed.id)}
                  onEdit={() => setEditing(true)}
                />
              )}

              {failure && phase === "idle" && (
                <AiErrorCard
                  kind={failure.kind}
                  message={failure.message}
                  onRephrase={() => {
                    setFailure(null);
                    focusInput();
                  }}
                  onRetry={() => {
                    if (!proposal) return;
                    setFailure(null);
                    setPhase("saving");
                    commitMutation.mutate(proposal);
                  }}
                  onManual={() => setManualOpen(true)}
                />
              )}

              {phase === "saved" && proposal && committed && (
                <DialogFooter>
                  <Button type="button" onClick={() => handleOpenChange(false)}>
                    {t("ai.receipt.done")}
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {editing && proposal && committed && (
        <QuickAddDialog
          open={editing}
          variant="review"
          initial={toQuickAddInitial(proposal)}
          replaceId={committed.id}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditing(false);
          }}
          onSuccess={(replacement) => {
            // Replacing is destructive: the original row is gone. The toast is
            // the only way back, so it offers undo even though that undo can
            // only delete the replacement.
            setEditing(false);
            offerUndoInToast(replacement, t("ai.receipt.replaced"));
            onOpenChange(false);
            onSuccess?.();
          }}
        />
      )}

      {manualOpen && (
        <QuickAddDialog
          open={manualOpen}
          prefill={{ description: text.trim() }}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setManualOpen(false);
          }}
          onSuccess={(transaction) => {
            // Typed by hand, but still a write: same undo, same 8 seconds.
            setManualOpen(false);
            onOpenChange(false);
            offerUndoInToast(transaction, t("ai.receipt.saved"));
            onSuccess?.();
          }}
        />
      )}
    </>
  );
}
