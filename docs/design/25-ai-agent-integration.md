# 25. AI 记账增强与 Agent 接入

> 状态：**P0~P5 代码已落地**。已完成：内部 AI 乐观提交 + 回执撤销（§4.2）、
> MCP 标准化（两档信任 §5.4 / 只协商 2026-07-28 §5.5 / resources §5.6）、
> 幂等（§6）、Skill 文档（§10.7）。
> 待做：MCP Inspector 与 WorkBuddy 的手工实连验收；`warnings` 仍是后端硬编码中文（§11）。
> 目标：让 AI 能记支出、收入、**转账**、**新建账户**；并让外部 agent（WorkBuddy / Claude / Cursor…）
> 通过 MCP 驱动这个账本，同时软件自身的 AI 也能驱动自己。
> 前提：本账本是 local-first 的加密单用户账本，没有服务端。

---

## 1. 现状：AI 记账是一条硬编码的旁路

今天的链路（`services/ai.rs` → `commands/ai.rs`）是这样一条直线：

```
文本 → prompt（写死 6 个字段）→ /chat/completions → JSON → 硬编码校验
     → 账户名模糊匹配 → quick_add（只支持 expense / income）→ 落库
```

四处写死了边界：

| 位置 | 写死的东西 | 后果 |
| --- | --- | --- |
| `services/ai.rs::build_system_prompt` | 返回 `{mode, amount, categoryName, accountHint, date, description}` | 转账要两个账户，建账户要路径与类型，字段表装不下 |
| `services/ai.rs::validate_mode` | 只放行 `expense` / `income` | 转账被拦（注释写着 "transfer is phase 2"） |
| `commands/ai.rs::resolve_source_account` | 账户靠**名字**双向 `contains` 猜 | 猜错就静默回落默认账户 |
| `commands/ai.rs` | 直接调 `quick_add_with_category` 落库 | 没有确认、没有幂等 |

**已经具备、可以复用的底子**（这些不是问题）：

- UI 层已经完整支持转账：`QuickAddDialog` 的 `TransactionMode = "expense" | "income" | "transfer"`，
  转账的 UI 早就在了，缺的只是 AI 到不了那里。
- db 层已经有转账的**另一条**实现：`db/accounts/transfer.rs::create_transfer`，
  端点必须是 asset / liability，但它**不接受日期**（硬编码 `today_date()`）。
- `create_account_with_path` 已经支持 `Assets/xxx` / `Liabilities/xxx` 形式的层级路径。
- 期初余额有 `db/accounts/opening.rs::create_opening_balance`（走 equity 分录）。
- 安全面做得很到位：API Key 只在 Rust 侧加密库、请求不经 webview、金额全程整数分、
  落库是单事务、await 前释放 DB 锁。

---

## 2. 架构：一条能力层，两个驱动

核心判断：**不要把「AI 能做什么」和「agent 怎么驱动」混成一件事。**

正确做法是抽出一层**账本能力层**（Ledger Capability Layer）——写账本这件事的**唯一入口**——
然后让两个驱动共用它：

```
                 ┌──────────────────────────────────────────────┐
                 │        账本能力层（Rust，唯一入口）           │
                 │  list_accounts / list_categories            │
                 │  record_expense / record_income             │
                 │  record_transfer / create_account           │
                 │  query_transactions / get_balances          │
                 └───────────────┬──────────────────────────────┘
                                 │  （都直接复用现有 db 层函数）
        ┌────────────────────────┴────────────────────────┐
        │                                                  │
┌───────▼────────────────┐              ┌────────────────▼────────────────┐
│  驱动 A：软件自己驱动   │              │  驱动 B：外部 agent 驱动        │
│  内部 AI（应用内）      │              │  MCP Server（进程内，HTTP）      │
│  动作枚举 + 回执撤销    │              │  工具集 + 信任模型              │
└────────────────────────┘              └─────────────────────────────────┘
        封闭、可控、可测                        开放、灵活、可扩展
```

**两条路共用 db 层，不共用编排。** 这是本方案最重要的分界线：

- **驱动 A（内部 AI）不需要 MCP**。MCP 是给"编排不由我们控制"的外部 agent 用的协议。
  内部 AI 的动作集合是**封闭且已知**的四个（支出 / 收入 / 转账 / 建账户），
  用一个**判别式 JSON schema**（discriminated union）表达就够了，
  比 function-calling 循环更可控、更省 token、更好测。
- **驱动 B（MCP）不需要 prompt**。外部 agent 自己会规划，它需要的是
  **窄的、类型化的、语义明确的操作**，而不是我们替它想好的字段表。

---

## 3. 能力层：具体长什么样

新模块 `src-tauri/src/ledger/mod.rs`（或 `src-tauri/src/services/ledger.rs`）。

### 3.1 读

```rust
pub fn list_accounts(conn: &Connection) -> Result<Vec<AccountView>, AppError>;
pub fn list_categories(conn: &Connection) -> Result<Vec<CategoryView>, AppError>;
pub fn account_balances(conn: &Connection) -> Result<Vec<BalanceView>, AppError>;
pub fn query_transactions(conn: &Connection, q: &Query) -> Result<Vec<TxView>, AppError>;
pub fn period_summary(conn: &Connection, r: &DateRange) -> Result<SummaryView, AppError>;
```

`SummaryView` 直接复用 `db/reports` 已有的汇总逻辑，不要另写一套。

### 3.2 写

```rust
pub struct RecordRequest {
    pub kind: RecordKind,            // Expense | Income | Transfer
    pub amount_cents: i64,           // 整数分，绝不接受字符串或浮点
    pub date: String,                // YYYY-MM-DD
    pub description: String,
    pub source_account: AccountRef,      // 支出/转账的起点
    pub destination_account: AccountRef, // 收入/转账的终点
    pub category: Option<CategoryRef>,   // 仅支出/收入
}

pub enum AccountRef {
    Id(String),
    Name(String),   // 名称由能力层解析成 id；解析不到则报错，不静默兜底
}
```

**`AccountRef` 同时接受 id 和名字**，但名字解析失败时**必须报错**，不能像现在的
`resolve_source_account` 那样静默回落默认账户 —— 静默兜底是当前 AI 路径最大的可诊断性缺陷。

### 3.3 写操作的结果要能展示

```rust
pub struct LedgerOutcome {
    pub transaction_id: String,
    pub date: String,
    pub description: String,
    pub postings: Vec<PostingView>,   // 已经派生好的分录，用于预览
    pub warnings: Vec<String>,        // "分类「吃」是新建的" / "账户「微信」按名称匹配到「微信钱包」"
}
```

`warnings` 是关键：**所有"我替你猜了"的地方都必须说出来**。
分类被自动创建、账户靠模糊匹配、金额被截断——都要能被用户看见。

### 3.4 纪律

- 能力层**不写 SQL**，只调用现有 db 层函数（`quick_add_with_category`、
  `create_account_with_path`、`create_opening_balance`、reports）。
  复式平衡、单事务、分类镜像账户这些不变量自动继承。
- 能力层是**唯一**允许写账本的地方。以后新增功能不许再从 `commands/` 直接写库。
- 能力的写操作**不返回 `void`**，一律返回 `LedgerOutcome`。

---

## 4. 驱动 A：软件自己驱动（内部 AI）

### 4.1 把字段表换成动作判别式

现在的 prompt 要求模型返回固定的 6 个字段。改成：

```json
{
  "action": "expense" | "income" | "transfer" | "create_account",
  "amount": "18.00",
  "date": "2026-11-14",
  "description": "中午吃饭",
  "sourceAccount": "微信钱包",
  "destinationAccount": null,
  "category": "餐饮美食",
  "accountPath": null
}
```

`transfer` 用 `sourceAccount` / `destinationAccount` 两端；
`create_account` 用 `accountPath`（如 `Assets/支付宝`）+ `kind` + 可选 `openingBalance`。

### 4.2 确认回执：先落库，再给撤销

> 原方案是「预确认闸门」：模型提案 → 弹卡 → 用户确认 → 才写库。**已推翻**，原因见下。

早期设计要挡的是「AI 猜错账户/分类 + 本项目硬删除无撤销 = 永久脏数据」。但这个闸门有一个
绕不过去的矛盾：一旦要求「用户不点也算确认」，闸门就不能真的阻塞，于是必须引入
**持久化的待确认状态**（落盘、启动重放、崩溃恢复、双时钟、幂等判定）才能兑现承诺——
为一段二十秒的 UI 交互手搓一套持久工作流，成本与收益完全不成比例。

改为**乐观提交 + 撤销**（业界主流：可逆性优先于确认对话框，NN/g 的 user control and freedom）：

```
模型产出提案 → 校验 → 立即落库（一个事务） → 回执卡
                                          ├─ 不操作 / 直接关闭 → 结束（账已经记上了）
                                          ├─ 撤销             → 删除这一笔
                                          └─ 有问题 → 改参数 → 原地更新这一笔
```

**崩溃语义天然正确**，这是它最大的优势：

| 崩溃时机 | 结果 |
| --- | --- |
| 解析中 / 落库事务内 | SQLite 回滚，什么都没写，用户重说一遍即可 |
| 落库后、回执渲染前 | 账已经在，回执丢了不影响数据（交易列表里能看到） |
| 用户点撤销之前 | 账还在，用户下次自己删 |

**没有 pending 状态、没有倒计时、没有启动恢复、没有第二套时钟。**

各路径的处理：

| 路径 | 行为 |
| --- | --- |
| 提交 | 复用 `quick_add_transaction`（带 P0-3 的 `categoryName`）；AI 不再有专属写命令 |
| 撤销 | `transaction_delete`（`db/transactions/delete.rs:45` 已有实现，当前是 `#[allow(dead_code)]`） |
| 有问题 → 改参数 | `transaction_update` **原地更新**，不删了重建——避免「删成功、建失败」把账弄丢 |
| 有问题 → 自然语言纠错 | 重新解析得到新参数，同样走 `transaction_update` |
| 写入失败 | 停在输入态并直接显示后端错误，用户可重试（不存在半写状态） |
| 撤销失败 | 明确提示，用户仍可在交易列表里删除 |

**风险分级，不做「每次写都弹卡」的审批疲劳**：

| 动作 | 频率 | 可逆性 | 做法 |
| --- | --- | --- | --- |
| `record_transaction`（内部 AI） | 高 | 好（秒级、未对账，可直接删） | 乐观提交 + 撤销 |
| `create_account`（内部 AI） | 低 | 差（删账户会牵连分录） | **保留预确认卡**——前端自家卡片，与 MCP 无关 |
| MCP 外部 agent 写入 | — | 与内部 AI 相同 | 只有只读 / 信任两档，协议内不存在确认（§5.4） |

`warnings`（模糊匹配账户、新建分类）仍必须显示在回执卡上——它的角色从「让你先决定」
变成「告诉你我刚才替你猜了什么」，配合撤销依然够用。

前端落点：回执卡复用 `QuickAddDialog` 的字段布局，但提交目标是「按语义改一笔」，
所以 `variant: "create" | "review"` 里 review 那句「预填 + 新建」的语义要改（或直接退役，
改由 `AiInputDialog` 自己的回执/编辑两态承担）。

> **编辑接口的形态**：现有的 `transaction_update` 收的是 `{date, description, postings}`——
> 由前端直接拼分录就意味着前端在算金额，违反 AGENTS.md 的硬规则。所以「改参数」应当接受
> 与 `QuickAddInput` 同形的**语义字段**（mode / amount / 账户 / 分类名 / 日期 / 描述），
> 由后端重新推导并替换分录（必要时退化为同事务内的「删旧 + 建新」）。这条是实现时最容易
> 走偏的地方，先写死在这里。

### 4.3 建账户的默认策略

账户名是用户的语义体系，模型乱建会污染分类树。所以：

- 模型**可以提出**建账户的提案（`create_account` 动作）。
- 内部 AI 默认**不自动建**，走预确认卡——它是 §4.2 风险分级里唯一的例外
  （账户删不干净：删账户会牵连分录，所以不给「先建后撤」）。
  这张卡是**我们自己的前端**，与 MCP 的信任档无关；MCP 侧不设这道卡，
  外部 agent 要建账户就必须在信任档下调用（§5.4）。
- 提案前先与现有账户做名称匹配，能匹配上就复用，别新建。
- 设置里给一个"允许 AI 自动建账户"的开关，默认关。

---

## 5. 驱动 B：外部 agent 驱动（MCP）

### 5.1 架构选型：MCP Server 跑在 App 进程内

**不要**做成独立二进制。三条理由：

1. **密钥**。数据库是 SQLCipher 加密的，密钥只在解锁后的内存里。
   独立进程要么再问一次密码，要么把密钥缓存进 OS keychain —— 两者都是新的密钥暴露面。
2. **锁语义**。进程内跑 = 共享同一把 `Mutex<Connection>`、同一套校验、同一套 i18n 错误文案；
   锁屏时 `AppState.database` 是 `None`，工具自然返回"账本已锁定"。
3. **分发**。不需要第二个可执行文件，用户装的是原来那个 App。

**也不要**照抄 `tauri-plugin-mcp-bridge` 那套（截图 + DOM + IPC 执行）。
那套是给"数据不能给 agent 看的应用"设计的，它的文档自己就写了
*"Not a fit when: the app holds data you must not show an agent"*。
账本恰恰相反：我们要给的是**窄的类型化操作**，不是数据库快照，也不是界面。

### 5.2 技术选型

| 项 | 选择 | 理由 |
| --- | --- | --- |
| SDK | `rmcp` 3.10（官方 Rust SDK） | 协议实现自己写容易漏：版本协商、流式响应、JSON-RPC 错误码 |
| 传输 | **Streamable HTTP**，绑 `127.0.0.1` | rmcp 明确不提供旧的 2024-11-05 HTTP+SSE 传输；Streamable HTTP 是当前规范预期的唯一端点 |
| Web 框架 | `axum` | `StreamableHttpService` 是 Tower service，直接 mount |
| 会话 | **无状态，且只协商 2026-07-28**（`with_legacy_session_mode(false)` + `with_json_response(true)` + `with_stateless_protocol_metadata_required(true)`） | 2026-07-28 起协议删除了 session 与 `initialize` 握手（SEP-2567），每个请求自带协议版本与客户端能力；详见 §5.5 |
| 认证 | `Authorization: Bearer <token>` | token 存加密的 settings 表，跨重启稳定 |
| 端口 | 默认 `127.0.0.1:17823`，被占用则顺延 | 固定端口让用户的 `mcp.json` 不用每次改 |

`rmcp` 3.10 要求 Rust ≥ 1.88（项目当前 1.99.1 ✓）。
注意 3.x 有过多次破坏性变更（`Error` → `ErrorData`、`with_stateful_mode` → `with_legacy_session_mode`），
**必须把 SDK 关在一个模块里**，别让它的类型漏到 `commands/` 和 `db/`。

**框架不换**：`rmcp` 是 `modelcontextprotocol/rust-sdk` 的官方实现，也是 Rust 侧的事实标准
（千万级下载量）。唯一的竞争者 `rust-mcp-sdk` 优势在于更快跟进新规范草案；
我们要的不是跟进速度，而是长期兼容与类型安全，换框架只会换来迁移成本。

**接入方式**：在 `lib.rs` 的 `.setup(|app| { ... })` 钩子里起服务，
工具内部通过 `app.state::<AppState>()` 取库——`AppState` 本身**不需要改动**。

### 5.3 工具集（初版）

**读**（任何模式都可用）

| 工具 | 说明 |
| --- | --- |
| `ledger_status` | 是否解锁、当前账本路径、最近一次活动 |
| `list_accounts` | 账户 + 类型 + 余额 |
| `list_categories` | 分类 + 类型 |
| `query_transactions` | 按日期 / 账户 / 分类 / 关键字查 |
| `get_balances` | 账户余额 |
| `summary` | 区间收支汇总（复用 reports） |

**写**（受信任模型约束）

| 工具 | 参数 |
| --- | --- |
| `record_transaction` | `kind`(expense/income/transfer) · `amount_cents` · `date` · `description` · `source_account` · `destination_account` · `category` · `idempotency_key` |
| `create_account` | `path`(如 `Assets/支付宝`，根段决定类型) · `description` · `opening_balance_cents` · `opening_balance_date` · `idempotency_key`（**另受「允许 AI 自动建账户」开关约束**，默认关） |

**金额一律 `amount_cents`（整数分）**，不要让 agent 传字符串金额再解析——
`parse_amount_to_cents` 已经在能力层内部了，工具边界上直接收整数最省事也最不容易出错。

### 5.4 信任模型（两档）

| 档位 | 写操作行为 |
| --- | --- |
| **只读**（默认） | 写工具直接返回"未授权" |
| **信任** | 直接写，不弹确认、不留操作日志（取舍见 §11） |

**"确认"档已退役。** 原来它把确认做在 Tauri 事件里（`ledger://approval` → 自家 webview 弹卡），
是一套**协议外的带外通道**：外部 agent 那边看不到任何提示，调用方只会等满超时拿到一个错误。
要让第三方 agent 顺畅记账，只有两条路——迁到协议内的 elicitation，或者不设这道闸门。

选后者：写操作与内部 AI 统一为**先落库 + 撤销**（§4.2）。协议里没有的东西不再自造，
"可逆"比"不可绕过的闸门"更便宜，也更符合本地单用户账本的场景。

因此 P3 产出的这些**全部删除**：

| 删除项 | 原职责 |
| --- | --- |
| `src-tauri/src/mcp/approval.rs` | 单槽 `ApprovalSlot` + oneshot + 120s 超时 |
| `McpHost::try_stage_approval` / `emit_approval` | 暂存审批、广播事件 |
| 前端 `McpApprovalDialog` + `ledger://approval` 监听 | 弹确认卡、回传决策 |
| `mcp_approve_request` / `mcp_current_approval` 命令 | 前端解析审批 |

代价要写在明处：**信任档下 agent 写错了，只有事后发现的机会，没有事前的拦截**（§11）。

**存量配置的迁移**：

- 默认档从 `confirm` 改为 `readonly`。**两处都要改**——`impl Default for McpConfig`
  与 `load_config` 的 `unwrap_or(...)`，它们各自都会产出默认值，只改一处会留下不一致。
- 数据库里已经存着 `mcp.trust = "confirm"` 的用户：`TrustMode::parse` 不再识别该值，
  回落默认档 → **只读**。这是安全方向（宁可不写，不可乱写），用户在设置页重选一次即可恢复。
- **不写数据迁移脚本**。`settings` 是 KV 表，残留的 `"confirm"` 字符串无害（读取时被忽略）；
  为它加一次 schema 迁移不划算。这也是 §5.4 敢说"删干净"的前提。
- 前端 `McpTrustMode` 类型同步收窄为 `"readonly" | "trust"`，设置页不再渲染确认项；
  否则类型允许、后端不认，会变成静默降级。

### 5.5 协议版本与会话：双版本（2024-11-05 ~ 2026-07-28）

2026-07-28 版协议删除了 session 与 `initialize` 握手（SEP-2567），核心改为无状态：
每个请求自己携带协议版本与客户端能力。rmcp 的实现注释写得很直接——
"requests negotiating that version are always served statelessly regardless of this setting"。
也就是说**会话模式只作用于老版本，2026-07-28 的请求无论如何都走无状态**。

**决定：声明全部五个版本**（`2024-11-05` / `2025-03-26` / `2025-06-18` / `2025-11-25` / `2026-07-28`），
并开 `legacy_session_mode`：

| 客户端协商到的版本 | 走的路径 | 需要带什么 |
| --- | --- | --- |
| `2026-07-28` | 无状态（SEP-2567） | `MCP-Protocol-Version` 头 + `_meta` 里的 `protocolVersion`、`clientCapabilities` |
| ≤ `2025-11-25` | 传统会话：`initialize` → 拿到 `Mcp-Session-Id` → 后续请求回带 | 什么都不用额外带，与旧协议一致 |

`stateless_protocol_metadata_required` 保持开启：它只作用于无状态路由（即 2026-07-28 请求），
老客户端的会话路由有自己的一套规则，不受影响。

> **这条改过一次，理由值得留着**：最初只声明 `2026-07-28`，理由是"客户端可控、双版本成本翻倍"。
> 实测第一个真实客户端（WorkBuddy）就报 `-32022 Unsupported protocol version` —— 它仍在
> `initialize` 里协商 `2025-11-25`。**我们可控的是自己的代码，不可控的是别人的客户端**。
> 于是按原计划的回退路径改成双版本，代价是两条路径都要有测试：现已各有一条集成用例
> （`test_legacy_client_can_initialize_and_call` 与其余 2026-07-28 无状态用例）。

**仍然不支持的**：协商 `2026-07-28` 却省略每请求元数据的客户端（会被 `-32602` 拒），
以及根本不做 `initialize` 的老式实现。这两类都不是任何主流客户端的实际行为。

### 5.6 能力清单：tools + resources

**tools**（9 个，见 §5.3）：`ledger_status`、5 个读、2 个写。

**resources**（只读，本次补）：

| URI | 内容 | MIME |
| --- | --- | --- |
| `glimmerx://accounts` | 账户 id / 名称 / 类型 / 余额 | `application/json` |
| `glimmerx://categories` | 分类 id / 名称 / 类型 | `application/json` |
| `glimmerx://report/{YYYY-MM}` | 该月收支与净额（资源模板） | `application/json` |

为什么资源只做这几项：它们是**读**语义、无副作用、可缓存，且与工具不重复——
agent 拿资源做上下文，拿工具做动作。月度报表用模板而不是列一堆静态 URI，
是因为月份是连续空间，`list_resources` 只列当月、其余靠模板寻址。

**实现要点**：`#[tool_handler]` 宏生成的 `get_info()` 只声明 `tools`；
但宏**只在方法缺失时才生成**，所以不必放弃宏——手写 `get_info()`
（`ServerCapabilities::builder().enable_tools().enable_resources()`）与
`list_resources` / `list_resource_templates` / `read_resource` 即可。
资源读取必须走 `McpHost::with_db`，与工具同一条读路径；账本锁定时返回与工具一致的错误。

### 5.7 与标准 MCP 的偏差登记

把"哪些地方是刻意的偏离"写清楚，避免以后被当成遗漏：

| 项 | 我们的做法 | 性质 | 说明 |
| --- | --- | --- | --- |
| 会话 / 握手 | 双版本：2026-07-28 无状态 + 老版本传统会话 | **无偏差**（同时支持两套规范） | §5.5 |
| 鉴权 | 静态 Bearer token，无 OAuth 发现 | 偏离 | 本机 loopback；支持自定义 header 的客户端可直接用，只支持 OAuth 自动发现的不行 |
| 响应格式 | 无状态路由回 `application/json`；老版本会话可能回 SSE 帧 | 合规（二选一） | `json_response(true)` 只保证无状态路径；集成测试两种都要会解析 |
| 写入确认 | 协议外无确认，改用撤销 | 主动取舍 | §5.4 / §4.2 |
| resources | 只读、不支持 `resources/subscribe` | 合规（可选能力） | 账本是本地文件，订阅没有意义 |
| prompts / completions | 不提供 | 合规（可选能力） | §11 |
| 框架 | `rmcp` 3.10 官方 SDK | 无偏差 | 生态事实标准 |

---

## 6. 幂等

agent 会重试。同一笔账记两次是不可接受的。

**只做幂等，不做审计。** 不记录谁在什么时候调了什么工具，不保存请求原文，不提供调用历史查询，
也没有"信任档位留痕"这一层。账本里那笔交易本身就是唯一痕迹；再存一份调用日志，是用隐私和
维护成本换一个当前没人会去看的界面（记在 §11）。

新增一张只管幂等的表（v3 未发版，可以直接进 `schema_v3.sql`；若 v3 已冻结则走 `schema_v4`）：

```sql
CREATE TABLE automation_idempotency (
  tool             TEXT NOT NULL,     -- 'record_transaction' | 'create_account'
  idempotency_key  TEXT NOT NULL,
  status           TEXT NOT NULL,     -- 'in_flight' | 'done'
  result_json      TEXT,              -- 首次成功的原始结果，重复调用时原样返回
  created_at       TEXT NOT NULL,
  PRIMARY KEY (tool, idempotency_key)
);
```

- 键的作用域是**工具 + 键**：不同工具撞同一个键不算冲突，所以主键是复合的，不做字符串拼接。
- 不存 `request_json`（那是审计），也不单独存 `transaction_id`——`result_json` 里已经有它。
- 没有 `idempotency_key` 的调用不落任何行，行为与今天一致：**幂等是调用方主动要的保护，不是强制**。

语义三个分支：

1. **首次调用**：先写一行 `in_flight` → 真正落库 → 成功后把该行改成 `done` 并写入 `result_json`。
2. **重复调用 + `done`**：不碰账本，直接返回首次的 `result_json`。
3. **重复调用 + `in_flight`**：上一个请求还没结束，返回明确的"该请求正在处理中"，绝不并发写第二笔。

顺序：**先判信任档（只读直接拒绝），再查幂等表**。反过来会让"这个键以前写过"变成绕过门控的理由。

残行处理：`in_flight` 超过 10 分钟视为上次进程崩溃遗留，重试时允许直接接管（写账本前先 DELETE 该行）。
接管时不要用长事务把账本锁住——写入本身的耗时才是合理的持锁窗口。

---

## 7. Skill 的角色：用法说明书，不是能力

**能力靠 MCP 工具集，Skill 靠说明书。** 两者不能互相替代。

`skills/glimmerx-ledger/SKILL.md` 该写什么：

- **记账约定**：什么算转账（资产/负债之间搬钱，不产生损益）、金额单位是整数分、
  日期 `YYYY-MM-DD`、账户路径 `Assets/招商银行`（首段决定类型）。
- **何时用哪个工具**：`record_transaction` 记一笔、`create_account` 建账户、
  `query_transactions` 查历史、`summary` 看区间。
- **红线**：
  - 不确定账户对应哪个 id 时，先 `list_accounts`，**不要猜 id**；
  - 除非用户明确要求，不要调 `create_account`（账户名是用户的语义体系）；
  - 一次只记一笔，多笔要用户逐笔确认。
- **错误处理**：工具返回"未找到账户"时，重新 `list_accounts` 再试；
  不要自己编 id 重试。

Skill 安装位置：`~/.workbuddy/skills/glimmerx-ledger/`（用户级）或仓库 `skills/` 供分发。

---

## 8. 配置怎么设

### 8.1 App 侧（新增「自动化」设置区块）

- **本地 MCP 服务**：开关（默认关）+ 端口（默认 17823）+ 实际端口显示
- **访问令牌**：自动生成、只显示一次、可复制、可重置
- **信任模式**：只读（默认）/ 信任（两档；确认档已按 §5.4 退役，存量配置的迁移见同节）
- **允许 AI 自动建账户**：开关（默认关）
- **复制 MCP 配置**按钮：一键复制下面这段

### 8.2 客户端侧（WorkBuddy）

写到 `~/.workbuddy/mcp.json`（注意是 `mcp.json`，不是 `.mcp.json`）：

```json
{
  "mcpServers": {
    "glimmerx": {
      "type": "http",
      "url": "http://127.0.0.1:17823/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

写完之后要在 **连接器管理页点「信任」** 才会启用（不会自动激活）。

其他客户端（Claude Code / Cursor）的配置格式相同，只是入口不同。

### 8.3 Skill 侧

把 `skills/glimmerx-ledger/` 放到 `~/.workbuddy/skills/` 下，或从仓库分发。

---

## 9. 必须先修的地基

在放开转账之前，有一个**真实的不一致**要补：

`db/transactions/quick_add.rs::derive_postings` 的 transfer 分支**不校验端点账户类型**：

```rust
"transfer" => {
    let debit_account  = input.destination_account_id.unwrap();
    let credit_account = input.source_account_id.unwrap();
    if debit_account == credit_account { return Err(...transferToSelf); }
    Ok(vec![...])            // ← 没有 validate_endpoint
}
```

而 `db/accounts/transfer.rs::create_transfer` **有** `validate_endpoint`
（端点必须是 asset 或 liability，否则报错 —— 因为"从一个支出账户转出"会凭空造钱）。

也就是说：**两条转账路径的校验强度不一样**。今天 AI 走不到 quick_add 的 transfer 分支，
所以一直没暴露；一旦按上面放开 AI 转账，这条路就通了。

**修法**：把 `validate_endpoint` 提到公共位置，两条路径共用；
并统一走 quick_add 那条（它支持日期，`create_transfer` 硬编码了 `today_date()`）。

另外，能力层的 `AccountRef::Name` 解析失败必须**报错**，
不能沿用 `resolve_source_account` 的静默兜底。

---

## 10. 实施计划

### 10.1 依赖关系

```
P0 地基 ──→ P1 能力层 ──┬──→ P2 内部 AI ──┐
                        │                ├──→ P4 幂等 ──→ P5 Skill
                        └──→ P3 MCP ──────┘
```

P1 是所有后续工作的地基；P2 与 P3 可并行（两者共用 P1 的能力层，
以及 P2 产出的"回执卡 / 编辑态"组件）。

### 10.2 P0 地基（约 1~2 天，不改变任何现有产品行为）

| # | 任务 | 落点 | 验收 |
| --- | --- | --- | --- |
| P0-1 | 把 `validate_endpoint` 从 `db/accounts/transfer.rs` 提到公共位置 | 新建 `db/accounts/validate.rs` | 两条转账路径共用同一份端点校验 |
| P0-2 | `derive_postings` 的 transfer 分支调用它 | `db/transactions/quick_add.rs` | 用 expense 账户做转账端点 → 报错 |
| P0-3 | `QuickAddInput` 增加 `category_name`，db 层按 mode 推导类型后 `resolve_or_create` | `db/transactions/types.rs`、`db/transactions/quick_add.rs` | 按**分类名**写入 → 分类与镜像账户一并建出，且在**同一事务**内 |
| P0-4 | 统一日期语义：转账统一走 quick_add 路径 | `db/accounts/transfer.rs` 保留但不再作为 AI/能力层的入口 | 两条路径的日期处理一致 |

**新增回归测试（3 条）**：expense 账户做转账端点被拒；转账两端相同被拒；
按分类名写入后分类被创建且 `accounts` 表多出一条镜像账户。

### 10.3 P1 账本能力层（约 3~4 天）

新目录 `src-tauri/src/ledger/`：

| 文件 | 内容 |
| --- | --- |
| `types.rs` | `RecordKind` / `AccountRef` / `RecordRequest` / `LedgerOutcome` / `AccountView` / `CategoryView` |
| `read.rs` | `list_accounts` / `list_categories` / `account_balances` / `query_transactions` / `period_summary` |
| `write.rs` | `record_transaction` / `create_account` |
| `resolve.rs` | 名称 → id 解析。**解析不到就报错**，并把"按名称模糊匹配到哪个账户"记进 `warnings` |
| `mod.rs` | 门面 re-export |

纪律（三条，评审要盯）：

1. 能力层**不写 SQL**，只调现有 db 层函数（`quick_add_with_category` /
   `create_account_with_path` / `create_opening_balance` / reports）。
2. 能力层是**唯一**允许写账本的地方；`commands/` 不许再直接写库。
3. 写操作**一律返回 `LedgerOutcome`**（含派生好的分录与 warnings），不许返回 `void`。

`AccountRef::Name` 的解析规则（替代现在的静默兜底）：

1. 精确名匹配（忽略大小写）→ 命中。
2. 唯一包含匹配 → 命中，但记 warning「账户「钱」按名称匹配到「微信钱包」」。
3. 多个包含匹配 → **报错**，让调用方给 id。
4. 无匹配 → **报错**。绝不静默回落默认账户。

### 10.4 P2 内部 AI（约 4~5 天）

**后端**

| # | 任务 | 落点 |
| --- | --- | --- |
| P2-1 | prompt 从固定 6 字段改成**动作判别式**：`action ∈ {expense, income, transfer, create_account}` | `services/ai.rs::build_system_prompt` |
| P2-2 | `AiParseResult` 换成 `AiProposal`，新增 `action` / `account_path` / `account_kind` / `opening_balance` | `services/ai.rs` |
| P2-3 | `ai_parse_transaction` 返回 `AiProposalDto`（含解析后的 id、名称、warnings）；落库时机由前端按 §4.2 决定——**普通记账立即提交** | `commands/ai.rs` |
| P2-4 | 建账户提案：解析路径 → 校验根类型（asset/liability）→ 与现有账户查重 | `commands/ai.rs` |

**关键设计**（§4.2 乐观提交）：**AI 不需要任何专属写命令**，三条路径全部复用既有命令——
落库 `quick_add_transaction`（带 P0-3 的 `categoryName`）、撤销 `transaction_delete`、
修改 `transaction_update`。后端因此几乎零新增，风险集中在 UI 时序而不是写路径。

**前端**

| # | 任务 | 落点 |
| --- | --- | --- |
| P2-5 | `QuickAddDialog` 的 `variant: "review"` 语义退役或改造：编辑已落库交易走「按语义改一笔」（§4.2 注），不再是「预填 + 新建」 | `components/transactions/QuickAddDialog.tsx` |
| P2-6 | 抽 `components/transactions/ProposalReview.tsx`：展示金额/账户/分类/日期 + warnings，回执卡与编辑态共用 | 新建 |
| P2-7 | `AiInputDialog` 三态：`input` → 解析成功**立即提交** → `receipt`（撤销 / 有问题）；`有问题` → `edit`（按语义改一笔，见 §4.2 注）。`create_account` 例外，仍走预确认 | `components/transactions/AiInputDialog.tsx` |
| P2-8 | i18n 文案（zh/en）+ `errors` 段新键 | `src/i18n/locales/*.json` |

**验收**：说「中午吃饭18元」→ 账**立即**出现在列表 → 回执卡显示金额/账户/分类 →
点「撤销」→ 交易消失；再说一遍 → 点「有问题」把金额改成 20 → 保存 → 列表里仍是**一笔**，金额为 20。
说「建一个支付宝账户」→ 仍然先出确认卡，不直接建。

### 10.5 P3 MCP 服务（约 5~7 天，风险最高的一期）

**依赖**（版本与 feature 名已核实）

```toml
rmcp  = { version = "3.10", features = ["server", "macros",
          "transport-streamable-http-server"] }
axum  = "0.8"
tokio = { version = "1", features = ["rt-multi-thread", "net", "macros", "sync"] }
```

- `rmcp` 最新 **3.10.0**，要求 Rust ≥ 1.88（项目 1.99.1 ✓）。
- `tokio` 从 `dev-dependencies` 移到 `dependencies`（lock 里已有 1.52.1，不会重复引入版本）。
- `axum` 是新依赖；`rmcp` 本身只依赖 `tower-service`，不绑 axum。

**模块**

| 文件 | 内容 |
| --- | --- |
| `src-tauri/src/mcp/mod.rs` | server 装配、路由、版本与会话配置（§5.5） |
| `src-tauri/src/mcp/tools.rs` | 8 个工具（6 读 2 写，`ledger_status` 计入读）+ resources 能力（§5.6） |
| `src-tauri/src/mcp/settings.rs` | 端口 / 令牌 / 信任档位（只读、信任） |

~~`src-tauri/src/mcp/approval.rs`~~：确认代理随"确认档"一起退役（§5.4），编译期即删除。

**接入点**：`lib.rs` 加 `.setup(|app| { ... })` 钩子。
`app.handle()` 拿到 `AppHandle`，工具内部用 `app.state::<AppState>()` 取库——
**`AppState` 一个字都不用改**（现有 18 处测试构造点零改动）。
⚠️ 不要为此把 `AppState.database` 改成 `Arc<Mutex<...>>`：那会波及 18 处构造点，收益却只有「少 clone 一次 AppHandle」。

**安全基线**：绑 `127.0.0.1`；`Authorization: Bearer <token>`（token 存加密的
`settings` 表，跨重启稳定）；只暴露白名单工具与只读资源；写操作默认**只读档**，
用户显式切到信任档才放行。

**本轮增补**（相对 P3 初版）：

| # | 任务 | 落点 |
| --- | --- | --- |
| P3-5 | 双版本：`supported_protocol_versions` 覆盖 2024-11-05~2026-07-28 + 开 `legacy_session_mode`（老客户端要会话）+ 保持 `stateless_protocol_metadata_required`（只约束无状态路径）（§5.5） | `mcp/tools.rs`、`mcp/mod.rs` |
| P3-6 | resources：手写 `get_info()`（`enable_resources`）+ `list_resources` / `list_resource_templates` / `read_resource`（§5.6） | `mcp/tools.rs` |
| P3-7 | 删除确认档全套：`approval.rs`、`ApprovalSlot`、`try_stage_approval` / `emit_approval`、`McpApprovalDialog`、`mcp_approve_request` / `mcp_current_approval`、`trustConfirm` 文案；**默认档 `confirm` → `readonly`**（`Default` 与 `load_config` 的 `unwrap_or` 两处同改），前端 `McpTrustMode` 收窄（§5.4 迁移说明） | 前后端多处 |

**验收**：MCP Inspector 直连（需手动带 token；Inspector 若是老版本，会走 `initialize` + 会话，也能连上）

```bash
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:17823/mcp \
  --header "Authorization: Bearer <token>" \
  --method tools/list

npx @modelcontextprotocol/inspector --cli http://127.0.0.1:17823/mcp \
  --header "Authorization: Bearer <token>" \
  --method resources/read --params '{"uri":"glimmerx://accounts"}'
```

老客户端（≤2025-11-25）走传统会话，**应该连得上**——连不上才是故障，先看客户端有没有回带 `Mcp-Session-Id`。

**手工验收前必读**：2026-07-28 的客户端除了 `MCP-Protocol-Version`，还必须发 SEP-2243 的
路由头——`Mcp-Method: <方法名>`，以及 `Mcp-Name: <工具名或资源 URI>`（`tools/call` 与
`resources/read` 都需要）。漏了会得到 `-32020 missing required Mcp-Method header`，
看起来像鉴权问题，其实是缺头。若手上的 Inspector 版本不支持新协议，就以
`src-tauri/src/mcp/tests.rs` 里的 `call()` 助手为参照发原始 JSON-RPC——它已经把三个头带齐了。

### 10.6 P4 幂等（约 1 天）

**范围只到幂等，不做审计**（见 §6 / §11）。

| # | 任务 | 落点 |
| --- | --- | --- |
| P4-1 | `automation_idempotency` 表进 `schema_v3.sql`（v3 未发版，直接改）；复合主键 `(tool, idempotency_key)` | `db/schema_v3.sql` |
| P4-2 | 幂等读写层：`begin(key, tool)` → `in_flight` / 冲突即返回既有状态；`complete(key, tool, result)` → `done` + `result_json`；`stale` 接管 | 新建 `db/idempotency.rs` |
| P4-3 | 两个写工具补 `idempotency_key` 参数（§5.3 签名本来就有，P3 留空了） | `mcp/tools.rs` |
| P4-4 | 顺序固定为「信任门控 → 幂等查表」：`done` → 返回首次结果；`in_flight` → 报"处理中"；`in_flight` 过期 → 接管 | `mcp/tools.rs` |

**测试**：同一个 `idempotency_key` 调两次 → 只写一笔，第二次返回首次的 `result_json`；
`in_flight` 未过期时报处理中；过期后可接管；不带 key 的两次调用各写一笔（不误伤）。
另外要有一条"不同工具用同一个 key 互不影响"的用例。

### 10.7 P5 Skill（约 1 天）

`skills/glimmerx-ledger/SKILL.md`：记账约定、工具选择、红线、错误处理。
安装到 `~/.workbuddy/skills/`。

**决策：只做私有目录，不对齐 `skills-fs`。** 理由与 §5.7 的偏差登记同源：`skills-fs` 是
`rmcp` 侧的扩展能力，需要客户端也认这套约定；而我们真正要交付的是"给 agent 一份怎么用的
操作手册"，交给用户复制进自己的 skills 目录即可，不需要协议参与。等真有客户端消费
`skills-fs` 再回头补，是不破坏现有结构的增项。

已写入仓库：`skills/glimmerx-ledger/SKILL.md`（记账约定、8 个工具与 3 只资源的选择指南、
幂等键用法、信任档与建账户开关、红线、错误处理对照表）。

### 10.8 风险与回退

| 风险 | 影响 | 缓解 | 回退 |
| --- | --- | --- | --- |
| `rmcp` 3.x 破坏性变更 | 编译不过 | 关在 `mcp/` 模块内，锁 `3.10`；不改 `commands/` 与 `db/` | 降到 2.x，或手写 JSON-RPC（工具面小，可控） |
| axum/tokio 与 Tauri 内置 runtime 冲突 | 运行时异常 | 用 `tauri::async_runtime::spawn`，不自建 runtime | 换 `tiny_http` 自己实现 Streamable HTTP 传输 |
| 本地端口暴露给同机进程 | 越权记账 | 127.0.0.1 + 随机 token + 工具白名单 + 默认只读 | 设置页一键关停 |
| agent 乱写账本 | 数据污染 | 默认只读；信任档下的写入可在 GlimmerX 撤销（§4.2）；`warnings` 把"我替你猜了"摊开 | 信任档默认关 |
| 新版本严格化导致真实客户端连不上 | 用户配好了却用不了 | 已实测踩到：WorkBuddy 报 `-32022`，改为双版本（§5.5） | 仍连不上时临时降到只读档并关停 MCP |
| 存量 `confirm` 用户升级后写操作被拒 | 以为坏了 | 设置页把"只读"标注为默认并解释原因（§5.4 迁移说明） | 用户手动切回信任档 |
| resources 暴露余额 | 财务数据被读 | 与工具同一 Bearer 鉴权；只读、无订阅 | 设置页一键关停 MCP |
| agent 重试 | 重复记账 | `automation_idempotency` 复合主键 `(tool, idempotency_key)`；顺序为**先门控、后幂等**（§6） | 调用方不传 key 时退化为无保护（已文档化） |
| 提案里的分类名污染分类树 | 分类树长歪 | 提案前先做名称查重；新建分类会在回执卡上以 warning 摊开（旧方案「建分类也要确认」已随 §4.2 废弃） | 「允许 AI 自动建分类」开关默认关 |
| 乐观提交把错账写进去（§4.2） | 脏数据进了账本 | 回执卡常驻「撤销 / 有问题」，`warnings` 必须显眼；撤销只是秒级、未对账交易的一次删除 | 关掉 AI 入口，退回手工记账 |

### 10.9 里程碑与验证矩阵

| 期 | 主要验证手段 | 通过标准 |
| --- | --- | --- |
| P0 | `cargo test` | 3 条新回归测试通过，且既有 414 条全绿 |
| P1 | 能力层单测（`crate::db::init_schema` 夹具） | 读 5 + 写 2 全部有测试；名称解析的 4 条分支都有测试 |
| P2 | `vitest` + 真 AI 调用手工验 | 记一笔立即入库且回执可撤销/可改；建账户仍走预确认；改完仍是**一笔** |
| P3 | MCP Inspector `tools/list` + `tools/call` + `resources/read` | 锁屏时报「账本已锁定」；只读档下写工具被拒；信任档下能写；2026-07-28 之前的客户端被拒 |
| P4 | Rust 测试 | 同一幂等键调两次只写一笔，第二次返回首次结果；`in_flight` 并发时只报处理中 |
| P5 | WorkBuddy 实连 | agent 能查账、能记一笔（经确认） |

每一期结束时跑 `make check`（tsc / eslint / prettier / cargo fmt / clippy）
与 `cargo test`，覆盖率门禁维持 94%。

---

## 11. 明确不做的事

- **不做多用户 / 服务端 / 账号体系**。local-first 加密单用户账本是产品前提，不是待办。
- **不做多币种**（见 01）。
- **不把 MCP 暴露到局域网**。只绑 `127.0.0.1` + Bearer token。
- **不让 agent 直接执行 SQL**。能力层是唯一入口。
- **不给 agent 原始数据库快照**。工具返回的是聚合过的视图，不是 `SELECT *`。
- **不在内部 AI 上引入 function-calling 循环**。动作封闭且已知，固定 schema 更可控。
- **不做 AI 调用审计日志**。只做幂等（§6）：不保存请求原文、不记录调用历史、不提供"agent 帮我记了哪几笔"
  的查询界面。代价要说清楚——**信任档位下 agent 的写入除了那笔交易本身没有额外痕迹**，
  这是主动接受的取舍，不是遗漏。真需要追溯时，交易表的时间戳与描述就是现有线索。
- **不做「待确认提案」的持久化**。不存在 pending 状态、倒计时、启动重放和崩溃恢复（§4.2）：
  内部 AI 走乐观提交，写完即可撤销，崩溃只会丢一张回执，不会丢账也不会重复记账。
  同理，MCP 的「确认档」也已退役（§5.4）——要"人拦在写之前"，用**只读档**或直接关停 MCP，
  而不是再造一套协议外的等待通道。

- **不做 MCP 的 `prompts` 与 `completions`**。工具 + 资源已经覆盖记账场景；
  这两项是给"人在客户端里手动挑模板 / 自动补全参数"用的，单用户本地账本没有收益，
  却要额外维护模板正文与补全数据源（§5.6 只补 resources 的理由）。

- **`warnings` 保持后端硬编码中文**（`ledger/write.rs`、`ledger/resolve.rs`）。它们是能力层
  产出的建议性文案，后端没有 i18n 上下文；改成 warning code + 前端翻译要动能力层返回结构、
  前端渲染和两边测试，收益只是英文用户看到英文提示。当前取舍是**保留中文并在此登记**，
  英文用户仍能看懂金额与账户名，warnings 只是补充说明。真要做，等能力层下次改返回结构时顺带。

- **不承诺"只支持最新协议"**。最初打算只声明 2026-07-28，被真实客户端打回（WorkBuddy 仍在
  `initialize` 里协商 2025-11-25，直接 `-32022`）。现在是双版本，两套路径各有一条集成用例兜住（§5.5）。
  这条写在这里是提醒：**协议版本的"先进性"不是目标，能连上才是。**

---

## 12. 关联

- `docs/design/21-double-entry-upgrade.md` —— 复式记账与迁移
- `docs/design/24-reports.md` —— 报表与区间口径（`summary` 工具复用其实现）
- `docs/reviews/CODE_REVIEW.md` 审查 #1 —— AI 记账链路的原始评审（两个 Critical 已修）
