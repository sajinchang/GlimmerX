# 03 · Tauri 命令索引

> 返回 [DESIGN.md](../DESIGN.md)。**签名以 `src-tauri/src/commands/*.rs` 为准**，
> 本文只做导航与约定说明，不复制参数表。

## 约定

- 命令名 snake_case，前端用 `invoke("<name>", { ... })`；参数与返回值一律 camelCase
  （Rust 侧 `#[serde(rename_all = "camelCase")]`）。
- 所有命令返回 `Result<T, String>`；`Err` 里是**已经本地化**的用户文案，前端直接展示。
- 金额入参在命令层是十进制字符串，进数据层前转整数分；出参是整数分。
- 前端唯一封装入口 `src/utils/api.ts`（类型化包装 + 统一错误处理），业务代码不直接
  `invoke`。
- 需要数据库的命令都先取 `AppState.database`，锁定时返回 `errors.databaseLocked`。

## 账本与安全（`commands/db.rs`）

| 命令 | 用途 |
| --- | --- |
| `db_create` | 新建加密库（路径 + 密码 + 初始账户） |
| `db_unlock` / `db_lock` | 解锁（打开连接）/ 锁定（checkpoint 后丢弃连接与密钥） |
| `db_change_password` | 原地改密 |
| `db_check_exists` / `db_check_any_exists` | 单库/任意库存在性探测 |
| `db_list_recent` / `db_remove_recent` | 最近账本列表与条目删除 |
| `db_is_unlocked` / `db_ping` | 会话状态 |
| `db_backup` | 复制加密库文件到指定路径（唯一的数据管理命令） |

## 账户（`commands/accounts.rs`）

| 命令 | 用途 |
| --- | --- |
| `account_create` / `account_batch_create` | 按路径建账户（含引导页批量建） |
| `account_list` / `account_balance` / `account_balances_batch` | 列表（可按 type 过滤）、单账户余额、批量余额 |
| `account_update` / `account_delete` | 编辑（改名同步分类镜像账户）/ 删除（有交易或为系统账户则拒） |
| `account_transfer` | 账户间转账（账户页专用路径） |
| `account_transactions` | 单账户交易明细 |
| `account_meta_get` / `account_meta_set` / `account_meta_batch_set` / `account_meta_schema` | 扩展字段读写与字段定义下发 |

## 交易（`commands/transactions.rs`）

| 命令 | 用途 |
| --- | --- |
| `transaction_create` | 手工分录录入（分数组提交） |
| `quick_add_transaction` | 快速记账：语义输入 → 后端推导分录 |
| `quick_replace_transaction` | 快速记账的"改单"：同一事务内删除 + 重建 |
| `transaction_list` / `transaction_list_paginated` | 时间线查询 / 列表页入口（筛选 + 排序 + 分页 + 日期分组） |
| `transaction_get` / `transaction_detail` | 轻量读取 / 详情（含借贷合计与平衡标记） |
| `transaction_update` | 编辑（分录整体重建） |
| `transaction_delete_preview` / `transaction_delete` | 删除预览（是否可删及原因）/ 硬删除 |

详见 [07](07-transactions.md) 与 [08](08-transaction-list.md)。

## 分类、预算、储蓄、对账

| 命令 | 用途 |
| --- | --- |
| `category_list` / `category_create` / `category_update` / `category_delete` | 分类 CRUD（与镜像账户同事务） |
| `category_delete_preview` | 删除影响预览（绑定预算、交易笔数） |
| `budget_list` / `budget_list_statuses` | 预算定义 / 带进度的状态（含滚存） |
| `budget_create` / `budget_update` / `budget_delete` | 预算 CRUD（每分类唯一） |
| `savings_list` / `savings_create` / `savings_update` / `savings_set_status` / `savings_delete` | 储蓄目标（账户为载体） |
| `reconcile_preview` / `reconcile_auto_match` / `reconcile_totals` | 对账候选、自动预勾选、差额计算 |
| `reconcile_create` / `reconcile_list` / `reconcile_undo` | 提交对账、历史、撤销 |

## 报表与概览

| 命令 | 用途 |
| --- | --- |
| `report_standard` | 标准财务报表（收支汇总 + 净资产 + 对比） |
| `report_category_breakdown` | 分类分析 |
| `report_balance_sheet` | 资产负债表 |
| `report_trend` | 收支趋势（日/周/月/年） |
| `report_account_transactions` / `report_account_balance_trend` | 单账户明细 / 余额趋势 |
| `report_audit` | 审计（交易与对账一致性检查，入口在设置页） |
| `dashboard_summary` / `dashboard_monthly_chart` / `dashboard_category_breakdown` / `dashboard_top_expenses` | 首页四块聚合 |

口径见 [10](10-reports.md)。

## AI、MCP、设置

| 命令 | 用途 |
| --- | --- |
| `ai_parse_transaction` | 解析自然语言 → 判别式提案（**只提案，不写库**） |
| `ai_test_connection` | 校验 AI 服务配置 |
| `mcp_get_config` / `mcp_set_config` / `mcp_reset_token` | MCP 开关/端口/信任档/建账户开关、令牌重置（库锁定时均不可用） |
| `get_setting` / `set_setting` | 加密库内键值设置 |
| `set_ui_language` | 同步界面语言到后端（错误消息本地化用） |

AI 与 MCP 见 [11](11-ai-mcp.md)。

## 错误处理

后端错误类型（`src-tauri/src/db/mod.rs::AppError`）：

| 变体 | 含义 |
| --- | --- |
| `DatabaseError(String)` | SQL / SQLCipher 失败 |
| `InvalidPassword` | 密码错误 |
| `NotFound(String)` | 资源不存在 |
| `ValidationError(String)` | 参数或业务规则不通过 |
| `IoError(String)` | 文件读写 |
| `AiError(String)` | AI 调用失败（`errors.ai.<code>`） |

规则：

- `Display` 统一走 `errors::render`：`errors.*` 键渲染成当前界面语言的文案；非键文本
  原样返回；键缺失时打日志并回退 `unknownError` 文案，**绝不把键名暴露给用户**。
- 另两处入口：`errors::message(key)` 给自己拼文案的调用方；`errors::user_text(raw)`
  走同一渲染后再兜一层——纯 ASCII 的内部文本（rusqlite 报错、遗留英文串）替换为
  `errors.databaseError` 并写 stderr，已本地化的文本原样通过。
- 文案表由 `src/i18n/locales/{zh,en}.json` 生成到 `src-tauri/src/errors/messages.rs`，
  由 `python tools/gen_error_messages.py --check` 校验（`make check` 与 CI 都跑）。
- 语言由 `set_ui_language` 同步，默认中文。

前端：

- `src/utils/errorTranslation.ts` 原样展示后端字符串，只对非字符串/无消息的异常回退
  通用文案；不翻译、不裁剪、不重组。
- 失败提示走 Toast；表单校验错误内联在字段下方；删除类操作先弹确认框。
- 未解锁时统一跳转 `/unlock`，不在错误里做二次判断。
