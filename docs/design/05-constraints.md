# 05 · 工程约束、测试与构建

> 返回 [DESIGN.md](../DESIGN.md)。数据层不变量见 [02](02-data-model.md)，前端约定见
> [04](04-frontend.md)。

## 金额与日期

- 数据库金额一律**整数分**（`INTEGER` / `i64`），单笔上限 1 亿元。
- 所有加减乘除、汇总、格式化输入都在 Rust 后端；前端只做显示格式化
  （`src/utils/format.ts`）与输入解析（`src/utils/money.ts`，规则与 Rust 逐条对齐）。
- 业务日期是 `YYYY-MM-DD` 字符串，取**本地时区**（Rust `chrono::Local`，
  前端 `utils/date.ts` 的 `formatLocalDate` / `todayLocalDate`）。禁止
  `toISOString().split("T")[0]`——本地零点转 UTC 会掉一天。

## 复式不变量

- 同一交易的 `SUM(postings.amount) = 0`，后端口径用 `i128` 求和防溢出。
- 分录数 ≥ 2；同一交易内账户不可重复；用户交易不得引用 `equity` 账户。
- 余额不落库，一律由分录聚合。

## 数据库加密与会话

- SQLCipher（AES-256），密钥由用户密码派生，**不落盘**；密码错误表现为
  "数据库无法打开"，不做"密码错"与"文件损坏"的区分。
- 连接常驻于 `AppState { database: Mutex<Option<Database>>, recent_dbs }`，
  锁定 = 置 `None`（触发 WAL checkpoint、丢弃密钥）；解锁重新打开。
- 改密：旧密码解密 → 新密码重写（原地替换）。
- WAL 模式；桌面单用户、单写者，写冲突靠事务与 UI 防重提交，
  不加应用层锁。

## accounts 表设计

- 当前 12 列：`id, name, type, currency, description, account_number, is_system,
  iban, is_active, include_net_worth, created_at, updated_at`。
- **没有** `parent_id`：层级用路径式名称表达（`Assets/招商银行`），首段决定 `type`，
  其余段以 `/` 连接为 `name`；唯一索引 `(type, name)`。
- **没有** `subtype` 列：资产/负债细分走 `account_meta` 键值表（`account_role`、
  `liability_type`、信用卡字段等），由 `account_meta_schema` 下发字段定义。
- `currency` 是 v1 遗留列，固定 `'CNY'`，不读出、不展示、不可选。
- `equity` 账户由系统创建与管理，`account_create` 直接拒绝 `equity` 路径。

## 最近账本列表

`dirs::config_dir()/glimmerx/recent_dbs.json`（Linux `~/.config`，Windows
`%APPDATA%`，macOS `~/Library/Application Support`），最多 10 条，记录
path / label / last_opened；打开前校验文件存在，失效条目自动清理。

## 状态管理

| 类别 | 选型 | 说明 |
| --- | --- | --- |
| 服务端状态 | TanStack Query（默认 `staleTime: 0`，见 [04](04-frontend.md) §3） | 财务数据不缓存旧值 |
| 客户端状态 | Zustand（`stores/*`） | 语言、主题、UI 开关、安全状态 |

## 代码规范

- 前端：ESLint（flat config，`--max-warnings=0`）+ Prettier（80 列、双引号、
  尾逗号、2 空格）。
- 后端：`cargo clippy -- -D warnings` + `cargo fmt`。
- Pre-commit hook 跑 `make check`，任一环节失败即阻止提交。
- 错误文案：只有后端产出面向用户的本地化文本（`thiserror` / 消息表），前端原样展示。

## 改动影响面

改一处往往要连带改多处，漏一处的表现是"能跑但不对"。按动作查：

| 动作 | 必改 |
| --- | --- |
| 新增 Tauri 命令 | `commands/*.rs` 实现 + 在 `lib.rs` 注册 → `src/utils/api.ts` 类型化包装 → `src/types/*.ts` DTO → [03](03-api.md) 索引行。写库的还必须在 `db/` 或 `ledger/` 落实现，命令层不写 SQL |
| 新增/修改用户可见文案 | `src/i18n/locales/{zh,en}.json` 的 `errors.*` → 跑 `python tools/gen_error_messages.py` 重新生成 `errors/messages.rs` → 后端引用键 → [07](07-transactions.md) §5 表格（若属于交易校验） |
| 改表结构 | **先问用户** → 新增 `db/schema_vN.sql` + 在 `db/migrations.rs` 注册（v1 冻结）→ [02](02-data-model.md) 表清单与索引 → 受影响的 `db/*` 查询与测试 |
| 新增报表 | `db/reports.rs` 聚合 → `commands/reports.rs` → `src/types` + `api.ts` → `src/components/reports/*` 与 `ReportNav` → [04](04-frontend.md) §2 页面表与 [10](10-reports.md) 清单 |
| 新增/改页面 | `src/pages/*` + 路由 → [04](04-frontend.md) §2 页面表 → 菜单项与 `navigation` 键 → 对应 i18n 键组 |
| 改前端金额展示 | 只能动 `src/utils/format.ts`；任何加减聚合都该回到后端命令 |

## 快捷键

全局快捷键（唤起快速记账等）已于 2026-11-14 下线：系统级注册会被其它应用抢走，
失败时用户只看到"按了没反应"。现存的是窗口内快捷键：

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl/Cmd + Shift + I` | 打开 AI 记账输入框 |
| `Ctrl/Cmd + Enter` | 提交 AI 记账输入 |
| `Ctrl/Cmd + Z` | AI 输入框内撤回上一次输入 |
| `Escape` | 关闭弹窗 / 取消编辑 |

## 测试

| 层级 | 命令 | 范围 |
| --- | --- | --- |
| Rust 单元/集成测试 | `cargo test`（`make test-backend`） | db 层、ledger 能力层、mcp、命令层 |
| 前端组件测试 | `npx vitest run`（`make test-frontend`） | hooks、页面、组件行为 |
| Rust 覆盖率门禁 | `make coverage` | 行覆盖 ≥ 94%（`COVERAGE_MIN`，排除 `lib.rs` / `main.rs` / 错误消息表） |
| 前端覆盖率门禁 | `npm run test:coverage`（CI 跑） | `vitest.config.ts` 的 v8 阈值：语句 7% / 行 7% / 函数 8% / 分支 3%，全量源码参与统计，逐轮上调 |

重点被测的不变量：借贷平衡、金额解析与上限、分类镜像账户的创建/改名/删除、
名称解析四规则、对账差额归零与锁定、幂等三态、MCP 锁定与只读档行为、迁移幂等。
没有 E2E 框架（无 Playwright / tauri-driver），跨端行为靠手工验收。

## 构建与发布

```bash
make dev        # Tauri dev（端口占用自动顺延，scripts/dev.mjs）
make dev-web    # 仅前端
make check      # 错误消息表 + tsc + eslint + prettier + cargo fmt + clippy
make test       # vitest + cargo test
make release    # 当前平台安装包 → release/
```

- 直接 `npm run tauri build` 的产物在 `src-tauri/target/release/bundle/`；
  `make release` 会把 deb / rpm / AppImage / nsis / msi / msix / dmg 统一收集到
  `release/`。
- Windows 便携版：`make portable-windows`（单 exe）。
- CI 两个 job：前端 job（ubuntu）跑 tsc + eslint + prettier + 文档与错误表校验 + 前端
  覆盖率；后端 job 在 ubuntu / windows / macos 三平台矩阵各自跑 clippy + build +
  `cargo test`，覆盖率单独在 ubuntu 跑一次。安装包由本地 `make release-*` 生成
  （OpenSSL 交叉编译依赖本机 Strawberry Perl 等工具链）。
