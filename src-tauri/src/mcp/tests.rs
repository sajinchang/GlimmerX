//! Integration tests for the MCP server: a real mock app, a real axum
//! server on loopback, real JSON-RPC POSTs. This is the only layer that can
//! reach the macro-generated tool dispatch, the auth middleware and the
//! Streamable HTTP assembly at once.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Manager;

use crate::db::{Database, RecentDbs};
use crate::mcp::{McpHost, McpRuntime};
use crate::AppState;

/// Unique port per test so parallel test threads never collide.
fn setup_app(trust: &str, port: u16) -> (tauri::App<tauri::test::MockRuntime>, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::create(&dir.path().join("t.db"), "pw").unwrap();
    {
        let conn = db.get_conn().unwrap();
        crate::db::settings::set_setting(&conn, "mcp.enabled", "true").unwrap();
        crate::db::settings::set_setting(&conn, "mcp.port", &port.to_string()).unwrap();
        crate::db::settings::set_setting(&conn, "mcp.trust", trust).unwrap();
        crate::db::accounts::create_account_with_path(&conn, "Assets/Cash", None).unwrap();
        crate::db::accounts::create_account_with_path(&conn, "Assets/WeChat", None).unwrap();
    }
    let state = AppState {
        database: Mutex::new(Some(db)),
        recent_dbs: Mutex::new(RecentDbs::empty()),
    };
    let app = tauri::test::mock_builder()
        .manage(state)
        .manage(McpRuntime::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    // The same injection the production `.setup()` hook performs.
    let runtime = app.state::<McpRuntime>();
    runtime.set_handle(Arc::new(app.handle().clone()) as Arc<dyn McpHost>);
    crate::mcp::sync_from(&app.state::<McpRuntime>());
    (app, dir)
}

fn stop(app: &tauri::App<tauri::test::MockRuntime>) {
    crate::mcp::sync_from(&app.state::<McpRuntime>());
}

async fn wait_up(client: &reqwest::Client, url: &str, token: &str) -> reqwest::Response {
    for _ in 0..100 {
        if let Ok(resp) = client
            .post(url)
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({
                "jsonrpc": "2.0", "id": 1, "method": "ping", "params": {}
            }))
            .send()
            .await
        {
            return resp;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("MCP server never came up at {url}");
}

/// Loopback HTTP client for the integration tests.
///
/// `no_proxy()` is deliberate: a developer or CI machine with `HTTP_PROXY` set
/// would otherwise send these 127.0.0.1 requests through it and every
/// assertion here would see the proxy's 502 instead of our server.
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .build()
        .expect("client")
}

/// Read a JSON-RPC reply that may arrive as plain JSON or as an SSE frame
/// (`data: {...}`) — legacy sessions answer in SSE even with `json_response`.
fn parse_reply(text: &str) -> serde_json::Value {
    let trimmed = text.trim();
    if trimmed.starts_with('{') {
        return serde_json::from_str(trimmed).unwrap_or_else(|e| panic!("json body: {e}: {text}"));
    }
    for line in trimmed.lines() {
        if let Some(payload) = line.strip_prefix("data:") {
            if payload.trim_start().starts_with('{') {
                return serde_json::from_str(payload.trim())
                    .unwrap_or_else(|e| panic!("sse body: {e}: {text}"));
            }
        }
    }
    panic!("no JSON-RPC payload in response: {text}");
}

/// Post one JSON-RPC request as a 2026-07-28 client: the version header plus
/// the per-request `_meta` the strict server now demands (design doc 25, §5.5).
async fn call(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    method: &str,
    mut params: serde_json::Value,
) -> serde_json::Value {
    if method != "initialize" {
        if let Some(object) = params.as_object_mut() {
            object.insert(
                "_meta".to_string(),
                serde_json::json!({
                    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                    "io.modelcontextprotocol/clientCapabilities": {}
                }),
            );
        }
    }
    // SEP-2243: a 2026-07-28 request also carries routing headers so a proxy
    // can dispatch without parsing the body.
    let mut request = client
        .post(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json, text/event-stream")
        .header("MCP-Protocol-Version", "2026-07-28")
        .header("Mcp-Method", method);
    // `Mcp-Name` identifies the addressed thing: the tool for `tools/call`,
    // the URI for `resources/read`.
    let addressed = params
        .get("name")
        .or_else(|| params.get("uri"))
        .and_then(|value| value.as_str());
    if let Some(addressed) = addressed {
        request = request.header("Mcp-Name", addressed);
    }
    let resp = request
        .json(&serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": method, "params": params
        }))
        .send()
        .await
        .expect("request");
    let status = resp.status();
    let body = resp.text().await.expect("body");
    assert!(status.is_success(), "{method} failed: {status}: {body}");
    serde_json::from_str(&body).expect("json body")
}

/// Run a closure on the app's database; every guard stays inside.
fn with_app_conn<T>(
    app: &tauri::App<tauri::test::MockRuntime>,
    f: impl FnOnce(&rusqlite::Connection) -> T,
) -> T {
    let state = app.state::<AppState>();
    let guard = state.database.lock().unwrap();
    let db = guard.as_ref().expect("db");
    let conn = db.get_conn().expect("conn");
    f(&conn)
}

/// Result content as text (MCP wraps tool output in content blocks).
fn tool_text(result: &serde_json::Value) -> String {
    result["result"]["content"][0]["text"]
        .as_str()
        .expect("text content")
        .to_string()
}

fn token_of(app: &tauri::App<tauri::test::MockRuntime>) -> String {
    with_app_conn(app, |conn| {
        crate::mcp::settings::load_config(conn).unwrap().token
    })
}

#[tokio::test]
async fn test_unauthorized_without_token() {
    let (app, _dir) = setup_app("readonly", 19501);
    let client = client();
    let url = "http://127.0.0.1:19501/mcp".to_string();
    wait_up(&client, &url, &token_of(&app)).await;

    let resp = client
        .post(&url)
        .header("Accept", "application/json, text/event-stream")
        .json(&serde_json::json!({"jsonrpc":"2.0","id":1,"method":"ping","params":{}}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);
    stop(&app);
}

#[tokio::test]
async fn test_tools_list_and_reads() {
    let (app, _dir) = setup_app("readonly", 19502);
    let client = client();
    let url = "http://127.0.0.1:19502/mcp".to_string();
    let token = token_of(&app);
    wait_up(&client, &url, &token).await;

    // 2026-07-28 replaced the initialize handshake with per-request metadata;
    // `server/discover` is the informational opener.
    let discover = call(
        &client,
        &url,
        &token,
        "server/discover",
        serde_json::json!({}),
    )
    .await;
    assert!(
        discover["result"].is_object(),
        "server/discover: {discover}"
    );
    assert!(
        discover["result"]["capabilities"]["resources"].is_object(),
        "resources announced: {discover}"
    );

    let list = call(&client, &url, &token, "tools/list", serde_json::json!({})).await;
    let names: Vec<&str> = list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    for expected in [
        "ledger_status",
        "list_accounts",
        "list_categories",
        "query_transactions",
        "get_balances",
        "summary",
        "record_transaction",
        "create_account",
    ] {
        assert!(names.contains(&expected), "missing tool {expected}");
    }

    // A read works in read-only mode.
    let accounts = call(
        &client,
        &url,
        &token,
        "tools/call",
        serde_json::json!({"name": "list_accounts", "arguments": {}}),
    )
    .await;
    let accounts = tool_text(&accounts);
    assert!(accounts.contains("Cash"), "accounts: {accounts}");
    assert!(accounts.contains("WeChat"), "accounts: {accounts}");

    // ledger_status reports the unlocked state and the trust mode.
    let status = call(
        &client,
        &url,
        &token,
        "tools/call",
        serde_json::json!({"name": "ledger_status", "arguments": {}}),
    )
    .await;
    let status = tool_text(&status);
    assert!(status.contains("readonly"), "status: {status}");
    assert!(status.contains("t.db"), "status: {status}");
    stop(&app);
}

#[tokio::test]
async fn test_readonly_rejects_writes() {
    let (app, _dir) = setup_app("readonly", 19503);
    let client = client();
    let url = "http://127.0.0.1:19503/mcp".to_string();
    let token = token_of(&app);
    wait_up(&client, &url, &token).await;

    let result = call(
        &client,
        &url,
        &token,
        "tools/call",
        serde_json::json!({
            "name": "record_transaction",
            "arguments": {"kind": "expense", "amount_cents": 1850, "source_account": "Cash", "category": "咖啡"}
        }),
    )
    .await;
    let text = tool_text(&result);
    assert!(text.contains("read-only"), "write in readonly: {text}");
    // isError marker present so the agent sees a tool-level failure.
    assert!(result["result"]["isError"].as_bool().unwrap_or(false));

    // Nothing landed in the ledger.
    let count: i64 = with_app_conn(&app, |conn| {
        conn.query_row("SELECT count(*) FROM transactions", [], |r| r.get(0))
            .unwrap()
    });
    assert_eq!(count, 0);
    stop(&app);
}

#[tokio::test]
async fn test_trust_mode_writes_directly() {
    let (app, _dir) = setup_app("trust", 19504);
    let client = client();
    let url = "http://127.0.0.1:19504/mcp".to_string();
    let token = token_of(&app);
    wait_up(&client, &url, &token).await;

    let result = call(
        &client,
        &url,
        &token,
        "tools/call",
        serde_json::json!({
            "name": "record_transaction",
            "arguments": {
                "kind": "expense",
                "amount_cents": 1850,
                "date": "2026-11-14",
                "description": "coffee",
                "source_account": "Cash",
                "category": "咖啡"
            }
        }),
    )
    .await;
    let text = tool_text(&result);
    assert!(text.contains("transactionId"), "outcome: {text}");
    assert!(text.contains("postings"), "outcome: {text}");

    let postings: i64 = with_app_conn(&app, |conn| {
        conn.query_row("SELECT count(*) FROM postings", [], |r| r.get(0))
            .unwrap()
    });
    // Expense posts twice: the asset account and the category's mirror
    // P&L account are one and the same account.
    assert_eq!(postings, 2);
    stop(&app);
}

#[tokio::test]
async fn test_locked_ledger_reports_locked() {
    let (app, _dir) = setup_app("trust", 19507);
    let client = client();
    let url = "http://127.0.0.1:19507/mcp".to_string();
    let token = token_of(&app);
    wait_up(&client, &url, &token).await;

    // Lock: same state transition db_lock performs.
    *app.state::<AppState>().database.lock().unwrap() = None;

    let result = call(
        &client,
        &url,
        &token,
        "tools/call",
        serde_json::json!({"name": "list_accounts", "arguments": {}}),
    )
    .await;
    let text = tool_text(&result);
    assert!(
        text.contains("解锁") || text.contains("lock"),
        "locked: {text}"
    );

    let status = call(
        &client,
        &url,
        &token,
        "tools/call",
        serde_json::json!({"name": "ledger_status", "arguments": {}}),
    )
    .await;
    assert!(tool_text(&status).contains("解锁"));
    stop(&app);
}

#[tokio::test]
async fn test_legacy_client_can_initialize_and_call() {
    // WorkBuddy and friends still open with `initialize` and expect a session
    // id. Served through the legacy session path; 2026-07-28 clients stay
    // stateless (design doc 25, §5.5).
    let (app, _dir) = setup_app("readonly", 19509);
    let client = client();
    let url = "http://127.0.0.1:19509/mcp".to_string();
    let token = token_of(&app);
    wait_up(&client, &url, &token).await;

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json, text/event-stream")
        .json(&serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "old", "version": "1.0"}
            }
        }))
        .send()
        .await
        .expect("request");

    let status = resp.status();
    let session = resp
        .headers()
        .get("Mcp-Session-Id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let body = parse_reply(&resp.text().await.expect("body"));

    assert!(status.is_success(), "initialize: {body}");
    assert!(
        body.get("error").is_none(),
        "an old client must negotiate, not be rejected: {body}"
    );
    assert_eq!(body["result"]["protocolVersion"], "2025-11-25");
    assert!(!session.is_empty(), "legacy clients need a session id");

    // The handshake notification is part of the legacy flow.
    client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Mcp-Session-Id", &session)
        .header("Accept", "application/json, text/event-stream")
        .json(&serde_json::json!({
            "jsonrpc": "2.0", "method": "notifications/initialized"
        }))
        .send()
        .await
        .expect("initialized notification");

    // No `_meta`, no version header: the old transport does not send them.
    let list = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Mcp-Session-Id", &session)
        .header("Accept", "application/json, text/event-stream")
        .json(&serde_json::json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}
        }))
        .send()
        .await
        .expect("tools/list");
    let list = parse_reply(&list.text().await.expect("body"));
    let names = list["result"]["tools"]
        .as_array()
        .unwrap_or_else(|| panic!("tools/list failed: {list}"))
        .len();
    assert_eq!(names, 8, "all tools are visible to a legacy client");

    stop(&app);
}

#[tokio::test]
async fn test_resources_list_and_read() {
    let (app, _dir) = setup_app("readonly", 19510);
    let client = client();
    let url = "http://127.0.0.1:19510/mcp".to_string();
    let token = token_of(&app);
    wait_up(&client, &url, &token).await;

    let list = call(
        &client,
        &url,
        &token,
        "resources/list",
        serde_json::json!({}),
    )
    .await;
    let uris: Vec<&str> = list["result"]["resources"]
        .as_array()
        .expect("resources array")
        .iter()
        .map(|r| r["uri"].as_str().expect("uri"))
        .collect();
    assert!(uris.contains(&"glimmerx://accounts"), "{uris:?}");
    assert!(uris.contains(&"glimmerx://categories"), "{uris:?}");

    let templates = call(
        &client,
        &url,
        &token,
        "resources/templates/list",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(
        templates["result"]["resourceTemplates"][0]["uriTemplate"],
        "glimmerx://report/{month}"
    );

    let accounts = call(
        &client,
        &url,
        &token,
        "resources/read",
        serde_json::json!({ "uri": "glimmerx://accounts" }),
    )
    .await;
    let text = accounts["result"]["contents"][0]["text"]
        .as_str()
        .expect("text contents");
    let parsed: serde_json::Value = serde_json::from_str(text).expect("json payload");
    assert!(
        parsed.is_array(),
        "accounts resource is a JSON array: {text}"
    );

    // Unknown URIs are a resource error, not an empty document.
    let missing = call(
        &client,
        &url,
        &token,
        "resources/read",
        serde_json::json!({ "uri": "glimmerx://nope" }),
    )
    .await;
    assert!(missing.get("error").is_some(), "unknown uri: {missing}");
    stop(&app);
}
