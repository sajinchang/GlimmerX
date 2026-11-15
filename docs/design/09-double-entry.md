# 09 · 复式记账：决策记录

> 返回 [DESIGN.md](../DESIGN.md)。本文只记**为什么这么定**与仍生效的长期约定：结构看
> [02](02-data-model.md)，交易链路看 [07](07-transactions.md)，列表/编辑/删除看
> [08](08-transaction-list.md)。`SCHEMA_VERSION = 3`，`schema_v1.sql` 冻结
> （`test_schema_v1_is_frozen`）。

## 0. 决策摘要

| # | 决策 | 结论 | 落点 |
| --- | --- | --- | --- |
| 1 | 不做多币种 | DB 列保留并固定 `'CNY'`，领域层/DTO 不暴露 `currency` | `schema_v2.sql`、`commands/accounts.rs` |
| 2 | 保留支出账户 | 分类 ↔ 损益账户 **1:1 绑定**，账本真相只在 posting | `db/categories.rs` |
| 3 | 对账 | 粒度下沉到分录（`postings.cleared` + `reconciliations`），首版带自动匹配 | `db/reconcile.rs` |
| 4 | 封禁导入导出 | 代码/命令/依赖/UI/i18n 全删，仅保留数据库备份 | `commands/db.rs` |
| 5 | 自动锁定 | 空闲计时 + 清空查询缓存，配置在 localStorage | `hooks/useAutoLock.ts`、`utils/session.ts` |
| 6 | 储蓄目标 | `savings_goals`，以专用资产账户为载体 | `db/savings.rs` |
| 7 | 只做硬删除 | 移除 `deleted_at` / `is_reconciled` 及全部残留过滤 | `db/transactions/*` |

## 1. 账户是账本，分类是账户的展示层

唯一地基：`postings` 是账本真相，`categories` 只是"某条分录算哪个类目"的展示层，通过与
损益账户 1:1 绑定（`categories.account_id`，部分唯一索引 `idx_categories_account`，NULL
不参与）落到同一套账户上。

- **改名不外溢**：账本只认 `account_id`，重命名不改变分录归属，历史报表口径不变。
- **禁止按名字匹配**：取分类对应账户一律读 `categories.account_id`，读不到报错，不回落
  猜名字；名称解析的四条规则见 [11](11-ai-mcp.md) §10。
- **拆分交易不新增字段**：分类既然 1:1 账户，拆分 = 一笔交易多条损益分录；分类由
  `postings.account_id → categories.account_id` 派生（v3 起 `transactions.category_id`
  已删除，归档在 `legacy_transaction_categories`）。

镜像账户的生命周期（建/改名/删的同一事务约束）见 [07](07-transactions.md) §4。

## 2. 对账：粒度必须下沉到分录

按整笔交易标记对账是错的（转账 A→B 可能只有一侧出账），对账单位是 **posting**。

关键不变量：

- 分录携带 `cleared` 与 `reconcile_id`；`reconciliations` 记录账户、对账单日期、
  期初/期末余额，`UNIQUE(account_id, statement_date)`。
- 差额 = 期末余额 −（期初已对账余额 + 本次勾选合计），**必须为 0** 才允许提交。
- 带 `reconcile_id` 的分录锁定：改/删交易一律拒绝并返回
  `errors.reconcile.transactionLocked`，唯一出口是 `reconcile_undo`。
- 总额一律由后端算（`totals` / `candidates` / `cleared_balance`），提交时用同一份整数
  再校验。
- 统一用**对账单符号**：`statement_sign` 给出 asset → `1`、liability → `-1`，
  其余类型报不可对账。
- 同一 posting 重复传入被拒；`date > statement_date` 的分录不得出现在对账单上。

落点：`db/reconcile.rs`、`commands/reconcile.rs`、`components/accounts/ReconcileDialog.tsx`。

## 3. 储蓄目标：用资产账户当载体

储蓄目标 = **专用资产账户 + 目标属性**，不做 YNAB 式独立分配表。复式下"存钱"本就是
资产间转账，不产生收支，因此零额外记账逻辑。

- 创建目标时在同一事务内建账户（`include_net_worth = 1`）+ 目标行，
  `savings_goals.account_id` 唯一。
- 进度 = 该账户余额；存入/取出复用 quick-add 的 transfer，不新增接口。
- 余额 ≥ 目标 → `achieved`（读取时判定并回写，无定时任务；**不回退**，取出后仍保持，
  由用户手动改回）。
- 删除两道闸：余额非 0 → `errors.savings.accountNotEmpty`；有分录历史 →
  `errors.savings.goalHasHistory`（提示改归档）。硬删账户会撞外键，必须显式拦截。

## 4. 自动锁定

空闲自动锁库；配置属**设备行为**而非账本数据，存 localStorage（解锁前即可用）。

| key | 默认 | 说明 |
| --- | --- | --- |
| `glimmerx:security:autoLockMinutes` | `5` | `0` = 关闭 |

- 活动事件（`pointerdown` / `keydown` / `wheel` / `touchstart`，节流 1s）重置
  `lastActivity`；每 10s tick，判定抽成纯函数 `evaluateIdle`，迟到 > 2× 间隔视为
  系统休眠。
- 锁定序列统一走 `utils/session.ts::lockSession()`：`dbLock()` →
  `queryClient.clear()` → 关闭快速记账弹窗 → `setLocked()`，**顺序不可反**
  （否则跳转后仍能读到缓存金额）。
- `UnlockPage` 不渲染任何余额、账户名或交易信息。

## 5. 全局快捷键（已下线）

2026-11-14 全部移除：全局注册会被其它应用抢走，注册失败是常态，而失败时用户只看到
"按了没反应"，且常驻系统级钩子不划算。**快速记账与 AI 记账功能本身保留**，现存的是
窗口内快捷键（见 [05](05-constraints.md) §快捷键）。

## 6. 单币种清理

DB 列保留（v1 冻结，重建表成本高于收益），所有入口收敛为固定 `'CNY'`。

关键不变量：`currency` 不出现在任何 DTO / 输入结构 / UI 中；`reports/*` 与
`dashboard.rs` 从未读过该列，因此清理不损失能力。

## 7. 导入导出下线

CSV / Beancount 导入导出及其命令、`csv` 依赖、`transaction_hashes` 表已全部移除
（多入口导入造成账本口径不可控）。**数据库备份 `db_backup` 保留**——它是安全兜底，
不是导入导出。

## 8. 硬删除

语义就是 `DELETE`，不保留软删痕迹：`transactions` 无 `deleted_at`、无 `is_reconciled`
（后者平移到 `postings.cleared`），全库不存在 `deleted_at IS NULL` 过滤。

删除的级联范围、预览流程与"期初余额可从交易侧删掉"这一已知边界见
[08](08-transaction-list.md) §6。可靠性交给数据库备份，且备份是唯一兜底（无导入导出
往返）。

## 9. schema 三版差异

| 版本 | 差异要点 | 文件 |
| --- | --- | --- |
| v1 | 基线，**冻结**：`accounts.currency`、`transactions.category_id`、`deleted_at`、`is_reconciled` 均在此版引入 | `db/schema_v1.sql` |
| v2 | ① `reconciliations` + `postings.cleared`/`reconcile_id`，整笔对账标记平移至分录；② 币种归一；③ `categories.account_id` + 部分唯一索引；④ `savings_goals`；⑤ `v_posting_category` 视图；⑥ drop `deleted_at`/`is_reconciled`/`transaction_hashes`；⑦ 三个新索引 | `db/schema_v2.sql` |
| v3 | ① 归档后 drop `transactions.category_id`；② `automation_idempotency`（见 [11](11-ai-mcp.md) §6） | `db/schema_v3.sql` |

顺序约束（改动时勿破坏）：`postings.cleared` 先 ADD 再回填、回填在 drop
`is_reconciled` 之前；`idx_transactions_date_deleted` 先 `DROP INDEX` 才能 drop 列；
视图不含 `transactions`，故不受 drop 列影响。

## 10. 仍生效的两条批次约束

批 A / B / C 已全部落地，交付顺序与 PR 拆分归档在 git 历史。只有两条仍约束后续改动：

- 隐藏损益账户（账户页只留 asset/liability）**必须与 `categories.account_id` 同批**，
  否则用户陷入"建得出来、看不到、改不了"的中间态。
- 删列之前先归档或平移数据，迁移顺序见 §9。

## 11. 风险

| 风险 | 缓解 |
| --- | --- |
| 对账锁定后无法改账 | 必须提供撤销入口，错误文案直接指路（现文案已带） |
| v2 / v3 迁移不可逆 | 迁移前自动落 `.db.bak-YYYYmmdd-HHMMSS`；hook 失败整事务回滚 |
| 自动锁误伤长表单录入 | 输入与滚动都计为活动；默认 5 分钟，可关 |
| 前后端金额口径漂移 | 金额一律整数分、只由后端算 |
| `legacy_transaction_categories` 只归档不恢复 | 无外键、无读取方，仅供事后核对口径变化，不能当回滚手段 |

## 12. 已确认决策

| # | 决策 | 结论（仍生效） |
| --- | --- | --- |
| 1 | 账户页信息架构 | 账户页只展示 asset/liability；income/expense 收进分类页统一管理。损益账户仍在 `accounts` 表与账本中，只是 UI 入口在分类页。转账目标同样限定 asset/liability——资产↔损益的流动本应记成收入/支出 |
| 2 | 硬删除 | 一步到位删列，不做"只清代码、留列"的折中 |
| 3 | 对账自动匹配 | 首版即带：① 金额精确相等；② 日期就近（优先对账日之前）；③ 一条分录最多匹配一次；④ 仅本账户未对账分录。匹配只是**预勾选**，可取消，差额非 0 仍阻止提交 |

## 13. 复审加固：长期约定

| 约定 | 理由 | 落点 |
| --- | --- | --- |
| 删列前先归档（v3 把 `category_id` 存入 `legacy_transaction_categories`，`INSERT OR IGNORE` 幂等） | `DROP COLUMN` 不可逆，用户选择的分类不能销毁 | `db/schema_v3.sql` |
| 对账内部统一用**对账单符号** | 信用卡账单印正数、负债账户记负数，两套符号会让差额恒差一个负号 | `db/reconcile.rs::statement_sign` |
| 期初余额靠"这笔交易带一条 equity 分录"识别，不靠描述字符串 | 用户改描述后期初会退化成普通交易，删账户清理随之失效 | `OPENING_BALANCE_PREDICATE` |
| 净资产账户谓词单点：`type IN ('asset','liability') AND is_active = 1 AND include_net_worth = 1` | 散在四处时漏一处净资产就对不上 | `reports::net_worth_accounts` |
| 预算窗口：周预算看含今天那一周、非当前月取该月最后一周；月预算看整月；结转每期先 `max(0)` 且上限 260 期；"已花"只取 `amount > 0` | 预测性窗口与退款毛额口径必须唯一 | `db/budgets.rs` |
| 金额：整数分存储、上限 `10_000_000_000`、前端解析唯一入口 `utils/money.ts` 且与 Rust 逐条对齐 | `parseFloat * 100` 会让 `2.675`、`0.005` 与后端不一致 | `utils/money.ts` |
| 不存 `transaction_type`、不存交易级分类；前端不缓存金额 | 借贷方向由分录符号决定，缓存会产生第二份真相 | `db/transactions/*` |
