# GlimmerX

跨平台个人复式记账桌面应用：Tauri 2 + React 19 + TypeScript + SQLCipher，单用户、
单机、单币种、本地优先。

**代码是第一真相，设计文档是第二真相。** 本文件只保留代码与文档都不该重复的内容：
文档入口与五条硬规则。

## 文档入口

[docs/DESIGN.md](docs/DESIGN.md) 是设计文档索引（11 篇，含每篇「何时阅读」）。
常用：概念模型 → `01`，改库 → `02`，加命令 → `03`，改 UI → `04`，提交前约束 → `05`，
交易 → `07`/`08`，复式与 schema → `09`，报表 → `10`，AI/MCP → `11`。
后端代码地图见 [src-tauri/AGENTS.md](src-tauri/AGENTS.md)。

## 硬规则

1. **改数据库必须先问用户。** 表结构、增删列、迁移脚本一律先确认再动手。
   `schema_v1.sql` 冻结（有哈希测试），变更只能新增 `schema_vN.sql` 并在
   `db/migrations.rs` 注册。
2. **用户可见文案只在后端产出。** Rust 侧走 `errors::message` / `errors::user_text`，
   键在 `src/i18n/locales/{zh,en}.json`，生成到 `errors/messages.rs`；前端原样展示，
   不翻译、不拼接、不改写。
3. **金额只由后端算。** 库里存整数分（`i64`），解析、加减、汇总、输入格式化全在 Rust；
   前端只格式化展示，不做任何金额运算。财务数据也不许出现陈旧值（默认 `staleTime: 0`，
   唯一落点 `src/lib/queryClient.ts` 与 `src/constants/query.ts`）。
4. **SQL 一律参数化。** 动态值只能走 `?` 绑定，绝不拼进 SQL 文本；动态列名只能来自
   白名单字面量。
5. **日期用本地时区。** 业务日期 `YYYY-MM-DD`（Rust `utils::time`，前端
   `src/utils/date.ts`），时间戳 RFC3339 带本地偏移。禁 `Utc::now()`，禁
   `toISOString().split("T")[0]`。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `make setup` | 装依赖并配置 git hooks |
| `make dev` / `make dev-web` | Tauri 开发 / 只跑前端 |
| `make check` | 错误表 + 文档校验 + tsc + eslint + prettier + cargo fmt + clippy |
| `make test` | vitest + cargo test |
| `make coverage` | Rust 行覆盖门禁 94% |
| `make release` / `make portable-windows` | 当前平台安装包 / 单 exe |

前端覆盖率门禁在 `vitest.config.ts`（CI 跑 `npm run test:coverage`）。改完代码至少跑
`make check`；pre-commit 会自动跑同一套检查的子集。
