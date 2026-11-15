# GlimmerX 设计文档

> v2.1 | 2026-11-15 | 12 篇，按主题组织；已落地能力不再保留方案论证过程。

**GlimmerX** 是基于 Tauri 2 + React 19 的跨平台个人复式记账桌面应用。
核心理念：**本地优先、数据私有、复式记账、简洁高效**。

## 核心不变量

先读这六条，再按需查文档——所有设计都以它们为前提：

1. **分录是唯一真相**：交易只存日期与描述，类型/分类/余额全部由 `postings` 派生。
2. **借贷必须平衡**：同一交易 `SUM(postings.amount) = 0`（`i128` 求和）。
3. **金额是整数分**，解析与计算只在 Rust 后端；前端只格式化与展示。
4. **分类与损益账户 1:1**：`categories.account_id` 显式绑定，账本从不按名字反查分类。
5. **余额不落库**：一律由分录聚合，报表与列表共享同一口径。
6. **每个分类只属于损益**：转账在资产/负债账户之间，不带分类。

## 文档索引

| 文档 | 内容 | 何时阅读 |
| --- | --- | --- |
| [01-overview](design/01-overview.md) | 定位、技术栈、概念模型、功能范围与里程碑 | 初次了解项目、确认边界 |
| [02-data-model](design/02-data-model.md) | 表结构、索引、派生对象、迁移规则 | 改数据库、写查询 |
| [03-api](design/03-api.md) | Tauri 命令索引、IPC 约定、错误处理 | 加命令、查命令用途 |
| [04-frontend](design/04-frontend.md) | 页面清单、交互约定、首页结构、国际化 | 改 UI、加页面 |
| [05-constraints](design/05-constraints.md) | 金额/日期约束、加密会话、代码规范、改动影响面、测试与构建 | 提交前、搭环境 |
| [06-risks](design/06-risks.md) | 平台与数据风险 | 评估取舍 |
| [07-transactions](design/07-transactions.md) | 交易分层、数据结构、分录推导、验证规则、事务边界 | 做交易相关功能 |
| [08-transaction-list](design/08-transaction-list.md) | 列表查询与筛选、分页与虚拟滚动、详情、编辑、删除 | 改列表/详情页 |
| [09-double-entry](design/09-double-entry.md) | 复式记账决策记录：对账、储蓄目标、单币种、硬删除、schema 演进 | 理解模型地基、查"为什么" |
| [10-reports](design/10-reports.md) | 六张报表的口径、URL 筛选、ECharts 约定 | 改报表/图表 |
| [11-ai-mcp](design/11-ai-mcp.md) | 能力层、内部 AI 提案流、MCP 服务、幂等、Skill | 做 AI 与 agent 接入 |
| [12-ui-system](design/12-ui-system.md) | 令牌三层、语义色、四套预设、字体字阶、图表色板、打印 | 改样式、调主题 |

外部文档：

- [AGENTS.md](../AGENTS.md) —— 给 AI 编码助手的文档入口与硬规则（数据库变更需确认、错误文案只在后端等）。
- [src-tauri/AGENTS.md](../src-tauri/AGENTS.md) —— Rust 后端模块地图、事务边界与测试约定。
- [skills/glimmerx-ledger/SKILL.md](../skills/glimmerx-ledger/SKILL.md) —— 给外部 agent 的账本操作手册。
- [BACKLOG.md](BACKLOG.md) —— 未决事项与"决策过的否定"；查"还有什么没做"看这里。

## 项目快照

```text
技术栈: Tauri 2 + React 19 + TypeScript + SQLCipher + Tailwind 4 + shadcn/ui
阶段:   核心功能完成（账户/交易/分类/预算/储蓄/对账/报表/AI/MCP）
语言:   中文、英文
平台:   Windows / macOS / Linux
schema: v3（v1 冻结，变更只能新增 vN）
```
