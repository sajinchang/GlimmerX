# 01 · 项目概述

> 返回 [DESIGN.md](../DESIGN.md)。相关：数据模型见 [02](02-data-model.md)、交易见
> [07](07-transactions.md) / [08](08-transaction-list.md)、前端见
> [04](04-frontend.md)、视觉系统见 [12](12-ui-system.md)。

## 定位

**GlimmerX** 是跨平台个人复式记账桌面应用（Tauri 2 + React 19）。核心理念：**本地优先、
数据私有、复式记账、简洁高效**。单用户、单机、单币种（CNY），没有服务端。

## 设计哲学

| 借鉴对象 | 借鉴内容 |
| --- | --- |
| [Beancount](https://beancount.io/) | 严格借贷平衡、以分录为唯一真相的数据模型 |
| [Firefly III](https://www.firefly-iii.org/) | 账户体系与扩展字段（账户角色、负债/信用卡子类型） |
| [Actual Budget](https://actualbudget.org/) | 本地优先、即时响应、信封预算、克制的 UI |
| [tauri-ui](https://github.com/agmmnn/tauri-ui) | Tauri 项目骨架 |

## 技术栈

| 层级 | 选型 |
| --- | --- |
| 桌面壳 | Tauri 2（Rust），IPC 命令名即接口 |
| 前端 | React 19 + TypeScript（strict，`noUncheckedIndexedAccess`） |
| 构建 | Vite 7 |
| 样式 | Tailwind CSS 4（CSS-first，无 `tailwind.config.ts`）+ shadcn/ui |
| 存储 | SQLCipher（SQLite），AES-256，用户密码解锁 |
| 后端数据层 | rusqlite 0.39 + 手写迁移（`schema_v1/v2/v3.sql`） |
| 长列表 | **@tanstack/react-virtual** |
| 图表 | **echarts** 6（canvas） |
| 日期 | Rust `chrono`（本地时区）/ 前端 **date-fns** |
| 国际化 | **i18next**（`zh` / `en`） |

## 概念模型

交易不是"一笔支出"，而是**一组分录**：

```text
Transaction（date, description, created_at, updated_at）
  └─ Posting（account_id, amount，整数分，正=借方 / 负=贷方）
       └─ Account（asset | liability | income | expense | equity）
            └─ Category ──1:1──> income / expense 账户（镜像账户）
```

- **不存 `transaction_type`**：支出/收入/转账只是录入侧的推导模式，落库后只剩分录。
- **账户五类**：`asset` / `liability` 是钱包（可转账、计入净资产）；`income` /
  `expense` 是分类的镜像账户，只能经分类创建；`equity` 由系统管理（期初余额），禁止
  用户交易引用。
- **分类 ↔ 损益账户 1:1**：`categories.account_id` 显式绑定，改名同步改账户名，故账本
  从不按名字反查分类；拆分交易因此天然支持（一笔交易多条损益分录）。
- **余额永不落库**：一律由分录聚合，报表与列表都复用同一聚合口径。
- **金额整数分**：解析、计算、汇总全在后端，前端只格式化。

细节：分类镜像账户与硬删除见 [09](09-double-entry.md)，分录推导见
[07](07-transactions.md)。

## 功能范围与状态

| 模块 | 已落地 | 未做 |
| --- | --- | --- |
| 账本 | 创建/打开/解锁、最近列表、改密、锁定、空闲自动锁定 | 数据从备份恢复（只做备份写入） |
| 账户 | 资产/负债 CRUD、路径创建、扩展字段（角色/负债/信用卡）、转账、期初余额、停用 | 投资账户类型、账户树折叠之外的层级重排 |
| 交易 | 手工分录录入、快速记账（支出/收入/转账）、列表（筛选/排序/虚拟滚动/日期分组）、详情、编辑、硬删除 | 定期交易、标签、批量操作、收款人 |
| 分类 | 损益分类 CRUD、删除影响预览、与镜像账户联动 | 自动分类规则、多级分类 |
| 预算 | 周/月预算、进度与超支提示、结余滚存、预算执行报告 | — |
| 储蓄目标 | 目标 = 专用资产账户 + 目标额，进度取账户余额 | — |
| 对账 | 分录级 `cleared`、对账单、自动匹配、撤销 | 拆单跨账户对账单的批量工具 |
| 报表 | 6 张（现金流 / 分类构成 / 净资产归因 / 资产负债表 / 账户明细 / 预算执行），筛选存 URL，ECharts 渲染；审计移至设置页 | 收付实现制、自定义报表、导出 PDF |
| 数据管理 | 数据库文件备份 | CSV / Beancount 导入导出（已下线）、导出 PDF |
| AI | 内部 AI 提案 + 人工确认（支出/收入/转账/建账户） | function-calling 循环、提案持久化 |
| 自动化 | 本机 MCP 服务：8 个工具 + 3 个资源、两档信任、幂等键 | prompts / completions、局域网暴露 |
| 界面 | 4 套预设（terminal / terminal-cool / paper / contrast）、深浅色、中英双语 | 移动端、主题编辑器 |

报表口径见 [10](10-reports.md)，AI 与 MCP 见 [11](11-ai-mcp.md)。

## 明确不做

- 多用户协作、云端同步、银行/第三方 API。
- 多币种与汇率换算：DB 保留 `currency` 列但固定 `CNY`，任何 DTO/UI 都不暴露它。
- 移动端、账本分享、社交。
- 企业财务（发票、税务、审批流）。
- 软删除与操作审计：删除即物理删除，可靠性交给数据库备份。

## 里程碑

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P1 | 骨架：Tauri + React + SQLCipher、解锁流程、布局、主题、i18n | ✅ |
| P2 | 账户与交易核心：CRUD、分录、列表、余额、概览 | ✅ |
| P3 | 分类、预算、快速记账 | ✅ |
| P4 | 报表与分析（9 张 → 2026-11 合并为 6 张） | ✅ |
| P5 | 数据管理（仅保留备份）、桌面快捷键（已下线） | ✅ |
| P6 | 复式能力升级：分类 1:1、对账、储蓄目标、单币种、硬删除（schema v2/v3） | ✅ |
| P7 | AI 记账重构 + 外部 agent 接入（能力层、MCP、幂等、Skill） | ✅ |

后续工作不再按阶段排期，直接看各文档的"未做"列。
