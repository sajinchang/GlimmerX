//! MCP tool set (design doc 25, §5.3).
//!
//! All rmcp types are confined to this file (and `mod.rs`); `commands/` and
//! `db/` never see them. Reads go through the ledger capability layer; writes
//! go through it too, gated by the trust tier, and a locked ledger is an
//! error every tool reports the same way.
//!
//! Amounts cross the boundary as integer cents only — never a string for the
//! agent to format wrong. Account/category references are names; the skill
//! doc tells agents to `list_accounts` before guessing.

use std::sync::Arc;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, ContentBlock, Implementation, ListResourceTemplatesResult, ListResourcesResult,
    PaginatedRequestParams, ProtocolVersion, ReadResourceRequestParams, ReadResourceResponse,
    ReadResourceResult, Resource, ResourceContents, ResourceTemplate, ResultType,
    ServerCapabilities, ServerConfig,
};
use rmcp::schemars;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::tool;
use rmcp::ErrorData as McpError;

use crate::db::idempotency::{self, Claim};
use crate::db::AppError;
use crate::ledger::{self, AccountRef, CategoryRef, LedgerQuery, RecordKind, RecordRequest};
use crate::mcp::host::{DbFn, McpHost};
use crate::mcp::settings::TrustMode;

/// The handler served over Streamable HTTP. One instance per request (the
/// stateless service factory builds a fresh one); the app is reached only
/// through the [`McpHost`] seam, which tests can fake.
#[derive(Clone)]
pub struct LedgerTools {
    host: Arc<dyn McpHost>,
}

fn internal(msg: &str) -> McpError {
    McpError::internal_error(msg.to_string(), None)
}

fn ok_json(value: impl serde::Serialize) -> Result<CallToolResult, McpError> {
    let text =
        serde_json::to_string_pretty(&value).map_err(|_| internal("serialization failed"))?;
    Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
}

/// Tool-level failure the user (and the agent) should see: the tool ran and
/// failed in a way the caller can act on, so it is a result, not a protocol
/// error.
fn denied(msg: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(msg.into())])
}

/// Run a ledger call with the database connection; lock/db/app errors are
/// mapped to protocol errors with the localized message. Every tool funnels
/// through this, so "the ledger is locked" is one message, not nine.
fn call_ledger<T>(
    host: &Arc<dyn McpHost>,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T, AppError> + Send + 'static,
) -> Result<CallToolResult, McpError>
where
    T: serde::Serialize,
{
    let boxed: DbFn = Box::new(move |conn| {
        f(conn).and_then(|value| {
            serde_json::to_value(value).map_err(|e| AppError::IoError(e.to_string()))
        })
    });
    match host.with_db(boxed) {
        Ok(value) => ok_json(value),
        // Domain failures (locked ledger, validation, not-found) are
        // tool-level results the agent can read and act on, not protocol
        // errors, which clients display opaquely.
        Err(message) => Ok(denied(message)),
    }
}

fn to_json_value<T: serde::Serialize>(value: T) -> Result<serde_json::Value, AppError> {
    serde_json::to_value(value).map_err(|e| AppError::IoError(e.to_string()))
}

/// [`call_ledger`] with an optional idempotency key (design doc 25, §6).
///
/// Claim, write and complete run inside one `with_db` closure so the row and
/// the write travel on the same connection. The outcome is carried as an
/// envelope instead of a bespoke `AppError` variant, because every `AppError`
/// string goes through the UI localiser — an agent wants plain English here.
fn call_ledger_keyed<T>(
    host: &Arc<dyn McpHost>,
    tool: &'static str,
    key: Option<String>,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T, AppError> + Send + 'static,
) -> Result<CallToolResult, McpError>
where
    T: serde::Serialize,
{
    let boxed: DbFn = Box::new(move |conn| {
        let Some(key) = key else {
            // No key: no protection, exactly the old behaviour.
            let value = to_json_value(f(conn)?)?;
            return Ok(serde_json::json!({ "outcome": "written", "value": value }));
        };
        match idempotency::claim(conn, tool, &key)? {
            // The first call already wrote this; replay its result untouched.
            Claim::Done(previous) => {
                Ok(serde_json::json!({ "outcome": "replayed", "value": previous }))
            }
            Claim::InFlight => Ok(serde_json::json!({ "outcome": "in_flight" })),
            Claim::Proceed => match f(conn) {
                Ok(written) => {
                    let value = to_json_value(written)?;
                    idempotency::complete(conn, tool, &key, &value)?;
                    Ok(serde_json::json!({ "outcome": "written", "value": value }))
                }
                Err(err) => {
                    // A failed write must release its key, otherwise every
                    // retry is answered "still processing" forever.
                    let _ = idempotency::abandon(conn, tool, &key);
                    Err(err)
                }
            },
        }
    });
    match host.with_db(boxed) {
        Ok(envelope) => {
            if envelope["outcome"] == "in_flight" {
                return Ok(denied(
                    "This idempotency_key is still being processed by an earlier call. Retry after it finishes.",
                ));
            }
            ok_json(envelope["value"].clone())
        }
        Err(message) => Ok(denied(message)),
    }
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct QueryTransactionsParams {
    /// Inclusive range start, YYYY-MM-DD. Optional.
    #[serde(rename = "from", default)]
    from_date: Option<String>,
    /// Inclusive range end, YYYY-MM-DD. Optional.
    #[serde(rename = "to", default)]
    to_date: Option<String>,
    /// Account id (from list_accounts). Optional.
    #[serde(default)]
    account_id: Option<String>,
    /// Category id (from list_categories). Optional.
    #[serde(default)]
    category_id: Option<String>,
    /// Case-insensitive substring on the description. Optional.
    #[serde(default)]
    keyword: Option<String>,
    /// Page size cap, 1..=100. Default 50.
    #[serde(default)]
    limit: Option<u32>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct SummaryParams {
    /// Inclusive range start, YYYY-MM-DD.
    from: String,
    /// Inclusive range end, YYYY-MM-DD.
    to: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct RecordTransactionParams {
    /// One of: expense, income, transfer.
    kind: String,
    /// Positive integer cents (e.g. 18.50 -> 1850).
    pub amount_cents: i64,
    /// Business date, YYYY-MM-DD. Defaults to today.
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    description: Option<String>,
    /// Account the money leaves (required for expense and transfer).
    /// Use the account name as shown by list_accounts.
    #[serde(default)]
    source_account: Option<String>,
    /// Account the money arrives in (required for income and transfer).
    #[serde(default)]
    destination_account: Option<String>,
    /// P&L category name (expense/income only; resolved or created).
    #[serde(default)]
    category: Option<String>,
    /// Optional retry guard: repeating the same key never books a second
    /// transaction — the first result is replayed instead. Use one key per
    /// logical write, and a new key for a genuinely new write.
    #[serde(default)]
    idempotency_key: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct CreateAccountParams {
    /// Hierarchical path, e.g. `Assets/Alipay`. The first segment decides
    /// the account type.
    path: String,
    #[serde(default)]
    description: Option<String>,
    /// Opening balance in integer cents. Optional (omit for zero).
    #[serde(default)]
    opening_balance_cents: Option<i64>,
    /// Opening-balance date, YYYY-MM-DD. Defaults to today.
    #[serde(default)]
    opening_balance_date: Option<String>,
    /// Optional retry guard: repeating the same key never creates a second
    /// account — the first result is replayed instead.
    #[serde(default)]
    idempotency_key: Option<String>,
}

impl LedgerTools {
    pub fn new(host: Arc<dyn McpHost>) -> Self {
        Self { host }
    }

    /// Trust-gate a write tool. `Ok(())` = proceed; `Err(result)` = the
    /// already-shaped tool result the caller must return as-is.
    ///
    /// Two tiers, no third: there used to be a `Confirm` tier that asked the
    /// user through a Tauri event, but that channel is invisible to the MCP
    /// client — an external agent could only wait out the timeout. Writes are
    /// now always immediate under `Trust`, and the user can undo them in the
    /// app afterwards (design doc 25, §5.4).
    fn gate_write(&self) -> Result<(), CallToolResult> {
        let trust = match self.host.mcp_config() {
            Ok(config) => config.trust,
            Err(message) => return Err(denied(message)),
        };
        match trust {
            TrustMode::ReadOnly => Err(denied(
                "Not authorized: the MCP trust mode is read-only. Ask the user to change it in settings.",
            )),
            TrustMode::Trust => Ok(()),
        }
    }
}

#[rmcp::tool_router]
impl LedgerTools {
    /// Whether the ledger is unlocked, plus the db path and trust mode.
    #[tool(
        description = "Report whether the ledger is unlocked, the database path, and the current MCP trust mode. Call this first: a locked ledger makes every other tool fail."
    )]
    async fn ledger_status(&self) -> Result<CallToolResult, McpError> {
        // The status call needs db + path at once; run both through one
        // with_db closure so a lock between them cannot tear the answer.
        let boxed: DbFn = Box::new(|conn| {
            let trust = crate::mcp::settings::load_config(conn)?
                .trust
                .as_str()
                .to_string();
            serde_json::to_value(serde_json::json!({
                "unlocked": true,
                "trustMode": trust,
            }))
            .map_err(|e| AppError::IoError(e.to_string()))
        });
        match self.host.with_db(boxed) {
            Ok(mut value) => {
                // dbPath is not in the db; merge it in from the host.
                let path = self.host.db_path().unwrap_or_default();
                value["databasePath"] = serde_json::Value::String(path);
                ok_json(value)
            }
            Err(message) => Ok(denied(message)),
        }
    }

    /// All accounts with type and balance.
    #[tool(
        description = "List every account with its id, name, type (asset/liability) and balance in cents (liabilities negative). Resolve account names here before writing; do not guess ids."
    )]
    async fn list_accounts(&self) -> Result<CallToolResult, McpError> {
        call_ledger(&self.host, ledger::list_accounts)
    }

    /// All categories with their type.
    #[tool(description = "List every category with its id, name and type (expense/income).")]
    async fn list_categories(&self) -> Result<CallToolResult, McpError> {
        call_ledger(&self.host, ledger::list_categories)
    }

    /// Query transactions by date/account/category/keyword.
    #[tool(
        description = "Query transactions by date range, account id, category id, or a keyword on the description. Dates are YYYY-MM-DD, the range is inclusive."
    )]
    async fn query_transactions(
        &self,
        Parameters(args): Parameters<QueryTransactionsParams>,
    ) -> Result<CallToolResult, McpError> {
        let limit = args.limit.unwrap_or(50).clamp(1, 100);
        call_ledger(&self.host, move |conn| {
            ledger::query_transactions(
                conn,
                &LedgerQuery {
                    from_date: args.from_date.clone(),
                    to_date: args.to_date.clone(),
                    account_id: args.account_id.clone(),
                    category_id: args.category_id.clone(),
                    description_query: args.keyword.clone(),
                    page: Some(1),
                    page_size: Some(limit),
                },
            )
        })
    }

    /// Account balances snapshot.
    #[tool(description = "Snapshot of every account balance (id, name, cents).")]
    async fn get_balances(&self) -> Result<CallToolResult, McpError> {
        call_ledger(&self.host, ledger::account_balances)
    }

    /// Income/expense/net totals over a date range.
    #[tool(
        description = "Income, expense and net totals in cents over an inclusive date range (YYYY-MM-DD)."
    )]
    async fn summary(
        &self,
        Parameters(args): Parameters<SummaryParams>,
    ) -> Result<CallToolResult, McpError> {
        call_ledger(&self.host, move |conn| {
            ledger::period_summary(conn, &args.from, &args.to)
        })
    }

    /// Record an expense, income or transfer (write, trust-gated).
    #[tool(
        description = "Record a transaction. kind: expense|income|transfer; amounts are positive integer cents. source_account: where money leaves (required for expense/transfer); destination_account: where it arrives (required for income/transfer); both must be asset or liability accounts. category: name, expense/income only. Accounts are matched by name — call list_accounts first when unsure."
    )]
    async fn record_transaction(
        &self,
        Parameters(args): Parameters<RecordTransactionParams>,
    ) -> Result<CallToolResult, McpError> {
        let kind = match args.kind.as_str() {
            "expense" => RecordKind::Expense,
            "income" => RecordKind::Income,
            "transfer" => RecordKind::Transfer,
            other => {
                return Ok(denied(format!(
                    "Invalid kind '{other}': expected expense, income or transfer."
                )));
            }
        };
        let description = args.description.clone().unwrap_or_default();
        let request = RecordRequest {
            kind,
            amount_cents: args.amount_cents,
            date: args.date.clone(),
            description,
            source_account: args.source_account.clone().map(AccountRef::Name),
            destination_account: args.destination_account.clone().map(AccountRef::Name),
            category: args.category.clone().map(CategoryRef::Name),
        };
        if let Err(result) = self.gate_write() {
            return Ok(result);
        }
        // Gate first, key second: a read-only caller must not be able to learn
        // whether some key was already used.
        call_ledger_keyed(
            &self.host,
            "record_transaction",
            args.idempotency_key.clone(),
            move |conn| ledger::record_transaction(conn, &request),
        )
    }

    /// Create an account (write, trust-gated).
    #[tool(
        description = "Create an account at a hierarchical path like 'Assets/Alipay' — the first segment (Assets/Liabilities) decides the type. Optional opening balance in integer cents. Unless the user explicitly asks for it, do not create accounts: account names are the user's semantic system."
    )]
    async fn create_account(
        &self,
        Parameters(args): Parameters<CreateAccountParams>,
    ) -> Result<CallToolResult, McpError> {
        if let Err(result) = self.gate_write() {
            return Ok(result);
        }
        // Second, independent gate (§4.3): trusting an agent to record spending
        // is not the same as letting it invent accounts, which cannot be undone
        // cleanly once postings point at them.
        match self.host.mcp_config() {
            Ok(config) if config.allow_create_account => {}
            Ok(_) => {
                return Ok(denied(
                    "Not authorized: creating accounts is switched off. Ask the user to enable it in GlimmerX, or let them create the account first.",
                ))
            }
            Err(message) => return Ok(denied(message)),
        }
        let request = ledger::CreateAccountRequest {
            path: args.path.clone(),
            description: args.description.clone(),
            opening_balance_cents: args.opening_balance_cents,
            opening_balance_date: args.opening_balance_date.clone(),
        };
        call_ledger_keyed(
            &self.host,
            "create_account",
            args.idempotency_key.clone(),
            move |conn| ledger::create_account(conn, &request),
        )
    }
}

/// What the agent is told once, at `server/discover` / `initialize`.
const INSTRUCTIONS: &str = "GlimmerX double-entry ledger. Amounts are integer cents; \
dates are YYYY-MM-DD. List accounts/categories before writing; account names must match \
exactly or uniquely. Writes are gated by the trust mode: read-only rejects, trust writes \
directly (the user can undo in the app). Read-only resources are available under \
glimmerx:// (accounts, categories, monthly report).";

const ACCOUNTS_URI: &str = "glimmerx://accounts";
const CATEGORIES_URI: &str = "glimmerx://categories";
const REPORT_PREFIX: &str = "glimmerx://report/";
const REPORT_TEMPLATE: &str = "glimmerx://report/{month}";

const JSON_MIME: &str = "application/json";

/// First and last day of `YYYY-MM`, or `None` when the month is malformed.
fn month_bounds(month: &str) -> Option<(String, String)> {
    let (year, month) = month.split_once('-')?;
    let year: i32 = year.parse().ok()?;
    let month: u32 = month.parse().ok()?;
    let first = chrono::NaiveDate::from_ymd_opt(year, month, 1)?;
    let next = if month == 12 {
        chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)?
    } else {
        chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)?
    };
    Some((first.to_string(), next.pred_opt()?.to_string()))
}

/// The concrete resources `resources/list` advertises. The report is listed for
/// the current month only; the rest of the space is addressed through the
/// template, because months are an open range, not an enumerable list.
fn static_resources(today: &str) -> Vec<Resource> {
    let month = &today[..7];
    vec![
        {
            let mut resource = Resource::new(ACCOUNTS_URI, "accounts");
            resource.description =
                Some("All accounts with type, path and current balance.".to_string());
            resource.mime_type = Some(JSON_MIME.to_string());
            resource
        },
        {
            let mut resource = Resource::new(CATEGORIES_URI, "categories");
            resource.description = Some("Expense and income categories.".to_string());
            resource.mime_type = Some(JSON_MIME.to_string());
            resource
        },
        {
            let mut resource =
                Resource::new(format!("{REPORT_PREFIX}{month}"), format!("report-{month}"));
            resource.description = Some("Income, expense and net for that month.".to_string());
            resource.mime_type = Some(JSON_MIME.to_string());
            resource
        },
    ]
}

fn report_template() -> ResourceTemplate {
    let mut template = ResourceTemplate::new(REPORT_TEMPLATE, "monthly-report");
    template.title = Some("Monthly report".to_string());
    template.description =
        Some("Monthly income, expense and net. Substitute {month} with YYYY-MM.".to_string());
    template.mime_type = Some(JSON_MIME.to_string());
    template
}

fn json_contents(uri: &str, value: &serde_json::Value) -> ReadResourceResult {
    ReadResourceResult::new(vec![ResourceContents::TextResourceContents {
        uri: uri.to_string(),
        mime_type: Some(JSON_MIME.to_string()),
        text: serde_json::to_string_pretty(value).unwrap_or_else(|_| "null".to_string()),
        meta: None,
    }])
}

#[rmcp::tool_handler(name = "glimmerx")]
impl rmcp::ServerHandler for LedgerTools {
    /// Hand-written because the macro only declares `tools` (design doc 25,
    /// §5.6): resources need to be announced here, and the macro skips
    /// `get_info` whenever the impl block already has one.
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_server_info(Implementation::new("glimmerx", env!("CARGO_PKG_VERSION")))
        .with_instructions(INSTRUCTIONS)
    }

    /// 2026-07-28 and nothing else (§5.5). Clients that still open with
    /// `initialize` are rejected rather than silently served.
    fn supported_protocol_versions(&self) -> std::borrow::Cow<'static, [ProtocolVersion]> {
        std::borrow::Cow::Borrowed(&[ProtocolVersion::V_2026_07_28])
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        Ok(ListResourcesResult {
            result_type: Some(ResultType::COMPLETE),
            meta: None,
            next_cursor: None,
            ttl_ms: None,
            cache_scope: None,
            resources: static_resources(&crate::utils::time::today_date()),
        })
    }

    async fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, McpError> {
        Ok(ListResourceTemplatesResult {
            result_type: Some(ResultType::COMPLETE),
            meta: None,
            next_cursor: None,
            ttl_ms: None,
            cache_scope: None,
            resource_templates: vec![report_template()],
        })
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, McpError> {
        Ok(self.read_uri(&request.uri)?.into())
    }
}

impl LedgerTools {
    /// Read one resource URI. Split out of the trait method so tests can call it
    /// without fabricating a `RequestContext`.
    fn read_uri(&self, uri: &str) -> Result<ReadResourceResult, McpError> {
        let value = if uri == ACCOUNTS_URI {
            self.resource_json(|conn| to_json_value(ledger::list_accounts(conn)?))?
        } else if uri == CATEGORIES_URI {
            self.resource_json(|conn| to_json_value(ledger::list_categories(conn)?))?
        } else if let Some(month) = uri.strip_prefix(REPORT_PREFIX) {
            let (from, to) = month_bounds(month).ok_or_else(|| {
                McpError::resource_not_found(
                    format!("Unknown month '{month}'; expected YYYY-MM"),
                    None,
                )
            })?;
            self.resource_json(move |conn| {
                to_json_value(ledger::period_summary(conn, &from, &to)?)
            })?
        } else {
            return Err(McpError::resource_not_found(
                format!("Unknown resource '{uri}'"),
                None,
            ));
        };
        Ok(json_contents(uri, &value))
    }
}

impl LedgerTools {
    /// Run a read through the same seam the tools use, surfacing a locked or
    /// unavailable ledger as a protocol-level resource error.
    fn resource_json(
        &self,
        f: impl FnOnce(&rusqlite::Connection) -> Result<serde_json::Value, AppError> + Send + 'static,
    ) -> Result<serde_json::Value, McpError> {
        self.host
            .with_db(Box::new(f))
            .map_err(|message| McpError::internal_error(message, None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use tauri::async_runtime::JoinHandle;

    use crate::db::Database;
    use crate::mcp::settings::McpConfig;
    use crate::mcp::McpRuntimeStatus;

    /// What the fake host hands to `with_db`.
    enum Backing {
        /// Real schema: ledger calls can succeed.
        Db {
            db: Database,
            _dir: tempfile::TempDir,
        },
        /// No schema at all: settings and ledger reads fail.
        Bare,
        /// Locked ledger: `with_db` fails before the closure runs.
        Locked,
    }

    /// Test double for the app handle — only the parts the tools touch.
    /// Runtime-task plumbing is a no-op: no test drives the serve loop.
    struct FakeHost {
        backing: Backing,
        trust: Result<TrustMode, String>,
        path: Option<String>,
        /// Independent of the trust tier (design doc 25, §4.3).
        allow_create_account: bool,
    }

    impl FakeHost {
        fn with(
            backing: Backing,
            trust: Result<TrustMode, String>,
            path: Option<String>,
        ) -> Arc<Self> {
            Arc::new(Self {
                backing,
                trust,
                path,
                allow_create_account: false,
            })
        }

        /// Unlocked ledger with the real schema and one asset account.
        fn ledger(trust: TrustMode) -> Arc<Self> {
            let dir = tempfile::tempdir().unwrap();
            let db = Database::create(&dir.path().join("t.db"), "pw").unwrap();
            {
                let conn = db.get_conn().unwrap();
                crate::db::accounts::create_account_with_path(&conn, "Assets/Cash", None).unwrap();
                // Keep the settings table and the fake host in agreement:
                // ledger_status reads the trust tier from the database.
                crate::mcp::settings::save_trust(&conn, trust.as_str()).unwrap();
            }
            Self::with(
                Backing::Db { db, _dir: dir },
                Ok(trust),
                Some("/tmp/glimmerx.db".to_string()),
            )
        }

        /// Same ledger, with account creation allowed by the user.
        fn ledger_trusting_accounts(trust: TrustMode) -> Arc<Self> {
            let dir = tempfile::tempdir().unwrap();
            let db = Database::create(&dir.path().join("t.db"), "pw").unwrap();
            {
                let conn = db.get_conn().unwrap();
                crate::db::accounts::create_account_with_path(&conn, "Assets/Cash", None).unwrap();
                crate::mcp::settings::save_trust(&conn, trust.as_str()).unwrap();
            }
            Arc::new(Self {
                backing: Backing::Db { db, _dir: dir },
                trust: Ok(trust),
                path: Some("/tmp/glimmerx.db".to_string()),
                allow_create_account: true,
            })
        }

        /// Unlocked but without a schema: every query fails.
        fn bare() -> Arc<Self> {
            Self::with(Backing::Bare, Ok(TrustMode::Trust), None)
        }

        /// Locked ledger.
        fn locked() -> Arc<Self> {
            Self::with(Backing::Locked, Ok(TrustMode::Trust), None)
        }

        /// Settings unreadable, so even the trust tier cannot be resolved.
        fn config_unreadable() -> Arc<Self> {
            Self::with(Backing::Bare, Err("settings unreadable".to_string()), None)
        }
    }

    impl McpHost for FakeHost {
        fn with_db(&self, f: DbFn) -> Result<serde_json::Value, String> {
            match &self.backing {
                Backing::Db { db, .. } => {
                    let conn = db.get_conn().map_err(|e| e.to_string())?;
                    f(&conn).map_err(|e| e.to_string())
                }
                Backing::Bare => {
                    let conn = rusqlite::Connection::open_in_memory().map_err(|e| e.to_string())?;
                    f(&conn).map_err(|e| e.to_string())
                }
                Backing::Locked => Err("errors.databaseLocked".to_string()),
            }
        }

        fn db_path(&self) -> Option<String> {
            self.path.clone()
        }

        fn mcp_config(&self) -> Result<McpConfig, String> {
            self.trust.clone().map(|trust| McpConfig {
                enabled: true,
                port: 17823,
                token: "test-token".to_string(),
                trust,
                allow_create_account: self.allow_create_account,
            })
        }

        fn set_runtime_task(&self, _task: JoinHandle<()>, _port: u16) {}

        fn set_runtime_port(&self, _port: u16) {}

        fn abort_runtime(&self) {}

        fn mark_runtime_stopped(&self) {}

        fn runtime_status(&self) -> McpRuntimeStatus {
            McpRuntimeStatus {
                running: false,
                port: None,
            }
        }
    }

    fn text_of(result: &CallToolResult) -> String {
        match result.content.first() {
            Some(ContentBlock::Text(text)) => text.text.clone(),
            other => panic!("expected text content, got {other:?}"),
        }
    }

    fn failed(result: &CallToolResult) -> bool {
        result.is_error.unwrap_or(false)
    }

    /// An expense on the fake ledger's Cash account.
    fn expense_args() -> RecordTransactionParams {
        RecordTransactionParams {
            kind: "expense".to_string(),
            amount_cents: 1850,
            date: Some("2026-11-14".to_string()),
            description: Some("coffee".to_string()),
            source_account: Some("Cash".to_string()),
            destination_account: None,
            category: Some("餐饮".to_string()),
            idempotency_key: None,
        }
    }

    #[tokio::test]
    async fn test_ledger_status_reports_trust_and_path() {
        let tools = LedgerTools::new(FakeHost::ledger(TrustMode::Trust));
        let result = tools.ledger_status().await.unwrap();
        let text = text_of(&result);
        assert!(text.contains("\"trust\""), "trust mode: {text}");
        // dbPath lives in the host, not the database: it must be merged in.
        assert!(text.contains("/tmp/glimmerx.db"), "db path merged: {text}");
    }

    #[tokio::test]
    async fn test_ledger_status_surfaces_unreadable_settings() {
        let tools = LedgerTools::new(FakeHost::bare());
        let result = tools.ledger_status().await.unwrap();
        assert!(failed(&result), "a failed read is a tool error");
        // A localized, user-facing message, not an empty result.
        assert!(!text_of(&result).is_empty());
    }

    #[tokio::test]
    async fn test_read_tools_return_ledger_views() {
        let tools = LedgerTools::new(FakeHost::ledger(TrustMode::ReadOnly));

        let accounts = text_of(&tools.list_accounts().await.unwrap());
        assert!(accounts.contains("Cash"), "accounts: {accounts}");

        let categories = text_of(&tools.list_categories().await.unwrap());
        assert!(categories.starts_with('['), "categories: {categories}");

        let balances = text_of(&tools.get_balances().await.unwrap());
        assert!(balances.contains("Cash"), "balances: {balances}");

        let summary = text_of(
            &tools
                .summary(Parameters(SummaryParams {
                    from: "2026-11-01".to_string(),
                    to: "2026-11-30".to_string(),
                }))
                .await
                .unwrap(),
        );
        assert!(summary.contains("netCents"), "summary: {summary}");
    }

    #[tokio::test]
    async fn test_query_transactions_passes_filters_and_clamps_limit() {
        let tools = LedgerTools::new(FakeHost::ledger(TrustMode::ReadOnly));
        // limit 0 clamps up to 1 instead of returning nothing.
        let page = text_of(
            &tools
                .query_transactions(Parameters(QueryTransactionsParams {
                    from_date: Some("2026-11-01".to_string()),
                    to_date: Some("2026-11-30".to_string()),
                    account_id: None,
                    category_id: None,
                    keyword: Some("coffee".to_string()),
                    limit: Some(0),
                }))
                .await
                .unwrap(),
        );
        assert_eq!(page.trim(), "[]", "no matching transactions yet");
    }

    #[tokio::test]
    async fn test_record_transaction_rejects_unknown_kind() {
        let tools = LedgerTools::new(FakeHost::ledger(TrustMode::Trust));
        let result = tools
            .record_transaction(Parameters(RecordTransactionParams {
                kind: "borrow".to_string(),
                amount_cents: 100,
                date: None,
                description: None,
                source_account: None,
                destination_account: None,
                category: None,
                idempotency_key: None,
            }))
            .await
            .unwrap();
        assert!(failed(&result));
        assert!(
            text_of(&result).contains("expense, income or transfer"),
            "{}",
            text_of(&result)
        );
    }

    #[tokio::test]
    async fn test_readonly_mode_rejects_every_write() {
        let tools = LedgerTools::new(FakeHost::ledger(TrustMode::ReadOnly));

        let record = tools
            .record_transaction(Parameters(expense_args()))
            .await
            .unwrap();
        assert!(failed(&record));
        assert!(text_of(&record).contains("read-only"));

        let create = tools
            .create_account(Parameters(CreateAccountParams {
                path: "Assets/Alipay".to_string(),
                description: None,
                opening_balance_cents: None,
                opening_balance_date: None,
                idempotency_key: None,
            }))
            .await
            .unwrap();
        assert!(failed(&create));
        assert!(text_of(&create).contains("read-only"));
    }

    #[tokio::test]
    async fn test_write_is_denied_when_settings_are_unreadable() {
        let tools = LedgerTools::new(FakeHost::config_unreadable());
        let result = tools
            .record_transaction(Parameters(expense_args()))
            .await
            .unwrap();
        assert!(failed(&result));
        assert!(text_of(&result).contains("settings unreadable"));
    }

    #[tokio::test]
    async fn test_trust_mode_writes_without_asking() {
        let host = FakeHost::ledger_trusting_accounts(TrustMode::Trust);
        let tools = LedgerTools::new(host.clone());

        let record = tools
            .record_transaction(Parameters(expense_args()))
            .await
            .unwrap();
        assert!(!failed(&record), "{}", text_of(&record));
        assert!(text_of(&record).contains("transactionId"));

        let create = tools
            .create_account(Parameters(CreateAccountParams {
                path: "Assets/Alipay".to_string(),
                description: Some("wallet".to_string()),
                opening_balance_cents: Some(10_000),
                opening_balance_date: Some("2026-11-14".to_string()),
                idempotency_key: None,
            }))
            .await
            .unwrap();
        assert!(!failed(&create), "{}", text_of(&create));
        assert!(text_of(&create).contains("accountId"));
    }

    #[tokio::test]
    async fn test_create_account_is_gated_independently_of_trust() {
        // Trust lets the agent record spending; it does not let it invent
        // accounts (design doc 25, §4.3).
        let tools = LedgerTools::new(FakeHost::ledger(TrustMode::Trust));
        let result = tools
            .create_account(Parameters(CreateAccountParams {
                path: "Assets/New".to_string(),
                description: None,
                opening_balance_cents: None,
                opening_balance_date: None,
                idempotency_key: None,
            }))
            .await
            .unwrap();
        assert!(failed(&result));
        assert!(
            text_of(&result).contains("switched off"),
            "{}",
            text_of(&result)
        );
    }

    #[tokio::test]
    async fn test_locked_ledger_fails_every_tool() {
        let tools = LedgerTools::new(FakeHost::locked());
        let result = tools.list_accounts().await.unwrap();
        assert!(failed(&result));
        assert!(text_of(&result).contains("databaseLocked"));
    }

    // ---------------------------------------------------------------------
    // Idempotency (design doc 25, §6)
    // ---------------------------------------------------------------------

    /// How many transactions the fake ledger actually holds.
    fn transaction_count(host: &FakeHost) -> i64 {
        let Backing::Db { db, .. } = &host.backing else {
            panic!("not a ledger-backed host");
        };
        let conn = db.get_conn().unwrap();
        conn.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0))
            .unwrap()
    }

    fn keyed(mut args: RecordTransactionParams, key: &str) -> RecordTransactionParams {
        args.idempotency_key = Some(key.to_string());
        args
    }

    #[tokio::test]
    async fn test_same_key_writes_once_and_replays_the_result() {
        let host = FakeHost::ledger(TrustMode::Trust);
        let tools = LedgerTools::new(host.clone());

        let first = tools
            .record_transaction(Parameters(keyed(expense_args(), "retry-1")))
            .await
            .unwrap();
        assert!(!failed(&first), "{}", text_of(&first));

        let retry = tools
            .record_transaction(Parameters(keyed(expense_args(), "retry-1")))
            .await
            .unwrap();
        assert!(!failed(&retry), "{}", text_of(&retry));

        assert_eq!(
            text_of(&first),
            text_of(&retry),
            "a retry must replay the first result, not write again"
        );
        assert_eq!(transaction_count(&host), 1, "exactly one transaction");
    }

    #[tokio::test]
    async fn test_without_a_key_each_call_writes() {
        let host = FakeHost::ledger(TrustMode::Trust);
        let tools = LedgerTools::new(host.clone());

        tools
            .record_transaction(Parameters(expense_args()))
            .await
            .unwrap();
        tools
            .record_transaction(Parameters(expense_args()))
            .await
            .unwrap();

        assert_eq!(
            transaction_count(&host),
            2,
            "no key means no protection, same as before"
        );
    }

    #[tokio::test]
    async fn test_in_flight_key_is_reported_not_written() {
        let host = FakeHost::ledger(TrustMode::Trust);
        {
            let Backing::Db { db, .. } = &host.backing else {
                panic!("not a ledger-backed host");
            };
            let conn = db.get_conn().unwrap();
            // A concurrent call claimed the key and has not finished.
            crate::db::idempotency::claim(&conn, "record_transaction", "busy-1").unwrap();
        }

        let tools = LedgerTools::new(host.clone());
        let result = tools
            .record_transaction(Parameters(keyed(expense_args(), "busy-1")))
            .await
            .unwrap();

        assert!(failed(&result));
        assert!(
            text_of(&result).contains("still being processed"),
            "{}",
            text_of(&result)
        );
        assert_eq!(
            transaction_count(&host),
            0,
            "nothing was written in parallel"
        );
    }

    #[tokio::test]
    async fn test_failed_write_releases_the_key() {
        let host = FakeHost::ledger(TrustMode::Trust);
        let tools = LedgerTools::new(host.clone());

        // Unknown account: the ledger rejects the write, so the claim must be
        // released instead of pinning the key.
        let mut broken = keyed(expense_args(), "retry-2");
        broken.source_account = Some("Nowhere".to_string());
        let rejected = tools.record_transaction(Parameters(broken)).await.unwrap();
        assert!(failed(&rejected), "{}", text_of(&rejected));

        let retried = tools
            .record_transaction(Parameters(keyed(expense_args(), "retry-2")))
            .await
            .unwrap();
        assert!(!failed(&retried), "{}", text_of(&retried));
        assert_eq!(transaction_count(&host), 1);
    }

    #[tokio::test]
    async fn test_same_key_on_two_tools_is_independent() {
        let host = FakeHost::ledger_trusting_accounts(TrustMode::Trust);
        let tools = LedgerTools::new(host.clone());

        tools
            .record_transaction(Parameters(keyed(expense_args(), "shared")))
            .await
            .unwrap();

        let created = tools
            .create_account(Parameters(CreateAccountParams {
                path: "Assets/Wallet".to_string(),
                description: None,
                opening_balance_cents: None,
                opening_balance_date: None,
                idempotency_key: Some("shared".to_string()),
            }))
            .await
            .unwrap();

        assert!(
            !failed(&created),
            "different tools do not share a key space: {}",
            text_of(&created)
        );
    }

    // ---------------------------------------------------------------------
    // Resources (design doc 25, §5.6)
    // ---------------------------------------------------------------------

    #[test]
    fn test_month_bounds_covers_the_whole_month() {
        assert_eq!(
            month_bounds("2026-11"),
            Some(("2026-11-01".to_string(), "2026-11-30".to_string()))
        );
        assert_eq!(month_bounds("2026-12").unwrap().1, "2026-12-31");
        assert_eq!(month_bounds("2026-02").unwrap().1, "2026-02-28");
        assert_eq!(month_bounds("2028-02").unwrap().1, "2028-02-29");
        assert!(month_bounds("2026-13").is_none());
        assert!(month_bounds("nope").is_none());
    }

    #[test]
    fn test_static_resources_advertise_the_current_month() {
        let resources = static_resources("2026-11-14");
        assert_eq!(resources.len(), 3);
        assert!(resources.iter().any(|r| r.uri == ACCOUNTS_URI));
        assert!(resources.iter().any(|r| r.uri == CATEGORIES_URI));
        assert!(
            resources
                .iter()
                .any(|r| r.uri == "glimmerx://report/2026-11"),
            "the listed report is the current month"
        );
        assert!(resources
            .iter()
            .all(|r| r.mime_type.as_deref() == Some(JSON_MIME)));
    }

    #[test]
    fn test_report_template_is_a_uri_template() {
        let template = report_template();
        assert_eq!(template.uri_template, "glimmerx://report/{month}");
        assert_eq!(template.mime_type.as_deref(), Some(JSON_MIME));
    }

    fn text_of_resource(result: &ReadResourceResult) -> (&str, String) {
        match &result.contents[0] {
            ResourceContents::TextResourceContents {
                mime_type, text, ..
            } => (mime_type.as_deref().unwrap_or(""), text.clone()),
            other => panic!("expected text contents, got {other:?}"),
        }
    }

    #[test]
    fn test_read_uri_serves_accounts_categories_and_report() {
        let tools = LedgerTools::new(FakeHost::ledger(TrustMode::ReadOnly));

        let accounts = tools.read_uri(ACCOUNTS_URI).unwrap();
        let (mime, text) = text_of_resource(&accounts);
        assert_eq!(mime, JSON_MIME);
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert!(
            parsed
                .as_array()
                .unwrap()
                .iter()
                .any(|account| account["name"] == "Cash"),
            "accounts resource: {text}"
        );

        let categories = tools.read_uri(CATEGORIES_URI).unwrap();
        let (_, text) = text_of_resource(&categories);
        assert!(serde_json::from_str::<serde_json::Value>(&text).is_ok());

        let report = tools.read_uri("glimmerx://report/2026-11").unwrap();
        let (_, text) = text_of_resource(&report);
        assert!(text.contains("netCents"), "report resource: {text}");
    }

    #[test]
    fn test_read_uri_rejects_unknown_uris_and_bad_months() {
        let tools = LedgerTools::new(FakeHost::ledger(TrustMode::ReadOnly));
        assert!(tools.read_uri("glimmerx://nope").is_err());
        assert!(tools.read_uri("glimmerx://report/2026-13").is_err());
        assert!(tools.read_uri("glimmerx://report").is_err());
    }

    #[test]
    fn test_read_uri_on_locked_ledger_is_an_error() {
        let tools = LedgerTools::new(FakeHost::locked());
        assert!(tools.read_uri(ACCOUNTS_URI).is_err());
    }
}
