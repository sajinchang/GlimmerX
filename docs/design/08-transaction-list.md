# 08 · 交易：列表、详情、编辑与删除

> 范围：交易列表与筛选、交易详情、编辑、删除。数据结构以 `src-tauri/src/db/transactions/`、`src-tauri/src/commands/transactions.rs`、`src/pages/TransactionsPage.tsx`、`src/pages/TransactionDetailPage.tsx` 为准。
> 三个背景事实贯穿全文：**(1)** 分类不再是交易级字段（schema v3 已 `DROP COLUMN transactions.category_id`），分类信息由分录指向的损益账户经 `categories.account_id` 反查得出；**(2)** 没有标签功能（无 `tags` / `transaction_tags` 表）；**(3)** 删除是硬删除（2026-11-13 决策），没有 `deleted_at` / `is_reconciled` 列。

## 一、命令与数据来源

| 命令 | 签名要点 | 用途 |
| --- | --- | --- |
| `transaction_list_paginated` | `filter: Option<EnhancedTransactionFilter>` → `TransactionListResponseDto` | 列表页唯一入口（筛选 + 排序 + 分页 + 日期分组） |
| `transaction_list` | `filter: Option<TransactionListFilter>`（`accountId` / `fromDate` / `toDate`）→ `Vec<TransactionDto>` | 不分页的时间线查询，供账户页等复用 |
| `transaction_get` | `id` → `Option<TransactionDto>` | 轻量读取（交易 + 分录，无分类名） |
| `transaction_detail` | `id` → `TransactionDetail` | 详情页入口 |
| `transaction_create` | `input: CreateTransactionInput`（分录金额为十进制字符串） | 新建 |
| `transaction_update` | `id`, `input: UpdateTransactionInput` | 编辑（提交编辑表单） |
| `transaction_delete_preview` | `id` → `DeletePreview` | 删除确认框数据 |
| `transaction_delete` | `id` → `()` | 硬删除 |
| `quick_add_transaction` / `quick_replace_transaction` | 语义化输入（expense/income/transfer） | 快速记账；`quick_replace_transaction` = 同一事务内「删除 + 重建」 |

`EnhancedTransactionFilter` 的 IPC 字段为 camelCase：`fromDate`、`toDate`、`minAmount`、`maxAmount`、`accountId`、`categoryId`、`descriptionQuery`、`page`、`pageSize`、`sortBy`、`sortOrder`。命令层把金额、结构转成 DB 层的 `i64` 分与 `PostingInput` 后调用 `list_transactions_paginated`。

## 二、列表页

### 2.1 筛选条件 → 查询参数 → 索引

| 条件 | IPC 字段 | SQL 片段（`paginate.rs`） | 走的索引 |
| --- | --- | --- | --- |
| 日期起 | `fromDate` | `t.date >= ?` | `idx_transactions_date` |
| 日期止 | `toDate` | `t.date <= ?` | 同上（字符串比较，`YYYY-MM-DD` 含首含尾） |
| 账户 | `accountId` | `p.account_id = ?` | `idx_postings_account` |
| 分类 | `categoryId` | `EXISTS (SELECT 1 FROM postings pc JOIN accounts ac ON ac.id = pc.account_id JOIN categories cc ON cc.account_id = ac.id WHERE pc.transaction_id = t.id AND cc.id = ?)` | `idx_postings_transaction` + 唯一索引 `idx_categories_account` |
| 金额下限 | `minAmount`（分） | `HAVING SUM(CASE WHEN p.amount > 0 THEN p.amount ELSE 0 END) >= ?` | 无（分组后过滤） |
| 金额上限 | `maxAmount`（分） | 同上 `<= ?` | 无 |
| 关键字 | `descriptionQuery` | `t.description LIKE ? ESCAPE '\'` | 无（前导通配符，全表扫） |

要点：

- **分类必然是多值条件**：一笔拆分交易可以在多条分录上触及不同分类，所以不能用列比较，只能 `EXISTS` 子查询；分类名列表同样是相关子查询 + `DISTINCT`（早期写成 join 聚合，每翻一页都要为全账本 6 万条分录物化一次；`DISTINCT` 缺失时同一分类两条分录会渲染成「餐饮、餐饮」）。
- **关键字只匹配描述**：`descriptionQuery` 只做 `t.description` 模糊匹配，不搜账户名/分类名。`%`、`_`、`\` 经 `escape_like_pattern` 转义（`\` → `\\`、`%` → `\%`、`_` → `\_`），并声明 `ESCAPE '\'`，否则用户输入的 `%` 会变成「匹配任意串」。
- **金额区间是 HAVING 而非 WHERE**：区间作用于借方合计（后端算出的 `display_amount`），必须等 `GROUP BY t.id` 之后才能判断，因此和 `WHERE` 条件分两段拼接。
- 前端未提供标签、交易类型筛选（系统不存储 `transaction_type`，也没有标签表）；账户下拉、分类下拉分别来自 `accountList` / `categoryList`。

### 2.2 排序

| `sortBy` | 实际 `ORDER BY` | 说明 |
| --- | --- | --- |
| `date`（默认） | `t.date DESC, t.created_at DESC` | 同日多笔按创建时间倒序，保证分页稳定；`sortOrder=asc` 只反转主序 |
| `amount` | `display_amount DESC` | 按借方合计（别名排序），同额顺序不保证 |
| `description` | `t.description DESC` | 字符串排序 |
| 其它/缺省 | 落到 `t.date` | 白名单映射，未知值不报错 |

`sortOrder` 仅识别 `asc`（大写化后 `ASC`），其余一律 `DESC`。

### 2.3 分页与虚拟滚动

| 层 | 做法 | 阈值 |
| --- | --- | --- |
| 后端页大小 | `page_size` 缺省 20，钳制到 `1..=100`；`page` 缺省 1 且 `max(1)` | `pageSize` 上限 100 |
| 后端「有没有下一页」 | 取 `LIMIT page_size + 1`，多出的那行只用于置 `has_next`，随后 `truncate` 掉 | 每页多取 1 行 |
| 后端总数 | **不执行 COUNT**：`total_count` / `total_pages` 为 `null` | 每次翻页零 COUNT 开销 |
| 前端取样 | `useInfiniteQuery`，`pageSize: 100`，`getNextPageParam` 依赖 `pagination.hasNext` | 每页 100 条 |
| 前端渲染 | 全量交给虚拟滚动（`@tanstack/react-virtual`），行高估算：日期头 44px、交易行 64px，`overscan: 10`，容器 `contain: strict` | 恒开，无「小数据量退回普通列表」分支 |
| 触底加载 | `IntersectionObserver` 观察列表底部哨兵，`threshold: 0.1`、`rootMargin: 200px`，`hasNextPage && !isFetchingNextPage` 时才挂观察器 | 提前 200px 预取 |

阈值取值的理由：页大小 100 让「一屏 20 行」的滚动体会在 5 屏后才触底，配合 200px 预取几乎看不到加载态；虚拟化是唯一渲染路径，避免在小数据量和大数据量之间维护两套列表代码。

### 2.4 按日期分组

- 分组在**后端**完成：`build_date_groups` 按 `item.date` 聚成 `TransactionDateGroup { date, date_display, items, day_total }`，`date_display` 形如 `2026年3月15日`；组间按 `date` 倒序。
- `day_total` = 该日所有 `display_amount` 之和，**由后端计算**，前端不做金额运算（AGENTS.md 约束）。
- 前端跨页时用 `mergeDateGroups` 合并多页结果：同 `date` 的组拼接 `items` 并把后端给的 `dayTotal` 相加（相加的是后端算好的数，不是前端重算）。
- 虚拟列表使用扁平化的 `VirtualListItem`：日期头 + 交易行交错，一种滚动容器同时承载分组标题与行。

### 2.5 交互与状态

| 行为 | 说明 |
| --- | --- |
| 搜索框输入 | 写入 `descriptionQuery` 并重置为重新分页；空串则清空该条件 |
| 筛选面板 | 日期范围、金额区间（失焦时把 `35.00` 解析成 `3500` 分并 `Math.round`，负数与非法输入置空）、账户、分类；「全部」映射为 `undefined`；有任一条件才展开 |
| 清除筛选 | 恢复 `{ pageSize: 100, sortBy: "date", sortOrder: "desc" }` 并清空搜索词 |
| 空态 | 加载中 → 加载文案；请求失败 → 通用错误；`flattenedItems` 为空 → 有关键字显示「无搜索结果」，否则「暂无交易」 |
| 卡片 | 描述、分类徽章（多个分类显示前两个 + 「还有 N 个」，分隔符本地化）、分录摘要（负数在前、正数在后，各按绝对值降序，中间箭头）、金额按 `flowAmount` 正负着色 |
| 行内操作 | 悬停显示「编辑 / 删除」快捷入口；点击行进入详情 |

## 三、查询实现要点

### 3.1 动态 SQL 与参数绑定

- SQL **只拼片段，不拼值**：`WHERE` 条件列表与 `HAVING` 条件列表分别以 `Vec<String>` 累积、`join(" AND ")`，每个片段只含 `?` 占位符；值为 `Vec<Box<dyn ToSql>>` 按拼接顺序压栈，最后一次性 `params_from_iter` 绑定。空条件时退化为 `WHERE 1=1`。
- 片段顺序必须与参数顺序严格一致——这也是金额下限先于上限、日期起先于日期止的原因。
- 值一律走参数绑定；唯一由变量决定、进入 SQL 文本的是 `sort_column`（白名单映射后的固定字面量）和 `page_size` / `offset`（作为绑定参数传入）。
- 结果是**单次 JOIN 查询**：`transactions JOIN postings JOIN accounts` + `GROUP BY t.id`，一次取回一行一笔交易；分录摘要用 `GROUP_CONCAT(a.name || ':' || 带符号金额, '|')` 在 SQL 侧拼成字符串，回程由 `parse_postings_summary` 解析成 `(name, amount)` 并排序。这避免了「先查 ID，再逐笔查分录」的 N+1（旧写法约 1+4N 次查询）。

### 3.2 COUNT 与列表查询的关系

- 当前实现**没有** `SELECT COUNT(*)`。列表 SQL 与「总数」完全解耦：分页元信息只给 `page`、`page_size`、`has_next`、`has_prev`，`total_count` / `total_pages` 明确为 `null`（类型即为 `Option<u32>`，注释写明「无限滚动场景下不提供，以免每次翻页做全量 COUNT」）。
- 因此前端不能显示「第 1/25 页」，只能显示「还有更多」。若将来需要精确总数，应作为**可选**的第二条查询：与列表共享同一份 `(where_clause, having_clause, params)`，并在有 `HAVING` 时必须写成 `SELECT COUNT(*) FROM (SELECT t.id ... GROUP BY t.id HAVING ...)`，否则会数错。

### 3.3 后端计算的金额字段：`display_amount` 与 `flow_amount`

| 字段 | 计算方式 | 语义 | 典型值 |
| --- | --- | --- | --- |
| `display_amount` | `SUM(CASE WHEN p.amount > 0 THEN p.amount ELSE 0 END)` | 借方合计，即「这笔交易多大」；恒 `>= 0` | 支出 3500、收入 500000、转账 10000 都是正数 |
| `flow_amount` | `SUM(CASE WHEN a.type IN ('asset','liability') THEN p.amount ELSE 0 END)` | 资产负债表侧净变动，即「钱往哪走」 | 支出为负、收入为正、自有账户间转账为 0 |
| `day_total` | 当日 `display_amount` 之和 | 日期分组小计 | — |
| `debit_total` / `credit_total` | 详情里分录的正数之和 / 负数之和 | 详情页合计与平衡校验 | 二者相加为 0 即平衡 |

`display_amount` 永远非负，无法区分「付出」与「收到」；早期 UI 用它着色，导致每一行都渲染成绿色，现改为按 `flow_amount` 的符号着色（正 = 收入色、负 = 支出色、0 = 中性）。**所有金额均在 SQL/后端计算，前端只格式化、不做加减。**

## 四、详情页

### 4.1 数据来源

- 唯一数据源：`transaction_detail(id)` → `get_transaction_detail`。前端 query key 为 `["transactionDetail", id]`，与编辑成功后的失效键一致。
- 读取顺序：`transactions` 主行（`date`、`description`、`created_at`、`updated_at`）→ 分录（`postings JOIN accounts LEFT JOIN categories ON categories.account_id = accounts.id`）→ 内存中按 `is_debit` 汇总 `debit_total` / `credit_total` / `is_balanced` / `posting_count`。
- 交易不存在：后端返回 `errors.transaction.notFound`，前端渲染「交易不存在」+ 返回按钮；请求失败渲染翻译后的错误文案。

### 4.2 分录展示

| 展示项 | 来源 | 说明 |
| --- | --- | --- |
| 主标题 | `posting.category_name ?? posting.account_name` | 损益侧分录就用分类名（分类与其镜像账户 1:1），资产/负债侧用账户名 |
| 副标题 | 有分类 → 「分类」；否则 → 账户类型名 | 明确这一行是「分类那一侧」还是「账户那一侧」 |
| 图标 | 按 `account_type` 取图标 | — |
| 借贷徽章 | `is_debit`（金额 > 0） | 显示「借」/「贷」 |
| 金额 | `amount_display` | 后端格式化的 `+¥35.00` / `-¥35.00`；正数收入色、负数支出色 |
| 排序 | `ORDER BY p.amount ASC` | 负数（贷方/资金来源）在前，正数在后；不使用 `sequence` |

分录之外还展示：平衡徽章（`is_balanced`）、分录条数（`posting_count`）、借方合计、贷方合计、创建/更新时间（`formatDateTimeShort`）、描述（空则占位）。**没有**标签、附件、备注区块——表结构里不存在这些列，详情页也不做展示。

## 五、编辑

### 5.1 提交结构

命令层 `UpdateTransactionInput`：`date?: string`、`description?: string`、`postings?: [{ accountId, amount: string }]`（金额是十进制字符串，命令层 `to_db_postings` 转成分）。DB 层 `UpdateTransactionInput` 的 `postings` 已是 `{ account_id, amount: i64 }`。

### 5.2 校验顺序（全部在写库之前）

| 步骤 | 规则 | 失败错误键 |
| --- | --- | --- |
| 1 | 交易存在 | `errors.transaction.notFound` |
| 2 | 未被对账锁定（任一分录 `cleared = 1` 或 `reconcile_id IS NOT NULL` 即拒） | `errors.reconcile.transactionLocked` |
| 3 | 至少改一个字段（`date` / `description` / `postings` 全空即拒） | `errors.transaction.noChanges` |
| 4 | 分录数 `>= 2` | `errors.transactionMinPostings` |
| 5 | 借贷平衡：`i128` 求和必须为 0（用 `i64` 求和在 release 下会静默溢出） | `errors.transactionUnbalanced` |
| 6 | 账户存在且 `is_active = 1` | `errors.accountNotFound` / `errors.account.inactive` |
| 7 | 不允许权益（equity）账户：期初余额只能由账户模块生成 | `errors.transaction.equityAccountRestricted` |
| 8 | 同一交易内账户不得重复 | `errors.transaction.duplicateAccount` |

前端 `TransactionForm` 做同构的即时校验（至少 2 条、账户非空、金额非零且不超两位小数、账户不重复、合计为 0），只是提前拦截；最终判定以后端为准。

### 5.3 分录如何「重新推导」

编辑不改单条分录，而是**整体重建**：

1. `DELETE FROM postings WHERE transaction_id = ?`；
2. 按提交顺序插入新分录，`sequence` 由 `enumerate()` 赋 `0..n-1`，`id` 新生成 UUID，`created_at` 统一为本次 `now`；
3. 因此分录 id 会全部变化，`sequence` 变成提交顺序（不再是历史顺序）。

安全性论证：第 2 步的对账锁定检查保证被删掉的每一行都是 `cleared = 0` 且 `reconcile_id IS NULL`，没有对账状态需要在重建时搬运。分类也不需要单独「推导」——它由所选账户决定：选了某损益账户，就等价于选了该账户绑定的分类（前端下拉把损益账户归到「分类」分组、资产/负债账户归到「账户」分组，落库永远只有账户 id）。

### 5.4 可改 / 不可改

| 字段 | 可否编辑 | 说明 |
| --- | --- | --- |
| `date` | 可 | 任意日期字符串，无未来日期限制 |
| `description` | 可 | 允许清空（空描述在列表/详情显示占位） |
| 分录（账户 + 金额） | 可 | 整体替换，见 5.3 |
| 分类 | 间接可改 | 通过改损益账户实现；交易表已无 `category_id` 列 |
| 账户名 / 账户类型 / 账户余额属性 | 不可 | 属于账户模块（`accounts`），编辑交易只能选择账户，不能重命名 |
| equity 账户 | 不可参与 | 由 `validate_no_equity_accounts` 拦截 |
| 已对账的交易 | 不可编辑 | 同上，需先在账户模块撤销对账 |
| 交易 id、`created_at` | 不可 | `id` 只读；`created_at` 不更新 |

### 5.5 事务边界

`update_transaction(conn: &mut Connection, ...)`：

- 校验全部读操作在**事务之外**完成；
- 随后 `conn.transaction()` 内执行「改 `date` / 改 `description` / 删旧分录 + 插新分录 / `UPDATE transactions SET updated_at`」，`commit()` 后**在事务之外**重新查 `get_transaction_detail` 返回详情。
- 任一写语句失败即整体回滚：不会出现「日期改了但分录没改」的中间态。
- 语义变体：`quick_replace_transaction`（AI 小票「有问题」路径）走 `delete_rows_checked` + 重新创建，两半在**同一个**调用方事务内，`delete_rows_checked` 特意接收 `&Connection` 而非 `&mut Connection` 以支持这种嵌套。

## 六、删除

### 6.1 语义（2026-11-13 决策：硬删除）

| 维度 | 结论 |
| --- | --- |
| 删除类型 | 物理删除，`DELETE FROM` 落盘。此前的 `transactions.deleted_at` 软删除列与 `is_reconciled` 列已在 schema v2 一并 `DROP COLUMN`（连带删除 `idx_transactions_date_deleted`） |
| 可恢复性 | 不可恢复。数据安全兜底只剩「数据库备份」，CSV / Beancount 导入导出的往返恢复能力已于同日下线 |
| 用户提示 | 确认框在 `can_delete = true` 时显示固定警告：「此操作不可撤销。该交易及其所有分录将被永久删除。」 |
| 审计痕迹 | 不保留（无归档表、无 tombstone） |

### 6.2 级联范围

| 对象 | 处理 |
| --- | --- |
| `postings` | 显式 `DELETE FROM postings WHERE transaction_id = ?`；`postings.transaction_id` 另有 `REFERENCES transactions(id) ON DELETE CASCADE` 作为兜底，显式删除是为了顺序可控 |
| `transactions` | 主行删除 |
| `accounts` / `categories` | **不受影响**。分录对 `accounts(id)` 的外键**没有** `ON DELETE CASCADE`，所以交易删除不会带走账户；分类镜像账户（`categories.account_id`）继续存在 |
| 期初余额交易 | 由账户模块维护（`create_opening_balance` / 删除账户时联动清理），交易删除路径**没有** equity 拦截——这是当前的已知边界，见 6.4 |
| 预算 / 报表 | 无需清理，均为按分录聚合的派生视图 |

### 6.3 系统账户与分类镜像账户的保护

| 保护点 | 位置 | 规则 |
| --- | --- | --- |
| 系统账户不可删 | 账户模块（`is_system = 1`，如 `Equity: Opening Balances`） | 删除被拒；系统账户只由迁移/期初余额逻辑创建 |
| 权益账户不可被交易引用 | `create_transaction` / `update_transaction` → `validate_no_equity_accounts` | 保证「有 equity 分录」可被唯一解释为系统生成的期初余额（`OPENING_BALANCE_PREDICATE` 就靠 `EXISTS (... ae.type = 'equity')` 判定，而不是靠描述文本） |
| 分类镜像账户 1:1 | `categories.account_id ... UNIQUE REFERENCES accounts(id) ON DELETE CASCADE` | 一个账户只能绑定一个分类；删分类连带删镜像账户，反向不成立 |
| 对账锁定 | `assert_not_reconciled` | 已被对账单认领的分录所在交易，编辑与删除都拒绝 |

### 6.4 删除流程与事务边界

1. 确认框打开时调 `transaction_delete_preview`：读 `description` / `date` / `COUNT(*) postings`，并**预先**跑一次 `assert_not_reconciled`——`can_delete = !locked`，锁定时把 `errors.reconcile.transactionLocked` 作为 `warning_message` 返回，按钮直接禁用（「先说不能删」优于「确认后再失败」）。
2. 用户确认后调 `transaction_delete` → `delete_transaction(conn: &mut Connection)`：`conn.transaction()` → `delete_rows_checked` → `commit()`。
3. `delete_rows_checked`：存在性检查 → `assert_not_reconciled` → 删分录 → 删交易。三步同在调用方事务内，任一步失败整体回滚。
4. 前端成功后 `removeQueries(["transactionDetail", id])` + 失效账本相关查询（列表、账户）并关闭对话框；失败在对话框内就地显示翻译后的错误，不静默吞掉。

## 七、关键设计决策与理由

| 决策 | 理由 |
| --- | --- |
| 分类挂在分录上，交易不存 `category_id` | 拆分交易天然有多分类；交易级单列无法表达，只能变成「缓存列 + 永远对不上」 |
| 列表用单条 JOIN + `GROUP BY t.id` | 消除 N+1；一页一次往返 |
| 分类名用相关子查询 + `DISTINCT`，不做 join 聚合 | join 聚合会把全账本的分录先物化再返回首行；子查询命中 `idx_postings_transaction`，且 `DISTINCT` 消除「餐饮、餐饮」 |
| `page_size + 1` 探测下一页，不 COUNT | 避免每次翻页的全量 COUNT；代价是无法显示总页数，产品接受 |
| 金额全部后端算 | `display_amount` / `flow_amount` / `day_total` / 借贷合计都在 SQL 或后端内存里算，前端只格式化，避免精度与口径分叉 |
| `flow_amount` 与 `display_amount` 并存 | 前者给符号与着色，后者给「这笔多大」；单用一个都会出错（见 3.3） |
| 虚拟滚动恒开 | 一套渲染路径，避免小/大数据量的分支维护；行高固定（44 / 64）使估算稳定 |
| 编辑整体重建分录 | 单条 diff 无法表达「增删行 + 重排」；重建 + 对账锁定前置检查使「无状态需保留」成立 |
| 编辑/删除共用一条对账锁 | 两者都会破坏对账单的内部一致性，规则必须相同 |
| 硬删除 | 单币种账本语义下软删除带来的是「处处要过滤 + 统计口径双份」；可靠性交给备份 |
| 删除先预览再确认 | 弹窗里给出描述、日期、分录条数（以及锁定原因），把不可逆操作的代价摆到眼前 |

## 八、边界条件

| 场景 | 行为 |
| --- | --- |
| 完全没有数据 | 列表空态文案「暂无交易」；有关键字时改为「无搜索结果」 |
| 搜索/筛选无命中 | 同上（走 `flattenedItems.length === 0` 分支），不清空已输入的筛选条件 |
| 最后一页 | `has_next = false` → 前端不再渲染触底哨兵，`IntersectionObserver` 解除 |
| 请求超出范围的 `page` | 后端 `page = max(1)`；越界页返回空 `items`、`has_next = false`，前端应保留旧数据而不能把它当「无数据」清屏 |
| `pageSize` 越界 | 钳制到 `1..=100`，不报错 |
| 跨月 / 跨年筛选 | 只有 `fromDate` / `toDate` 两条边界，字符串比较、首尾含；「按月」不是查询概念，由前端自行给月初/月末。起始晚于结束不校验，结果自然为空 |
| 日期格式非法 | 字符串比较静默失真（不抛错），调用方需保证 `YYYY-MM-DD` |
| 只填金额上限/下限之一 | `HAVING` 只拼一侧，等价于单边过滤 |
| 同一账户在一笔交易里出现两次 | 写入被 `errors.transaction.duplicateAccount` 拦住；若历史数据存在，`accountId` 过滤会在该笔上放大 `display_amount` / `flow_amount`（`GROUP BY t.id` 前该行出现两次） |
| 拆分交易（多分类） | `categoryNames` 返回多个，卡片显示前两个 + 「还有 N 个」；详情按分录逐行展示 |
| 描述为空 | 列表与详情统一用占位文案，不显示空白行 |
| 编辑提交空输入 | `errors.transaction.noChanges`（前端表单通常已禁用保存按钮） |
| 编辑时账户被停用 | `errors.account.inactive`，需先启用账户 |
| 编辑/删除已对账交易 | 均拒绝：`errors.reconcile.transactionLocked`；删除预览阶段就把 `can_delete` 置 false 并给出原因 |
| 交易已被删除后再打开详情 | 详情查询返回 `errors.transaction.notFound` → 「交易不存在」+ 返回按钮；删除成功后前端主动移除该详情缓存 |
| 期初余额交易被从交易侧删掉 | 当前无拦截，会导致该账户的期初余额与 `Equity: Opening Balances` 分录失去对应；正确入口是账户模块的期初余额编辑（0 值即删除该交易） |