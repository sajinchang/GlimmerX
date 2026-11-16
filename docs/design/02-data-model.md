# 02 · 数据模型

> 返回 [DESIGN.md](../DESIGN.md)。概念解释见 [01](01-overview.md)，升级决策见
> [09](09-double-entry.md)。**以 `src-tauri/src/db/schema_v1|v2|v3.sql`
> 为唯一真相**，本文只记结构与不变量，不复制 DDL。

## 三条不变量

1. **分录是唯一真相**。余额、分类、收支统计全部由 `postings` 聚合或派生，
   `transactions` 上不存任何可被聚合得出的缓存列（`category_id` 已于 v3 删除）。
2. **借贷必须平衡**。同一交易的 `SUM(postings.amount) = 0`，求和用 `i128` 防溢出。
3. **金额是整数分**（`INTEGER`，`i64`），上限 `10_000_000_000`（1 亿元）。

## 表清单（v3 后的形态）

### accounts / account_meta

| 列 | 说明 |
| --- | --- |
| `id`, `name`, `type` | `type ∈ {asset, liability, income, expense, equity}`；`UNIQUE(type, name)` |
| `currency` | 固定 `'CNY'`，为 v1 冻结保留；领域层与 DTO 均不暴露 |
| `description`, `account_number`, `iban` | 可选文本 |
| `is_system` | 系统账户（Equity / Opening Balances）不可删、不可由交易引用 |
| `is_active` | 停用账户不参与名称解析、不能记账 |
| `include_net_worth` | 仅 asset/liability 有意义；损益账户恒 0 |

`account_meta(account_id, key, value)` 存扩展字段（账户角色、负债/信用卡子类型等），
`UNIQUE(account_id, key)`，随账户级联删除。

### transactions / postings

| transactions | 说明 |
| --- | --- |
| `id` | UUID v4 |
| `date` | `YYYY-MM-DD`，业务日期（本地时区） |
| `description` | 可空串 |
| `created_at`, `updated_at` | RFC3339，后端生成 |

| postings | 说明 |
| --- | --- |
| `transaction_id` | 外键，`ON DELETE CASCADE`（删除仍走显式 DELETE 以便顺序可控） |
| `account_id` | 指向账户；分类侧分录落在分类的镜像账户上 |
| `amount` | 整数分，正=借方、负=贷方 |
| `sequence` | 显示顺序（写入时的数组下标） |
| `cleared` | 分录级对账标记（v2 起，替代整笔 `is_reconciled`） |
| `reconcile_id` | 所属对账单；非空即"已核对"，编辑/删除交易会被拒 |

`transactions` 上**没有** `transaction_type`、`category_id`、`deleted_at`、
`is_reconciled`：前两个从未需要（语义由分录决定），后两个在 v2/v3 被删。

### categories

| 列 | 说明 |
| --- | --- |
| `name`, `type` | `type ∈ {income, expense}`，`UNIQUE(type, name)` |
| `icon` | 可选 |
| `account_id` | **1:1** 指向同名损益账户；部分唯一索引 `idx_categories_account`（NULL 不参与） |

分类在账本里不是独立维度：读分类 = 沿 `postings.account_id → categories.account_id`
反查。分类与镜像账户的创建/改名/删除都在同一事务内完成。

### budgets

| 列 | 说明 |
| --- | --- |
| `category_id` | 外键，`UNIQUE`：每个分类至多一个预算 |
| `amount` | 整数分，必须为正；**仅当前限额**，历史见 `budget_amount_history` |
| `period` | `monthly` / `weekly` |
| `rollover` | 开启后上期结余滚入本期（后端算，最多回溯 260 期，每期先 `max(0)`，历史期按当时生效限额重放） |

### budget_amount_history

| 列 | 说明 |
| --- | --- |
| `budget_id` | 外键 `ON DELETE CASCADE`；随预算删除而清理 |
| `amount` | 整数分，该次变更后的限额 |
| `effective_from` | 变更生效时刻（RFC3339）；重放按**周期结束日**之前最新的行取值，期内变更作用于当期 |

v4 起每次限额变更追加一行；`create_budget` 写入首行。迁移回填为"自创建日起
即当前限额"——对存量预算重放结果与 v3 完全一致，精度从下一次变更开始。

### reconciliations / savings_goals

| reconciliations | 说明 |
| --- | --- |
| `account_id`, `statement_date` | `UNIQUE(account_id, statement_date)` |
| `opening_balance`, `closing_balance` | 对账单期初期末（对账单符号，见 [09](09-double-entry.md) §2） |

| savings_goals | 说明 |
| --- | --- |
| `account_id` | `UNIQUE`，指向专用资产账户；进度 = 该账户余额 |
| `target_amount` | `> 0` |
| `target_date`, `monthly_plan` | 可选 |
| `status` | `active` / `achieved` / `archived`（达成后不回退，需手动改） |

### settings / automation_idempotency / legacy_transaction_categories

| 表 | 用途 |
| --- | --- |
| `settings(key, value)` | 加密库内的键值配置（MCP 四个键、AI 配置等） |
| `automation_idempotency` | `PRIMARY KEY(tool, idempotency_key)`，`status ∈ {in_flight, done}`，30 天清理（见 [11](11-ai-mcp.md) §6） |
| `legacy_transaction_categories` | v3 删列前的归档：`transaction_id → category_id`，仅供事后核对，无读取方、无外键 |

## 索引

| 索引 | 服务对象 |
| --- | --- |
| `idx_accounts_type_name`（唯一） | 账户按名字解析、防重名 |
| `idx_accounts_type` | 账户页按类型过滤 |
| `idx_transactions_date` | 列表/报表日期范围 |
| `idx_postings_transaction` | 取交易分录、分类 `EXISTS` 子查询 |
| `idx_postings_account` | 账户交易列表、账户筛选 |
| `idx_postings_account_cleared` | 对账候选、已对账汇总 |
| `idx_postings_reconcile` | 撤销对账 |
| `idx_categories_type_name`（唯一）, `idx_categories_type` | 分类查重与按类型列举 |
| `idx_categories_account`（唯一，部分） | 分类 ↔ 镜像账户 1:1 |
| `idx_budgets_category`（唯一） | 分类唯一预算 |
| `idx_reconciliations_account` | 对账单按账户查 |

## 派生对象

- `v_posting_category`（v2 视图）：`postings → accounts → categories` 的只读投影，
  报表迁移期用于核对分类口径，保留供排查。
- 余额：`get_account_balances_batch` / `SUM(postings.amount)`，**不落库**。
- 列表金额：`display_amount`（借方合计，恒 ≥ 0）与 `flow_amount`（资产/负债侧净额），
  均在 SQL 中聚合（见 [08](08-transaction-list.md) §3.3）。

## 迁移规则

- `schema_v1.sql` **冻结**（`tests::test_schema_v1_is_frozen` 会在首次修改时报错）；
  任何变更只能新增 `schema_vN.sql` 并在 `db/migrations.rs` 注册。
- 每条迁移语句幂等；连接级 `PRAGMA` 由 `migrations::migrate` 在事务外执行。
- 顺序敏感：`postings.cleared` 先 ADD 再回填，回填必须在 drop `is_reconciled` 之前；
  drop 列前先 `DROP INDEX`；迁移前自动落 `.db.bak-YYYYmmdd-HHMMSS`。
- 删列不可逆，故 v3 先把 `category_id` 归档到 `legacy_transaction_categories`。

前端类型定义（`src/types/*.ts`）与 IPC DTO 一一对应，字段名 camelCase；DB 层结构体
与 MCP 直接返回的结构保持 snake_case。类型不以文档为准，以代码为准。
