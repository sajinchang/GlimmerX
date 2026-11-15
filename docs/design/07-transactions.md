# 07 · 交易：架构、创建与快速记账

## 1. 分层与调用链

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 前端 | `src/components/transactions/QuickAddDialog.tsx`、`src/utils/api.ts` | 收集语义输入，通过 `src/utils/api.ts` 的封装调用 `invoke("quick_add_transaction" / "transaction_create", …)`；不计算任何金额 |
| command 层 | `src-tauri/src/commands/transactions.rs` | 参数反序列化、十进制字符串转整数分、开启/提交事务、拼装 DTO |
| db 层 | `src-tauri/src/db/transactions/{create,quick_add,update,delete,query,paginate,validate,types}.rs` | 分录推导、验证、SQL 写入与查询、聚合显示金额 |
| 能力层 | `src-tauri/src/ledger/{read,write,resolve,types}.rs` | 给 AI / MCP 用的语义化读写：`record_transaction`、`create_account`、`query_transactions`、`period_summary` |
| 数据 | `transactions` / `postings` / `accounts` / `categories` | 唯一真相：分录 |

调用链：

```text
手工模式  QuickAddDialog → api.ts → transaction_create   → db::transactions::create_transaction
快速记账  QuickAddDialog → api.ts → quick_add_transaction → db::transactions::quick_add_transaction
                                                              └→ categories::resolve_or_create（分类 + 镜像账户）
                                                              └→ derive_postings → create_transaction
AI / MCP  mcp::tools::record_transaction → ledger::record_transaction → db::transactions::quick_add_transaction
改单      quick_replace_transaction → db::transactions::replace_by_quick_add（删除 + 重建，同一事务）
```

db 层函数签名：

| 函数 | 说明 |
| --- | --- |
| `create_transaction(conn, date, description, postings: &[PostingInput]) -> tx_id` | 只接受整数分，验证后写 `transactions` + `postings`；**自身不开事务**，事务由调用方持有 |
| `quick_add_transaction(conn, input: &QuickAddInput) -> TransactionWithPostings` | 语义输入 → 推导分录 → 复用 `create_transaction`，内部持有一个事务 |
| `replace_by_quick_add(conn: &mut, tx_id, input)` | 同一事务内先删后建，重建失败不会丢原交易 |
| `update_transaction(conn: &mut, tx_id, input)` | 部分更新；传 `postings` 时整组重建 |
| `delete_transaction(conn: &mut, tx_id)` | 事务内显式删除分录再删交易行（硬删除） |

## 2. 核心决策：不存 transaction_type

`transactions` 表只有 `id, date, description, created_at, updated_at`，**没有** `transaction_type`，也**没有** `category_id`。支出 / 收入 / 转账只是输入侧的推导模式（`QuickAddInput.mode`），落库时只剩一组纯分录。

因此下列信息全部是**推导出来的**，不是存储的：

| 派生量 | 推导方式 |
| --- | --- |
| 交易属于「支出 / 收入 / 转账」 | 看分录里哪些账户是资产/负债账户（`flow_amount` 的符号） |
| 交易分类 | 分录账户若被某个分类绑定（`categories.account_id`），该分录就是分类侧 |
| 显示金额 `display_amount` | 借方合计（`SUM(amount > 0)`），恒 ≥ 0 |
| 现金流 `flow_amount` | 仅资产/负债分录的净额：支出为负、收入为正、自有账户间转账为 0 |
| 当日合计 `day_total` | 后端按日期分组累加 `display_amount` |

理由：多分录拆单、跨账户转账、期初余额等场景无法用单一枚举描述；一旦存了类型，就必须维护类型与分录的一致性，而分录本身已经完整表达了语义。类型只在 UI 层存在，删掉类型字段不会丢信息，但会少一类不一致。

## 3. 数据结构

### 3.1 Transaction

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `id` | TEXT (UUID v4) | 主键 |
| `date` | TEXT `YYYY-MM-DD` | 业务日期；快速记账不传则用本地当天（`utils::time::today_date`） |
| `description` | TEXT | 描述，可为空串 |
| `created_at` / `updated_at` | TEXT RFC3339 | 时间戳，均由后端生成 |

### 3.2 Posting

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `id` | TEXT (UUID v4) | 主键 |
| `transaction_id` | TEXT | 外键，级联查询依据 |
| `account_id` | TEXT | 账户；分类侧分录落在分类的镜像账户上 |
| `amount` | INTEGER | **整数分**，正数=借方（流入该账户），负数=贷方（流出） |
| `sequence` | INTEGER | 显示顺序，按入参数组下标写入 |
| `created_at` | TEXT RFC3339 | 时间戳 |
| `category_id` / `category_name` | 派生 | 不落库；由 `LEFT JOIN categories c ON c.account_id = a.id` 得到 |
| `cleared` / `reconcile_id` | — | 对账状态落在分录上，不在交易上 |

### 3.3 约束

- 金额单位统一为整数分（`i64`）。单笔上限 `MAX_AMOUNT_CENTS = 10_000_000_000`（1 亿）。
- 金额解析 `utils::money::parse_amount_to_cents` 全程整数运算：拒绝科学计数法、`inf`/`NaN`、千分位、多个小数点、超长输入；小数超过两位按「远离零」四舍五入（`"0.005"` → 1）。
- 分录数 ≥ 2；`SUM(amount) == 0`，求和用 `i128` 以免 i64 溢出绕过校验。
- 同一交易内账户不可重复。
- 后端不单独拒绝「金额为 0 的分录」；快速记账路径因要求金额为正，不会产出零金额分录。

最小示例（`transaction_create` 的 `input`）：

```json
{ "date": "2024-03-15", "description": "午餐",
  "postings": [ { "accountId": "expense-food", "amount": "35.00" },
                { "accountId": "asset-cash",  "amount": "-35.00" } ] }
```

## 4. 三种模式的分录推导

推导在 `db::transactions::quick_add::derive_postings`，只产出两条分录；多分录场景必须走手工模式。

| 模式 | 借方（+） | 贷方（−） | 必填 |
| --- | --- | --- | --- |
| `expense` | `destination_account_id`，否则分类的镜像账户 | `source_account_id` | `source_account_id`；且 `destination_account_id` 或 `category_id` 至少一个 |
| `income` | `destination_account_id` | `source_account_id`，否则分类的镜像账户 | `destination_account_id`；且 `source_account_id` 或 `category_id` 至少一个 |
| `transfer` | `destination_account_id` | `source_account_id` | 两端都必填，且不能相同 |

补充规则：

- 用户输入的 `amount` 必须是正数，符号由推导决定；`amount` 解析为分后再取负给贷方。
- `transfer` 两端调用 `accounts::validate_endpoint`：必须存在、`is_active`、类型为 `asset` 或 `liability`。缺这条校验，把支出分类账户当转账端点会凭空造出钱。
- `transfer` 不接受分类（含 `category_name`），语义上没有损益科目。
- `expense` 的贷方账户与 `income` 的借方账户（资金账户）**不**在 db 层校验必须是 `asset`/`liability`，只受通用校验约束（存在、active、非 equity）。
- 分类只对 `expense` / `income` 有意义，且类型必须匹配：`expense` 模式的分类必须是 `expense` 类型，`income` 模式必须是 `income` 类型。

### 分类镜像账户如何参与

分类不是账户，但每条分类必须落在一个损益账户上。`categories.account_id` 显式绑定唯一的 `income`/`expense` 账户，二者 1:1：

| 环节 | 行为 |
| --- | --- |
| 建分类 | `categories::create_category` 在同一事务内建分类行和镜像账户（名字=分类名，`type`=expense/income，`include_net_worth=0`，`is_system=0`），不存在「有分类无账户」的窗口 |
| 重命名 | 同时改账户名，先改账户再改分类（`idx_accounts_type_name` 唯一索引冲突要提前失败） |
| 删分类 | 镜像账户已有分录则拒绝；无分录则连同账户一起删 |
| 快速记账按名建分类 | `categories::resolve_or_create`：精确匹配（去首尾空白，区分大小写）→ 双向子串**首个**命中（不校验唯一，可能落到相近分类上）→ 新建；同时保证镜像账户存在 |
| 取镜像账户 | `categories::account_id_for_category` 直接读 `account_id` 列，不按名字反查 |
| 展示分类 | 分录 JOIN 到 `categories` 即为分类侧；拆单交易因此可以有多个分类（列表里 `category_names` 去重） |

关键 SQL 片段（列表聚合与分录详情共用同一思路）：

```sql
LEFT JOIN categories c ON c.account_id = a.id
```

## 5. 验证规则清单

| # | 规则 | 错误键 | 中文文案 |
| --- | --- | --- | --- |
| 1 | 分录至少 2 条 | `errors.transactionMinPostings` | 交易至少需要两个分录 |
| 2 | 所有分录金额之和为 0 | `errors.transactionUnbalanced` | 交易分录必须总和为零 |
| 3 | 账户必须存在 | `errors.accountNotFound` | 账户不存在 |
| 4 | 账户必须启用 | `errors.account.inactive` | 该账户已停用，无法使用 |
| 5 | 用户交易不得使用 equity 账户 | `errors.transaction.equityAccountRestricted` | 权益账户仅用于系统交易。 |
| 6 | 同一交易内账户不可重复 | `errors.transaction.duplicateAccount` | 同一账户不能在同一交易中出现多次 |
| 7 | 金额字符串合法且不超上限 | `errors.transaction.invalidAmount` | 金额格式无效 |
| 8 | 快速记账模式必须是 expense/income/transfer | `errors.transaction.invalidMode` | 交易类型无效 |
| 9 | 快速记账金额必须为正 | `errors.transaction.amountMustBePositive` | 金额必须为正数。 |
| 10 | 支出必须给出来源账户 | `errors.transaction.expenseRequiresSource` | 支出需要一个来源账户。 |
| 11 | 支出必须给出目标账户或分类 | `errors.transaction.expenseRequiresDestinationOrCategory` | 支出交易需要指定目标账户或分类 |
| 12 | 收入必须给出目标账户 | `errors.transaction.incomeRequiresDestination` | 收入需要一个目标账户。 |
| 13 | 收入必须给出源账户或分类 | `errors.transaction.incomeRequiresAccount` | 收入交易需要指定来源账户或分类 |
| 14 | 转账两端都必填 | `errors.transaction.transferRequiresBothAccounts` | 转账需要来源和目标账户。 |
| 15 | 转账不能转给自己 | `errors.transaction.transferToSelf` | 不能转账到同一账户。 |
| 16 | 转账端点必须是启用中的资产/负债账户 | `errors.account.transferAccountInvalid` | 转账账户不存在、已停用，或是不允许转账的账户类型 |
| 17 | 转账不得携带分类 | `errors.transaction.transferHasNoCategory` | 转账不使用分类。 |
| 18 | 分类必须存在 | `errors.categoryNotFound` | 分类不存在 |
| 19 | 分类类型与交易类型一致 | `errors.ledger.categoryTypeMismatch` | 分类类型与交易类型不匹配 |
| 20 | 分类必须已绑定镜像账户 | `errors.categoryNotBound` | 该分类尚未绑定账户，请重新打开数据库以完成升级 |
| 21 | 更新时必须至少改一个字段 | `errors.transaction.noChanges` | 没有需要更新的字段 |
| 22 | 已核对的分录不可修改 | `errors.reconcile.transactionLocked` | 该交易已核对，请先撤销对账再修改 |
| 23 | 目标交易必须存在 | `errors.transaction.notFound` | 交易不存在 |
| 24 | 日期格式必须为 `YYYY-MM-DD` | `errors.ledger.invalidDate` | 日期格式无效，应为 YYYY-MM-DD |

规则 24 只在能力层（`ledger::read::validate_date`）校验格式；db 层不校验日期，**也不拒绝未来日期**——未来日期由前端日期选择器（`maxDate` 默认为今天）拦截。规则 1/2/3/4/5/6 在 `create_transaction` 与 `update_transaction` 的 postings 分支中执行，快速记账最终复用前者，因此同样生效。

## 6. 事务边界与并发

| 入口 | 事务持有者 | 说明 |
| --- | --- | --- |
| `transaction_create`（command） | command | `conn.transaction()` 包住 `create_transaction`，提交后再读回详情 |
| `quick_add_transaction`（db） | db 层 | `conn.unchecked_transaction()`；command 层不得再开事务，否则会嵌套 |
| `quick_replace_transaction` | db 层 | `conn.transaction()`（checked），已在外层事务中的调用者会得到明确错误，而不是静默加入并提前提交 |
| `update_transaction` / `delete_transaction` | db 层 | 先做不存在检查与 `assert_not_reconciled`，再开事务改数据 |
| `ledger::create_account` | 能力层 | 建账户与写期初余额分录（equity 账户，唯一允许的 equity 路径）同一事务 |

单事务内完成的事（快速记账）：写入语义输入的解析结果 → `resolve_or_create` 分类（可能新建分类 + 镜像账户）→ 推导分录 → `INSERT transactions` → `INSERT postings`（`sequence = 0..n`）→ commit。分类创建、账户创建、交易与分录因此要么全成，要么全不成。

并发要点：

- 余额**从不落库**，一律由 `postings` 聚合（`get_account_balances_batch`），因此不存在「余额字段与分录不一致」的竞态。
- SQLite 单写者 + 桌面单用户，真正需要防的是 UI 重复提交（双击保存）；由按钮状态与事务原子性兜底，不使用显式锁。
- 已核对交易在编辑前被冻结，避免改动破坏已匹配的对账单。

## 7. Tauri 命令

| 命令 | 入参 | 出参 |
| --- | --- | --- |
| `transaction_create` | `{ input: { date, description, postings: [{ accountId, amount: "35.00" }] } }` | `TransactionDto`（含 postings，金额已是分） |
| `quick_add_transaction` | `{ input: QuickAddInput }`：`mode`, `amount`, `sourceAccountId`, `destinationAccountId`, `categoryId`, `categoryName`, `description`, `date` | `TransactionDto` |
| `quick_replace_transaction` | `{ id, input: QuickAddInput }` | `TransactionDto`（删除原交易后按同一语义输入重建） |
| `transaction_update` | `{ id, input: { date?, description?, postings? } }` | `TransactionDetail` |
| `transaction_detail` | `{ id }` | `TransactionDetail`（含 `isBalanced`、借贷合计） |
| `transaction_get` | `{ id }` | `TransactionDto \| null` |
| `transaction_list` | `{ filter?: { accountId?, fromDate?, toDate? } }` | `TransactionDto[]` |
| `transaction_list_paginated` | `{ filter?: { fromDate?, toDate?, accountId?, categoryId?, descriptionQuery?, page?, pageSize?, sortBy?, sortOrder? } }` | `{ items, pagination, dateGroups }` |
| `transaction_delete_preview` | `{ id }` | `DeletePreview`（分录数、是否可以删） |
| `transaction_delete` | `{ id }` | `()` |

IPC 字段统一 camelCase（`#[serde(rename_all = "camelCase")]`）；`amount` 在 command 层是十进制字符串，进入 db 层前已转成整数分。`ledger::record_transaction` 不暴露为 Tauri 命令，供 MCP 工具 `record_transaction` 调用，返回 `LedgerOutcome`（交易 id + 带账户名的分录预览 + 猜测警告）。

## 8. 关键设计决策

| 决策 | 理由 |
| --- | --- |
| 不存交易类型 | 分录已完整表达语义；存类型会引入类型与分录不一致的第二真相，且无法表达拆单、多账户转账 |
| 分类用镜像账户 | 复式记账里分类必须落在某个损益账户上；显式 `categories.account_id` 绑定让重命名不再产生孤儿账户，也让报表直接按 `account_id` 聚合 |
| 金额存整数分、后端解析 | 浮点会有精度与溢出问题（`"1e309"` 在 Rust 里会饱和成 `i64::MAX` 并绕过平衡校验）；前端只传字符串，不参与任何金额运算 |
| 借贷平衡为硬约束 | 不平衡的分录会让所有余额与报表口径失真，没有「先存下再修」的价值 |
| 用户交易禁止 equity | equity 只属于系统生成的期初余额分录，放开会让用户凭空创造净资产 |
| 快速记账固定两条分录 | 单条语义输入天然映射为两分录；拆单需求走手工模式，避免在简化 UI 里堆复杂度 |
| 后端计算所有展示金额 | `display_amount` / `flow_amount` / `day_total` 一律后端算，前端只渲染，杜绝两端口径漂移 |
| 硬删除 | 桌面单用户场景下的删除都是有意识清理；软删除会积累脏数据并让每个查询都要带过滤条件 |
| 已核对即冻结 | 改动会让对账单失去意义；要改先撤销对账 |
| 名称解析失败即报错 | 账户/分类按名称匹配时，精确 → 唯一子串（带警告）→ 报错；不做「回退到默认账户」，否则错误会被静默记到别的账户上 |