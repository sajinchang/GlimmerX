-- Schema version 4: budget limits become effective-dated history.
--
-- `budgets.amount` only ever held the *current* limit, yet the rollover replay
-- (`db/budgets.rs::rollover_carry`) walks every period since the budget was
-- created. Replaying history at today's limit meant that raising a limit
-- retroactively inflated every past period's leftover by the raise — a user
-- who lifted ¥1500 to ¥2000 saw their carry jump by ¥500 per past period,
-- because each was recomputed at the new number.
--
-- From v4 every limit change is appended to this table, and each past period
-- is replayed at the limit that was in effect when that period ran.
--
-- Existing budgets are seeded with one row ("the current limit since
-- creation") by the migration hook — the only fact the old schema preserved.
-- The migration is therefore numerically a no-op for existing data: a limit
-- edited in the past stays an approximation, and the guarantee begins with
-- the next edit.

CREATE TABLE IF NOT EXISTS budget_amount_history (
    id             TEXT PRIMARY KEY,
    budget_id      TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    amount         INTEGER NOT NULL CHECK (amount > 0),
    effective_from TEXT NOT NULL,
    created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_budget_amount_history_budget
    ON budget_amount_history (budget_id, effective_from);
