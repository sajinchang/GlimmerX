---
name: glimmerx-ledger
description: 读写 GlimmerX 本地双式记账账本（经本机 MCP 服务）。用户要记账、查账、看收支汇总、查账户或分类时使用。
---

# GlimmerX 账本

本地、单用户、双式记账。你通过 `127.0.0.1` 上的 MCP 服务读写用户自己的账本。
**金额与汇总全部由后端计算**，你只负责传参、核对、转述结果。

**只有新增能力**：这套工具里没有改、删、撤销。写错了只能由用户在 GlimmerX 里撤销，
所以写前核对账户与分类，比事后补救便宜得多。

## 连接

- 地址：`http://127.0.0.1:17823/mcp`（端口以 GlimmerX 设置页「自动化（MCP）」为准）
- 鉴权：`Authorization: Bearer <token>`，静态令牌，无 OAuth
- 传输：Streamable HTTP，协议版本由客户端协商（支持 `2024-11-05` 至 `2026-07-28`）
- 连不上通常不是配置错：服务只在账本解锁且「本地 MCP 服务」已开启后才启动。
  让用户解锁并开启后再试。已启动后再锁账本的话端口仍在，但每个工具都会返回锁定错误。

## 约定

- **金额一律整数分**：`1850` = ¥18.50。不传小数、不传字符串、不做四舍五入。
  单笔上限 100,000,000.00 元。
- **日期 `YYYY-MM-DD`**；省略即今天（本机时区）。
- **账户分四类**：`asset` / `liability` 是真正的钱包（可转账、计入净资产）；
  `expense` / `income` 是分类的镜像账户，只承载损益，不能当钱包。`list_accounts`
  和 `get_balances` 会把四类一起返回，算净资产或总余额时只取前两类。
- **账户名在四类之间统一解析**：先不区分大小写精确匹配，再唯一子串匹配（结果带
  warning），多处命中直接报错。名称一律取自 `list_accounts.name`，别拿分类名当账户名。
- **分类只属于损益**，转账没有分类。分类名按「精确（区分大小写）→ 包含 → 新建」
  解析，**包含匹配可能落到别的分类上**，所以只用 `list_categories.name` 的精确名称。
- 余额同样是整数分，负债为负值。
- 一次调用只记一笔交易，一笔交易只承载一个分类。

## 先读后写

写之前必须确认名称，不要凭记忆编：

1. `ledger_status` — 是否解锁、当前信任模式
2. `list_accounts` — 你即将使用的账户名与类型
3. `list_categories` — 分类名

账本锁定时 `ledger_status` 本身返回错误（不是 `unlocked: false`）：
**停下来让用户在 GlimmerX 里解锁**，重试无意义。

## 工具

| 工具 | 用途 |
| --- | --- |
| `ledger_status` | 解锁状态、信任模式、数据库路径 |
| `list_accounts` | 全部账户：id、名称、类型、余额 |
| `list_categories` | 全部分类：id、名称、类型 |
| `query_transactions` | 按日期/账户/分类/关键字查交易（单页） |
| `get_balances` | 只要余额，比 `list_accounts` 便宜 |
| `summary` | 区间收支合计：收入、支出、净额 |
| `record_transaction` | 记一笔支出 / 收入 / 转账 |
| `create_account` | 建账户（**默认被拒**） |

返回是 JSON，但**字段名不统一**：视图类是 camelCase（`transactionId`、
`balanceCents`、`incomeCents`），`query_transactions` 的列表项是 snake_case
（`display_amount`、`flow_amount`、`postings_summary`）。按实际返回的字段名读，
不要按习惯拼。写工具结果里 `warnings` 非空表示后端替你猜过（近似匹配、新建分类），
必须转告用户。

`query_transactions` 参数：`from`、`to`（含端点）、`account_id`、`category_id`、
`keyword`（描述子串）、`limit`（1–100，默认 50）。只返回首页，没有翻页游标。
列表项的 `display_amount` 恒为正（借方总额），`flow_amount` 才是资金流向
（付款为负、收款为正、转账为 0）——复述金额时用 `flow_amount`。

资源比等价的工具调用更省，只需快照时优先用：

- `glimmerx://accounts`
- `glimmerx://categories`
- `glimmerx://report/{YYYY-MM}`（模板，替换成 `2026-11`）

## 记一笔

```json
{
  "kind": "expense",
  "amount_cents": 1850,
  "date": "2026-11-14",
  "description": "午饭",
  "source_account": "微信",
  "destination_account": null,
  "category": "餐饮",
  "idempotency_key": "lunch-2026-11-14"
}
```

| `kind` | 必填 | 说明 |
| --- | --- | --- |
| `expense` | `source_account` | 钱从 `source_account` 出，方向用 `category` 定 |
| `income` | `destination_account` | 钱进 `destination_account`，来源用 `category` 定 |
| `transfer` | 两个账户 | 两边都要资产/负债、不能同一账户；不带 `category` |

`source_account` / `destination_account` 必须是资产或负债账户，损益那一侧用 `category`
指定（分类不存在会新建）：

- `expense`：`source_account` 必填，`category` 或损益类 `destination_account` 给一个。
- `income`：`destination_account` 必填，来源侧要靠 `category`（或 `source_account`）。
- `transfer`：两个都要，且不能再给 `category`（「转账不使用分类」）。

**MCP 表达不了拆分**：一笔交易只能有一个分类和一个对手账户。遇到"一次购物多个分类"
这类真实事件，请让用户在应用里手工记，不要拆成两笔编出来。

### 幂等键：可能重试就必须传

账本是真实账目，重复记一笔要用户手工去查、去删。

- 一次逻辑写入配一个键；真正的新写入换新键。重试（超时、传输失败、重启）
  **沿用同一个键**，首次成功的结果原样返回，不会多写。
- 不传键就没有任何保护，两次调用就是两笔。
- 返回 "still being processed" 表示上一次调用还没结束：等一会儿用**同一个键**
  重试，不要为了"让它过"而丢掉键。
- 只有响应里带 `transactionId` 才算记账成功。

### 信任模式

| 模式 | `record_transaction` |
| --- | --- |
| `readonly`（默认） | 拒绝，让用户在设置里改成「信任」 |
| `trust` | 直接写入 |

服务端没有二次确认。信任模式下用户的兜底是应用里的撤销按钮，所以**不要批量连写**：
一笔一记，逐笔告诉用户记了什么，否则用户分不清该撤销哪条。

### `create_account` 是独立开关

默认关闭，关闭时调用被拒。**不要**用"记到某个猜的账户"绕过：要么请用户先建账户，
要么请用户打开「允许 AI 自动建账户」。

参数：`path`（必填）、`description`、`opening_balance_cents`、
`opening_balance_date`、`idempotency_key`。

- `path` 首段决定类型，合法首段为 `Assets` / `Liabilities` / `Expenses` /
  `Incomes` / `Equity`（单复数均可），其余段拼成账户名：`Assets/招商银行`。
- 给 `opening_balance_cents` 会额外生成一条对 Equity 的期初分录。
  用户没明确提到期初余额时不要传。
- 名字在同类型下重复会被拒（「账户名称已存在」）。

## 红线

- 不编造账户名或分类名：先 `list_*`，再从中取。
- 不把一个真实事件拆成多笔 `record_transaction`；拆分场景交回用户。
- 不确定是否写过，先 `query_transactions` 查，再用同一个键重试。
- 分类缺失不构成把转账记成支出的理由。
- 响应里没有 `transactionId` 就不要说记好了。

## 错误处理

错误以工具结果返回（带 `isError`），读文本按下面处理：

| 返回文本 | 含义 | 处置 |
| --- | --- | --- |
| `数据库未解锁` / `Database is locked` | 账本已锁 | 告知用户去 GlimmerX 解锁；不重试 |
| `read-only` / `Not authorized` | 只读档或建账户开关关闭 | 告知用户去设置调整；不重试 |
| `still being processed` | 同一个键正在处理 | 稍后同键重试 |
| `找不到该名称的账户`、`账户不存在` | 名称写错 | `list_*` 后用准确名称重试 |
| `匹配到多个账户` | 名称不唯一 | 用 `list_accounts` 里的完整名称重试 |
| `该账户已停用` | 账户被停用，不能记账 | 让用户启用或换账户 |
| `不允许转账的账户类型` | 转账端点不是资产/负债 | 换钱包账户；本意是收支就改用 expense/income |
| `账户名称已存在` | `create_account` 路径撞名 | 换路径，或让用户处理 |
| `分类名称不能为空` | `category` 传了空白 | 修参数后重试 |
| `金额必须为正数`、`金额格式无效` | 分值为负或超上限 | 修参数后重试 |
| 日期格式无效 | 不是 `YYYY-MM-DD` | 修参数后重试 |
