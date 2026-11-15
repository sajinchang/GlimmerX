//! Idempotency for MCP write tools (design doc 25, §6).
//!
//! An agent that retries must not book the same expense twice. A caller-supplied
//! key makes a write run at most once: the first call claims the key, the write
//! happens, the result is stored. A retry with the same key receives that stored
//! result verbatim instead of writing again.
//!
//! Three states, and nothing else:
//!
//! | state | meaning | retry sees |
//! | --- | --- | --- |
//! | absent | never called | claims it, writes |
//! | `in_flight` | a call is writing right now | "still processing" |
//! | `done` | a call finished | the first result, no write |
//!
//! A crashed process leaves `in_flight` behind; after [`STALE_SECONDS`] a retry
//! may take the claim over. That window is the price of not holding a lock
//! across the write, and it is the only case where a duplicate is possible.
//!
//! No audit trail lives here — no request payload, no actor, no history. See
//! §11 for why that is deliberate.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::db::AppError;

/// How long an `in_flight` claim is trusted before it is treated as the
/// leftover of a crashed process. Ten minutes: comfortably longer than any
/// write this app performs, short enough that a retry is not blocked forever.
pub const STALE_SECONDS: i64 = 600;

/// How long a finished claim is kept. Comfortably longer than any plausible
/// client retry, short enough that the table does not grow forever.
pub const KEEP_FINISHED_DAYS: i64 = 30;

/// Drop finished claims older than `keep_days`, returning how many went.
///
/// Nothing depends on these rows: they exist to answer "did this key already
/// happen", and a caller that waits a month before retrying has bigger
/// problems. In-flight rows are never touched — those carry a live write.
pub fn prune_finished(conn: &Connection, keep_days: i64) -> Result<usize, AppError> {
    let removed = conn.execute(
        "DELETE FROM automation_idempotency
          WHERE status = 'done'
            AND (julianday('now') - julianday(created_at)) > ?1",
        params![keep_days as f64],
    )?;
    Ok(removed)
}

/// Outcome of claiming a key.
#[derive(Debug, PartialEq)]
pub enum Claim {
    /// The key is ours: run the write, then call [`complete`] or [`abandon`].
    Proceed,
    /// This key already finished: return the stored result, do not write.
    Done(Value),
    /// Another call holds the key and has not gone stale yet.
    InFlight,
}

/// Claim `(tool, key)` for writing.
pub fn claim(conn: &Connection, tool: &str, key: &str) -> Result<Claim, AppError> {
    // `INSERT OR IGNORE` is the atomic part: exactly one caller creates the row.
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO automation_idempotency
             (tool, idempotency_key, status, created_at)
         VALUES (?1, ?2, 'in_flight', datetime('now'))",
        params![tool, key],
    )?;
    if inserted == 1 {
        return Ok(Claim::Proceed);
    }

    let existing: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT status, result_json FROM automation_idempotency
              WHERE tool = ?1 AND idempotency_key = ?2",
            params![tool, key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let Some((status, result)) = existing else {
        // Deleted between the insert and this read: treat as a fresh claim
        // rather than failing a write for a row that is already gone.
        return Ok(Claim::Proceed);
    };

    if status == "done" {
        let value = result
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or(Value::Null);
        return Ok(Claim::Done(value));
    }

    // `in_flight`: only a stale claim may be taken over, and the guard lives in
    // the UPDATE so two racing retries cannot both win.
    let taken_over = conn.execute(
        "UPDATE automation_idempotency
            SET created_at = datetime('now'), status = 'in_flight', result_json = NULL
          WHERE tool = ?1 AND idempotency_key = ?2 AND status = 'in_flight'
            AND (julianday('now') - julianday(created_at)) * 86400.0 > ?3",
        params![tool, key, STALE_SECONDS as f64],
    )?;
    if taken_over == 1 {
        Ok(Claim::Proceed)
    } else {
        Ok(Claim::InFlight)
    }
}

/// Record the successful result for `(tool, key)` and close the claim.
pub fn complete(conn: &Connection, tool: &str, key: &str, result: &Value) -> Result<(), AppError> {
    let raw = serde_json::to_string(result).map_err(|e| AppError::IoError(e.to_string()))?;
    conn.execute(
        "UPDATE automation_idempotency SET status = 'done', result_json = ?3
          WHERE tool = ?1 AND idempotency_key = ?2",
        params![tool, key, raw],
    )?;
    Ok(())
}

/// Release a claim whose write failed, so the caller can retry with the key.
///
/// Without this a validation error would pin the key forever: the retry would
/// be told "still processing" about a call that already gave up.
pub fn abandon(conn: &Connection, tool: &str, key: &str) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM automation_idempotency
          WHERE tool = ?1 AND idempotency_key = ?2 AND status = 'in_flight'",
        params![tool, key],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use rusqlite::Connection;
    use tempfile::TempDir;

    fn fixture() -> (TempDir, Connection) {
        let dir = TempDir::new().unwrap();
        let conn = Connection::open(dir.path().join("test.db")).unwrap();
        crate::db::init_schema(&conn).unwrap();
        (dir, conn)
    }

    #[test]
    fn test_first_claim_proceeds_and_a_retry_replays() {
        let (_dir, conn) = fixture();
        assert_eq!(
            claim(&conn, "record_transaction", "k1").unwrap(),
            Claim::Proceed
        );

        let value = serde_json::json!({ "transactionId": "tx-1" });
        complete(&conn, "record_transaction", "k1", &value).unwrap();

        assert_eq!(
            claim(&conn, "record_transaction", "k1").unwrap(),
            Claim::Done(value)
        );
    }

    #[test]
    fn test_second_claim_while_in_flight_is_refused() {
        let (_dir, conn) = fixture();
        assert_eq!(
            claim(&conn, "record_transaction", "k1").unwrap(),
            Claim::Proceed
        );
        assert_eq!(
            claim(&conn, "record_transaction", "k1").unwrap(),
            Claim::InFlight,
            "a concurrent retry must not write in parallel"
        );
    }

    #[test]
    fn test_stale_claim_can_be_taken_over() {
        let (_dir, conn) = fixture();
        claim(&conn, "record_transaction", "k1").unwrap();
        // Pretend the process died long ago.
        conn.execute(
            "UPDATE automation_idempotency SET created_at = datetime('now', '-11 minutes')",
            [],
        )
        .unwrap();

        assert_eq!(
            claim(&conn, "record_transaction", "k1").unwrap(),
            Claim::Proceed
        );
    }

    #[test]
    fn test_abandoned_claim_can_be_retried() {
        let (_dir, conn) = fixture();
        claim(&conn, "record_transaction", "k1").unwrap();
        abandon(&conn, "record_transaction", "k1").unwrap();

        assert_eq!(
            claim(&conn, "record_transaction", "k1").unwrap(),
            Claim::Proceed,
            "a failed write must not pin its key"
        );
    }

    #[test]
    fn test_abandon_does_not_release_a_completed_key() {
        let (_dir, conn) = fixture();
        claim(&conn, "record_transaction", "k1").unwrap();
        complete(&conn, "record_transaction", "k1", &serde_json::json!(1)).unwrap();
        abandon(&conn, "record_transaction", "k1").unwrap();

        assert_eq!(
            claim(&conn, "record_transaction", "k1").unwrap(),
            Claim::Done(serde_json::json!(1)),
            "deleting can only undo an unfinished claim"
        );
    }

    #[test]
    fn test_different_tools_do_not_share_a_key() {
        let (_dir, conn) = fixture();
        claim(&conn, "record_transaction", "k1").unwrap();
        complete(&conn, "record_transaction", "k1", &serde_json::json!("tx")).unwrap();

        // Same key, other tool: a different slot.
        assert_eq!(
            claim(&conn, "create_account", "k1").unwrap(),
            Claim::Proceed
        );
    }

    #[test]
    fn test_prune_drops_only_old_finished_claims() {
        let (_dir, conn) = fixture();

        // Old and finished: pruneable.
        claim(&conn, "record_transaction", "old").unwrap();
        complete(&conn, "record_transaction", "old", &serde_json::json!(1)).unwrap();
        // Recent and finished: still protecting a retry.
        claim(&conn, "record_transaction", "recent").unwrap();
        complete(&conn, "record_transaction", "recent", &serde_json::json!(2)).unwrap();
        // In flight: a live write, never pruned.
        claim(&conn, "record_transaction", "busy").unwrap();

        conn.execute(
            "UPDATE automation_idempotency SET created_at = datetime('now', '-40 days')
              WHERE idempotency_key = 'old'",
            [],
        )
        .unwrap();

        assert_eq!(prune_finished(&conn, KEEP_FINISHED_DAYS).unwrap(), 1);
        assert_eq!(
            claim(&conn, "record_transaction", "recent").unwrap(),
            Claim::Done(serde_json::json!(2)),
            "a recent claim still replays"
        );
        assert_eq!(
            claim(&conn, "record_transaction", "busy").unwrap(),
            Claim::InFlight,
            "an in-flight claim is a live write"
        );
        assert_eq!(
            claim(&conn, "record_transaction", "old").unwrap(),
            Claim::Proceed,
            "the pruned key is free again"
        );
    }

    #[test]
    fn test_done_row_with_corrupt_json_does_not_rewrite() {
        let (_dir, conn) = fixture();
        claim(&conn, "record_transaction", "k1").unwrap();
        conn.execute(
            "UPDATE automation_idempotency SET status = 'done', result_json = 'not json'",
            [],
        )
        .unwrap();

        // Degrades to null instead of pretending the key is unused — a null
        // result is recoverable, a duplicate transaction is not.
        assert_eq!(
            claim(&conn, "record_transaction", "k1").unwrap(),
            Claim::Done(Value::Null)
        );
    }
}
