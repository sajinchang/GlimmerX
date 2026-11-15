# 11 · AI 记账增强与 Agent 接入

> 状态：**P0~P5 已全部落地**（能力层 `src-tauri/src/ledger/`、内部 AI 提案式、MCP 服务、幂等、Skill）。
> 剩余：MCP Inspector / WorkBuddy 的手工实连验收；`warnings` 仍是后端硬编码中文（§11）。
> 前提：local-first 加密单用户账本，没有服务端；目标是让 AI（内部与外部 agent）都能记账、转账、建账户。

---

## 1. 现状问题

AI 记账原本是 `services/ai.rs` → `commands/ai.rs` 的一条硬编码的单独旁路：prompt 写死 6 个字段（`mode/amount/categoryName/accountHint/date/description`），只放行 `expense`/`income`，账户靠名字双向 `contains` 猜、猜不到就静默回落默认账户，解析完直接 `quick_add_with_category` 落库。
四个后果：转账到不了、建账户无法表达、猜错无提示、写入无确认无幂等。固定字段表装不下「两个账户」「账户路径 + 类型」，这是必须抽能力层的原因。

---

## 2. 架构：一条能力层，两个驱动

「AI 能做什么」与「agent 怎么驱动」是两件事。账本能力层（Ledger Capability Layer）是**写账本的唯一入口**，两个驱动共用它：

```text
                 ┌──────────────────────────────────────────────┐
                 │      账本能力层（src-tauri/src/ledger/）      │
                 │  list_accounts / list_categories            │
                 │  account_balances / query_transactions      │
                 │  period_summary                             │
                 │  record_transaction / create_account        │
                 └───────────────┬──────────────────────────────┘
                                 │  （只调用现有 db:: 函数）
        ┌────────────────────────┴────────────────────────┐
┌───────▼────────────────┐              ┌────────────────▼────────────────┐
│ 驱动 A：内部 AI        │              │ 驱动 B：外部 agent              │
│ commands/ai.rs         │              │ MCP Server（进程内，HTTP）      │
│ 判别式提案 + 人工确认  │              │ 8 个工具 + 3 个资源 + 信任模型  │
└────────────────────────┘              └─────────────────────────────────┘
        封闭、可控、可测                        开放、灵活、可扩展
```

- **共用 db 层，不共用编排。** 两个驱动都经能力层，谁都不直接写 SQL。
- **驱动 A 不用 MCP**：动作集合封闭且已知（支出/收入/转账/建账户），判别式 JSON schema 比 function-calling 循环更可控、更省 token。
- **驱动 B 不用 prompt**：外部 agent 自己规划，它需要的是窄的、类型化的操作与只读资源。

---

## 3. 能力层接口（`src-tauri/src/ledger/`）

### 3.1 读（`read.rs`）

| 函数 | 语义 |
| --- | --- |
| `list_accounts(conn)` | 全部账户：id / 名称 / 类型 / 是否启用 |
| `list_categories(conn)` | 全部分类：id / 名称 / 类型 |
| `account_balances(conn)` | 账户余额快照（整数分，负债为负） |
| `query_transactions(conn, &LedgerQuery)` | 按日期段 / 账户 / 分类 / 关键字分页查 |
| `period_summary(conn, from, to)` | 区间收入、支出、净额（复用 `db/reports`） |

### 3.2 写（`write.rs`）

一律返回结构化结果，绝不返回 `void`：

| 函数 | 语义 |
| --- | --- |
| `record_transaction(conn, &RecordRequest) -> LedgerOutcome` | 记一笔支出 / 收入 / 转账，返回 `transaction_id` + 派生分录 + `warnings` |
| `create_account(conn, &CreateAccountRequest) -> AccountOutcome` | 按 `Assets/支付宝` 形式建账户，可选期初余额；账户与期初分录同一事务 |

`types.rs` 关键类型：`RecordKind{Expense,Income,Transfer}`、`AccountRef{Id,Name}`、`CategoryRef{Id,Name}`、`RecordRequest`、`CreateAccountRequest`、`LedgerOutcome`、`AccountOutcome`。

### 3.3 写的结果要能直接展示

`LedgerOutcome` 带 `transaction_id`、`date`、`description`、`postings[]`、`warnings[]`：
调用方（MCP 工具、内部 AI 确认卡）不必再查一次库就能回显"记成了什么"。
`warnings` 是建议性文案（后端硬编码中文），语义见 §4.2。

### 3.4 纪律（评审必盯）

1. 能力层**不写 SQL**，只调 `quick_add_transaction` / `create_account_with_path` / `create_opening_balance` / reports；复式平衡、单事务、分类镜像账户等不变量自动继承。
2. 能力层是**唯一**允许写账本的地方，`commands/` 不许直接写库。
3. 金额只收整数分（`amount_cents`），不接受字符串或浮点。
4. 名称解析规则见 §10（`resolve.rs`），不要在调用方自己拼 SQL 兜底。

---

## 4. 内部 AI：提案 → 确认 → 写入

### 4.1 字段表换成动作判别式

模型返回 `action ∈ {expense, income, transfer, create_account}` 的判别式提案：`amount`、`date`、`description`、`sourceAccount`、`destinationAccount`、`categoryName`、`accountPath`、`accountKind`、`openingBalance`。`transfer` 用两端账户；`create_account` 用 `accountPath`（首段决定类型）+ 可选期初余额。

### 4.2 提案只提案，写库在确认之后

`ai_parse_transaction` **只解析、只校验、只解析 id，绝不写库**：落库由前端确认卡触发，走既有的 `quick_add_transaction`（带 `categoryName`）与 `account_create`，后端没有 AI 专属写命令。校验顺序：`action` → `date` → `amount` → 账户解析 → 分类告警。

| 路径 | 做法 |
| --- | --- |
| 首次记账 | 提案 → 确认卡 → `quick_add_transaction`（分类按名解析或新建，同一事务） |
| 用户改参数 | 重新提交语义字段 → `replace_by_quick_add`：同一事务内删旧建新，不支持前端拼分录 |
| 转账 | 两端都必须由 AI 点名，**不允许默认账户兜底**；两端相同直接报错 |
| 支出 / 收入 | 未点名账户时才回落 `ai.default_source_account_id`，且必须记 warning |

**为什么不做「乐观提交」**：先落库再给撤销要求「用户不点也算确认」，于是必须引入持久化待确认状态（落盘、启动重放、崩溃恢复、双时钟、幂等判定）才能兑现承诺；为一段几秒的交互手搓一套持久工作流，成本与收益不成比例。更关键的是：**AI 猜错账户/分类 + 本项目硬删除 = 永久脏数据**，而事后撤销只能靠用户当场看见卡。结论：确认卡留在写之前，状态不存在磁盘上。

**`warnings` 的意义**：凡是「我替你猜了」的地方都必须说出来——账户按名称模糊匹配到谁、分类将被新建、走了默认账户、AI 说的类型与路径根不一致、已存在同名账户。确认卡是用户唯一的拦截机会，warning 不显眼等于没有。

### 4.3 建账户的默认策略

账户名是用户的语义体系，模型乱建会污染账户树。内部 AI **可以提出** `create_account` 提案，但必须走确认卡（账户一旦有分录就删不干净，不给「先建后撤」）；提案前先与现有账户做名称查重，能复用就不新建。

---

## 5. 驱动 B：外部 agent（MCP）

### 5.1 架构选型：MCP Server 跑在 App 进程内

不做独立二进制：密钥只在解锁后的内存里（独立进程等于多一个密钥暴露面）；进程内共享同一把 `Mutex<Option<Database>>` 与同一套校验、i18n 错误文案；分发零成本。也不照抄 `tauri-plugin-mcp-bridge`（截图 + DOM + IPC）——那套面向「数据不能给 agent 看」的应用，而账本要给的是窄的类型化操作。

服务与 App 之间的缝是 `McpHost` trait（`mcp/host.rs`）：`with_db` / `db_path` / `mcp_config` / 运行态若干方法；生产用 `AppHandle<Wry>`，测试用 mock，`AppState` 一个字都不用改。

### 5.2 技术选型

| 项 | 选择 |
| --- | --- |
| SDK | `rmcp` 3.10（官方 Rust SDK）；rmcp 类型只允许出现在 `mcp/` 内 |
| 传输 | Streamable HTTP，只绑 `127.0.0.1` |
| Web 框架 | `axum`（`/mcp` 一条路由 + 鉴权中间件） |
| 会话 | 双版本：`legacy_session_mode(true)` + `json_response(true)` + `stateless_protocol_metadata_required(true)`（§5.5） |
| 认证 | `Authorization: Bearer <token>`，token 存加密 `settings` 表，常量时间比较 |
| 端口 | 默认 `127.0.0.1:17823`，被占用则向上顺延（共试 10 个），实际端口回写设置页 |
| 生命周期 | 解锁后 / 每次配置变更后 `sync`；token 变更走 `restart`（中间件闭包捕获了旧 token） |

### 5.3 工具集（8 个）

读（任何档位可用）：`ledger_status`（是否解锁 + 库路径 + 信任档）、`list_accounts`、`list_categories`、`query_transactions`（`from`/`to`/`account_id`/`category_id`/`keyword`/`limit` 1..=100）、`get_balances`、`summary`（`from`/`to`）。

写（受信任档约束）：

| 工具 | 参数 |
| --- | --- |
| `record_transaction` | `kind`(expense/income/transfer) · `amount_cents` · `date` · `description` · `source_account` · `destination_account` · `category` · `idempotency_key` |
| `create_account` | `path`(如 `Assets/支付宝`，根段决定类型) · `description` · `opening_balance_cents` · `opening_balance_date` · `idempotency_key` |

金额一律整数分；账户/分类只传名称，由能力层按 §3 规则解析。工具级失败（未授权、账户未找到、账本锁定）作为 `is_error` 结果返回原文，而不是协议错误——客户端会把协议错误显示成不可读的乱码。

### 5.4 信任模型（两档）+ 建账户独立开关

| 档位 | 写操作行为 |
| --- | --- |
| **只读**（默认） | 写工具直接返回「未授权：信任模式为只读」 |
| **信任** | 直接写，不弹确认；写错了用户在 GlimmerX 里撤销 |

「确认」档已退役：它把确认做在 Tauri 事件里，是协议外的带外通道，外部 agent 看不到也答不了，只会等满超时。随它一起删除的还有 `mcp/approval.rs`、`McpHost::try_stage_approval`/`emit_approval`、前端 `McpApprovalDialog`、`mcp_approve_request`/`mcp_current_approval`。代价写在明处：信任档下写错了只有事后发现的机会。

存量迁移：默认档从 `confirm` 改为 `readonly`（`McpConfig::default` 与 `load_config` 两处同改）；库里残留的 `"confirm"` 不再被 `TrustMode::parse` 识别，回落到只读（安全方向），不写迁移脚本；前端 `McpTrustMode` 收窄为 `"readonly" | "trust"`。

**建账户是第二道独立门控**：`mcp.allow_create_account`（默认关）与信任档无关——信任一个 agent 记账不等于允许它发明账户。信任档 + 开关关闭 → `create_account` 被拒。

### 5.5 协议版本与会话：双版本

声明全部五个版本（`2024-11-05` / `2025-03-26` / `2025-06-18` / `2025-11-25` / `2026-07-28`），并开 `legacy_session_mode`：

| 协商到的版本 | 路径 | 需要带什么 |
| --- | --- | --- |
| `2026-07-28` | 无状态（SEP-2567） | `MCP-Protocol-Version` + `_meta` 的 `protocolVersion`/`clientCapabilities`，以及 `Mcp-Method`、`Mcp-Name` 路由头 |
| ≤ `2025-11-25` | 传统会话：`initialize` → `Mcp-Session-Id` → 后续回带 | 与旧协议一致 |

`stateless_protocol_metadata_required` 只约束无状态路径，不影响老客户端。**这条改过一次**：最初只声明 `2026-07-28`，第一个真实客户端（WorkBuddy）即在 `initialize` 里协商 `2025-11-25` 并拿到 `-32022`——我们可控的是自己的代码，不可控的是别人的客户端。两条路径各有一条集成用例（`mcp/tests.rs`）。缺 `Mcp-Method` 会得到 `-32020`，看起来像鉴权问题，其实是缺头。

### 5.6 能力清单：tools + resources

tools 见 §5.3；resources 只读、无副作用，与工具不重复（拿资源做上下文，拿工具做动作）：

| URI | 内容 | MIME |
| --- | --- | --- |
| `glimmerx://accounts` | 账户 id / 名称 / 类型 / 余额 | `application/json` |
| `glimmerx://categories` | 分类 id / 名称 / 类型 | `application/json` |
| `glimmerx://report/{month}` | 该月收支与净额（资源模板，`list_resources` 只列当月） | `application/json` |

实现要点：`#[tool_handler]` 只声明 tools，因此手写 `get_info()`（`enable_tools().enable_resources()`）与 `list_resources`/`list_resource_templates`/`read_resource`；资源读取走 `McpHost::with_db`，与工具同一条路径。

**账本锁定时**：配置存在加密表里，所以服务只能在解锁后启动（冷启动即锁定 → 服务根本不监听）；一旦启动，锁账本后端口仍在、Bearer 鉴权照旧，但**所有**工具（含 `ledger_status`）与资源读取都返回同一个「账本已锁定」错误。agent 此时应停下等解锁，重试无意义；解锁后无需重启服务即恢复。

### 5.7 与标准 MCP 的偏差登记

| 项 | 做法 | 性质 |
| --- | --- | --- |
| 会话 / 握手 | 双版本同时支持 | 无偏差 |
| 鉴权 | 静态 Bearer，无 OAuth 发现 | 偏离（本机 loopback；只支持 OAuth 自动发现的客户端连不上） |
| 写入确认 | 协议内无确认，改用「写后可撤销」 | 主动取舍（§5.4） |
| resources | 只读，不支持 `resources/subscribe` | 合规（可选能力） |
| `prompts` / `completions` | 不提供 | 合规（可选能力，§11） |

---

## 6. 幂等

**只做幂等，不做审计**（§11）。表 `automation_idempotency`（`db/idempotency.rs` + `schema_v3.sql`）：

| 列 | 含义 |
| --- | --- |
| `tool` + `idempotency_key` | **复合主键**：键的作用域是工具 + 键，不同工具撞同一个键不算冲突 |
| `status` | `in_flight` \| `done` |
| `result_json` | 首次成功的原始结果，重复调用原样返回（`transaction_id` 也在里面） |
| `created_at` | 用于过期接管与清理 |

| 分支 | 行为 |
| --- | --- |
| 首次（无行） | `INSERT OR IGNORE` 写入 `in_flight` → 落库 → 改成 `done` + `result_json` |
| 重复 + `done` | 不碰账本，返回首次结果（replay） |
| 重复 + `in_flight` | 返回「该请求正在处理中」，绝不并发写第二笔 |
| 写失败 | `abandon` 释放该键，否则重试会永远被答「处理中」 |
| 不带 key | 不落任何行，行为与从前一致——幂等是调用方主动要的保护，不是强制 |

顺序固定为**先门控、后幂等**：只读档直接拒绝，否则「这个键以前写过」会变成绕过门控的理由。`in_flight` 超过 10 分钟视为上次进程崩溃的遗留，重试可接管（接管靠 `UPDATE ... WHERE status='in_flight' AND 超时` 的原子守卫，不扛长事务）。`done` 行在解锁时清掉超过 30 天的（`prune_finished`），`in_flight` 永不清理。

---

## 7. Skill 的角色

Skill 是**用法说明书，不是能力**：能力在 MCP 工具里，`skills/glimmerx-ledger/SKILL.md` 只写约定（整数分、`YYYY-MM-DD`、账户四类含义）、先读后写（`ledger_status` → `list_accounts` → `list_categories`）、工具选择、幂等键用法、红线（不猜 id、非用户明确要求不建账户、一次只记一笔）与错误处理对照。安装方式见 §8.3。

---

## 8. 配置

### 8.1 App 侧（设置页「自动化（MCP）」）

| 字段 | 说明 |
| --- | --- |
| `mcp.enabled` | 本地 MCP 服务开关，默认关 |
| `mcp.port` | 默认 `17823`；同时显示实际绑定端口与最近一次启动失败原因 |
| `mcp.token` | 自动生成（64 hex），存加密表跨重启稳定，可复制、可重置（重置即重启服务） |
| `mcp.trust` | `readonly`（默认）/ `trust`（§5.4） |
| `mcp.allow_create_account` | 允许 agent 建账户，默认关（与信任档独立，§4.3） |

### 8.2 客户端侧（`~/.workbuddy/mcp.json`，注意不是 `.mcp.json`）

```json
{ "mcpServers": { "glimmerx": {
  "type": "http",
  "url": "http://127.0.0.1:17823/mcp",
  "headers": { "Authorization": "Bearer <token>" } } } }
```

写完还要在连接器管理页点「信任」才会启用。Claude Code / Cursor 格式相同，入口不同。

### 8.3 Skill 侧

把 `skills/glimmerx-ledger/` 复制到 `~/.workbuddy/skills/`，或从仓库分发。不对齐 `skills-fs` 扩展：那是 `rmcp` 侧约定，需要客户端配合，而我们要交付的只是一份操作手册。

---

## 9. 已修的地基（背景）

放开 AI 转账前有四处真实的不一致，现已全部处理。记在这里是因为它们解释了现有代码的
形状：

- **转账端点校验**：`validate_endpoint` 提取到 `db/accounts/validate.rs`，quick_add 与
  `create_transfer` 共用，两条转账路径不再有强弱之分。
- **业务日期**：`create_transfer` 曾硬编码 `today_date()`；现 AI/能力层统一走 quick-add
  路径（支持日期），`create_transfer` 只留给账户页。
- **按分类名写账**：`QuickAddInput.category_name` 让分类解析/新建与分录同在一个事务里。
- **名称解析**：曾静默回落默认账户；现 `ledger/resolve.rs` 四规则，解析不到即报错（§10）。

仍然成立的边界：`warnings` 是后端硬编码中文（§11）；MCP Inspector 与 WorkBuddy 的
手工实连验收尚未执行。

---

## 10. 名称解析（`resolve.rs`）

账户（`AccountRef::Name`，大小写不敏感，停用与 `equity` 账户不参与）：

1. 精确名命中 → 采用。
2. 否则双向子串**唯一**命中 → 采用并记 warning「按名称匹配到「X」」。
3. 多个命中 → **报错**，调用方改用精确名。
4. 无命中 → **报错**。

分类（`CategoryRef::Name`，走 `categories::resolve_or_create`）：

1. 精确名（去首尾空白，**区分大小写**）命中 → 采用。
2. 否则双向子串**首个**命中 → 采用，不校验唯一（可能落到相近分类上）。
3. 都没有 → 新建分类及其镜像账户，warning 提示是新建的。

两套规则刻意不同：账户名是用户的资产体系，猜错等于把钱记到别的钱包，所以歧义必须报错；
分类新建代价低、容错收益大，因此允许落近似与自动创建。

---

## 11. 明确不做的事

- **不做多用户 / 服务端 / 账号体系**。local-first 加密单用户账本是产品前提，不是待办。
- **不做多币种**（见 01）。
- **不把 MCP 暴露到局域网**：只绑 `127.0.0.1` + Bearer token。
- **不让 agent 直接执行 SQL，也不给原始数据库快照**：能力层是唯一入口，工具返回聚合视图。
- **不在内部 AI 上引入 function-calling 循环**：动作封闭且已知，固定 schema 更可控。
- **不做 AI 调用审计日志**：不存请求原文、不记调用历史、不提供「agent 帮我记了哪几笔」的界面。代价说清楚——信任档下 agent 的写入，除那笔交易本身没有额外痕迹；要追溯，交易表的时间戳与描述就是现有线索。
- **不做「待确认提案」的持久化**：不存在 pending 状态、倒计时、启动重放、崩溃恢复（§4.2）。要「人拦在写之前」，用只读档或直接关停 MCP，而不是再造一套协议外的等待通道。
- **不做 MCP 的 `prompts` 与 `completions`**：工具 + 资源已覆盖记账场景，单用户本地账本没有收益。
- **`warnings` 保持后端硬编码中文**（`ledger/write.rs`、`ledger/resolve.rs`）：它们是建议性文案，后端没有 i18n 上下文；改成 code + 前端翻译要动返回结构与两边测试。英文用户仍能看懂金额与账户名。
- **不承诺「只支持最新协议」**：协议版本的先进性不是目标，能连上才是（§5.5）。

---

## 12. 关联

- `docs/design/09-double-entry.md` —— 复式记账、分类镜像账户与硬删除
- `docs/design/10-reports.md` —— 报表与区间口径（`period_summary` / `summary` 复用其实现）
- `docs/design/07-transactions.md` —— `QuickAddInput`、分类解析与分录派生
- `docs/BACKLOG.md` —— 未决事项与"决策过的否定"
- `skills/glimmerx-ledger/SKILL.md` —— 给外部 agent 的操作手册（§7）