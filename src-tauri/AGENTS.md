# src-tauri

Rust 后端：所有数据读写都在这里，前端只经 Tauri 命令拿结果。数据模型见
[docs/design/02](../docs/design/02-data-model.md)，工程约束见
[05](../docs/design/05-constraints.md)，交易链路见
[07](../docs/design/07-transactions.md)，AI/MCP 见
[11](../docs/design/11-ai-mcp.md)。

## 模块地图

| 模块 | 职责 |
| --- | --- |
| `commands/` | 命令层：反序列化、十进制字符串转整数分、持有事务、拼 DTO。不写 SQL。 |
| `db/` | 数据层：SQL、事务、迁移（`schema_v1|v2|v3.sql` + `migrations.rs`），按域拆子模块。 |
| `ledger/` | 能力层：AI 与 MCP 共用的语义化读写（`record_transaction` / `create_account` / `query_transactions` / `period_summary`）。写账本的唯一入口，自身不写 SQL。 |
| `mcp/` | 进程内 MCP 服务（`rmcp` + axum，只绑 `127.0.0.1`）。`rmcp` 类型不得出现在 `mcp/` 之外。 |
| `services/` | 外部服务调用（AI 解析与校验）。 |
| `errors.rs` | 错误渲染：`render` / `message` / `user_text`。`errors/messages.rs` 由 `tools/gen_error_messages.py` 生成，不手改。 |
| `utils/` | `time`（本地时区）、`money`（金额解析）等基础工具。 |

## 三条边界

- **事务归属**：`create_transaction` 自身不开事务，由调用方持有；`quick_add_transaction`
  / `update_transaction` / `delete_transaction` 自己开（`quick_add` 用
  `unchecked_transaction` 以保持 `&Connection` 签名）。命令层不得再套一层。
- **金额与日期**：入参在命令层是十进制字符串，经 `utils::money::parse_amount_to_cents`
  转整数分（`i64`，上限 `10_000_000_000`）；平衡校验用 `i128` 求和。日期一律本地时区。
- **错误**：命令统一返回 `Result<T, String>`，`Err` 里是已本地化的用户文案
  （`AppError::Display`）。不返回英文内部错误，不返回键名。

## 测试

`cargo test`（`make test-backend`）；测试与被测模块同目录（`db/transactions/tests/`、
`mcp/tests.rs`、`ledger/tests.rs`），用内存 SQLite 隔离。门禁：`make coverage` 行覆盖
≥ 94%，排除 `lib.rs` / `main.rs` / 生成的 `errors/messages.rs`。
