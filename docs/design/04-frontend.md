# 04 · 前端：页面与交互

> 返回 [DESIGN.md](../DESIGN.md)。令牌、预设、字体、图表色板、动效与打印见
> [12-ui-system](12-ui-system.md)，报表口径见 [10](10-reports.md)。

## 1. 应用布局

```text
┌──────────────────────────────────────────────────────┐
│  GlimmerX                              (标题栏 44px) │
├──────────────┬───────────────────────────────────────┤
│ 侧边栏 208px │ 主内容区                              │
│  概览        │  ┌─────────────────────────────────┐  │
│  账户        │  │  页面内容 / 三栏仪表盘           │  │
│  交易        │  └─────────────────────────────────┘  │
│  分类        │                                       │
│  预算        │                                       │
│  储蓄        │                                       │
│  报表        │                                       │
│  ────────    │                                       │
│  设置        │                                       │
│  锁定        │                                       │
│  切换账本    │                                       │
└──────────────┴───────────────────────────────────────┘
```

侧栏导航顺序固定为：概览、账户、交易、分类、预算、储蓄、报表；底部独立区放设置、锁定、
切换账本。余额/收支汇总不属于全局状态栏，集中在概览页的结论层。

## 2. 页面清单

| 路由 | 页面 | 职责 | 主要数据来源 |
| --- | --- | --- | --- |
| `/unlock` | 解锁页 | 新建/打开账本、最近列表、密码校验、SQLCipher 解密 | `dbCheckAnyExists`、`dbListRecent`、`dbCreate`、`dbUnlock` |
| `/onboarding` | 引导页 | 首个账户创建向导，可跳过 | `AccountWizard`（`accountCreate` / `accountBatchCreate`） |
| `/` | 概览 | 结论层 + 待办层 + 三栏趋势/分解 | `dashboardSummary`、`dashboardMonthlyChart`、`dashboardCategoryBreakdown`、`dashboardTopExpenses`、`transactionListPaginated`、`accountBalancesBatch`、`budgetListStatuses`、`transactionList`（活动日历） |
| `/accounts` | 账户列表 | 资产/负债分组、余额、编辑、转账、对账 | `accountList(["asset","liability"])`、`accountBalance`、`accountMetaSchema`、`accountTransfer`、`reconcile*` |
| `/transactions` | 交易列表 | 分页列表、搜索与筛选、快速记账 | `transactionListPaginated`、`accountList`、`categoryList` |
| `/transactions/:id` | 交易详情 | 查看分录、编辑、删除 | `transactionDetail`、`transactionUpdate`、`transactionDeletePreview`、`transactionDelete`、`accountList`、`categoryList` |
| `/categories` | 分类管理 | 收/支两组平铺列表（无多级分类）、增删改、删除影响预览 | `categoryList`、`categoryCreate`、`categoryUpdate`、`categoryDeletePreview`、`categoryDelete` |
| `/budgets` | 预算 | 月度预算状态、超支提示 | `budgetListStatuses`、`budgetCreate`、`budgetUpdate`、`budgetDelete` |
| `/savings` | 储蓄目标 | 目标进度、转入 | `savingsList`、`accountList(["asset"])` |
| `/reports` | 报表 | 期间报表与图表切换 | `reportStandard`、`reportTrend`、`reportCategoryBreakdown`、`reportBalanceSheet`、`reportAudit`（`useReportQuery`） |
| `/settings` | 设置 | 主题/预设、语言、自动锁定、改密、备份、AI、MCP、审计 | `getSetting`/`setSetting`、`dbChangePassword`、`dbBackup`、`aiTestConnection`、`reportAudit` |

账户详情没有独立路由：`accountBalance(id)` 在列表页的对话框内按需查询。新增/编辑交易
同样不占独立路由，表单在列表页与 `/transactions/:id` 内联。报表清单见
[10](10-reports.md)，本文不重复。

## 3. 核心交互约定

| 约定 | 落地位置 | 理由 |
| --- | --- | --- |
| `staleTime: 0` + `refetchOnMount: "always"` | `src/lib/queryClient.ts`（全局默认） | 财务数据永不渲染陈旧值，每次挂载都回后端取值 |
| `gcTime: 5 * 60 * 1000` | 同上 | `gcTime` 只决定未挂载查询的保留时长，不发放旧数据；非零避免无意义重取 |
| `refetchOnWindowFocus: false` | 同上 | 桌面应用窗口常驻，聚焦重取等于反复空转 |
| 常量收敛 | `src/constants/query.ts`：`QUERY_CONFIG.FINANCIAL` / `QUERY_CONFIG.STATIC` | 只有不可变元数据可套 `STATIC`（`staleTime: Infinity`）；业务查询一律 `FINANCIAL`，不在单个 hook 里重复覆盖 |
| 金额只展示不计算 | `src/utils/format.ts`（`formatAmount`、`formatAmountWithSign`、`centsToYuan`、`MONEY_SYMBOL = "¥"`） | 金额与合计由 Rust 侧以分为单位算好，前端不做加减与再聚合；负数写作 `-¥50.00`（符号在货币符号前） |
| 错误消息原样展示 | `src/utils/errorTranslation.ts` | 后端错误已是面向用户的本地化文案，前端不翻译、不裁剪、不重组；仅字符串/`Error.message` 直出，其余回退 `common.errorGeneric` |
| 日期走本地工具 | `src/utils/date.ts`：`parseDateSafe`、`formatLocalDate`、`todayLocalDate`、`currentMonthBoundsLocal`、`getDefaultRangePresetDates` | `new Date("2026-10-26")` 是 UTC 零点，西半球会退回前一天；禁止 `toISOString().split("T")[0]` 之类切片 |
| 缓存失效单一入口 | `src/lib/invalidateLedger.ts` | 失效键列表曾分散五处并有一处拼错，`staleTime: 0` 让错误静默存活；集中一处才能改对 |
| 锁定 | `dbLock` → 清内存连接 → `/unlock` | 密钥不驻留，回到解锁页 |

## 4. 首页结构

```text
DashboardStatusBar   净资产 46px 主读数 + 收入/支出/结余小字 + 90 日活动热力带   raise
AttentionBar         超预算分类数 · 久未记账天数（无待办时显示"账目已齐"）
┌────────────────────┬──────────────────┬─────────────────┐
│ 月度收支图  flex-1 │ 最近交易（表格） │ 预算 / 账户余额 │
│ 分类收支（300px）  │ 吸顶表头、内滚   │ / Top 支出      │
└────────────────────┴──────────────────┴─────────────────┘
```

- **三栏同高靠视口**：页面根 `h-full`，grid `flex-1 min-h-0`，每栏内部滚动，卡片
  `flex-1`。`min-h-full` 会让高度回落 `auto`，`flex-1` 失去基准。
- **哪张卡吃余高**：时间序列越高越好，月度图 `flex-1`；环形图半径固定，不吃高度
  （300px）；右栏三张列表各分 1/3。
- **为什么是状态条不是汇总卡**：七个面板读七个数字、各在自己的基线上，比较时必须移眼；
  状态条把数字放到同一条线、同一列宽、同一字体。
- **为什么交易用表格**：同样面积放三倍条目，金额成一列，眼睛比较的是量级。
- **金额符号按现金流**：`displayAmount` 是借方合计、恒为正，用它着色会把每笔支出画成
  收入；列表项用 `flow_amount`（只汇总资产/负债侧）——支出为负、收入为正、自有账户互转
  为 0 中性显示。
- **列宽按内容权重**：`1.2fr / 1fr / 0.9fr`（xl 以上三栏，lg 两栏）。
- **刻意留白项**：没有 90 日净值曲线（后端无按日净资产命令），位置给了从真实交易算出的
  热力带；待办只有超预算与久未记账两项，其余聚合接口补齐前不编数字；`float` 材质已就绪
  但首页暂无临时浮层。

视觉依据（材质、光源、网格、打印）见 [12](12-ui-system.md)。

## 5. 国际化

| 项 | 选型 |
| --- | --- |
| 库 | `i18next` + `react-i18next`（`src/i18n/index.ts`） |
| 语言状态 | Zustand `useLanguageStore`，切换经 `setUiLanguage` 同步到后端 |
| 翻译存储 | `src/i18n/locales/{en,zh}.json`，单一 `translation` 命名空间 |
| 持久化 | `localStorage` 键 `glimmerx:language` |
| 检测顺序 | 已存语言 → `navigator.language`（`zh*` → `zh`，其余 → `en`） |
| 兜底 | `fallbackLng: "en"`；插值 `escapeValue: false` |

| 代码 | 名称 | 优先级 |
| --- | --- | --- |
| `en` | English | P0（默认/回退） |
| `zh` | 简体中文 | P0 |

键按页面/领域分组，顶层为：`common`、`unlock`、`onboarding`、`dashboard`、`accounts`、
`categories`、`budgets`、`transactions`、`navigation`、`settings`、`errors`、`quickAdd`、
`ai`、`placeholder`、`reports`、`reconcile`、`savings`、`mcp`。使用方式 `t("accounts.title")`，
支持插值 `{{name}}` 与富文本 `<1>…</1>`；`errors.*` 与后端错误键一一对应
（`gen_error_messages --check` 校验键集）。

缺失键行为：某语言缺键时 i18next 回退到 `en`，两者都缺才显示键路径本身；日期格式随
语言走 `date-fns` 的 `zhCN` / `enUS`（`src/utils/date.ts::getDateLocale`），不做字符串
拼接。
