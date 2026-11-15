# 10 · 报表：六张报表，一次筛选

> 返回 [DESIGN.md](../DESIGN.md)。2026-11-14 决策：旧版 9 张按实现切分的报表合并为
> 6 张按问题切分的报表，图表库 Recharts → ECharts 6。

## 六张报表

| 报表 | 问题 | 组件 | 后端 |
| --- | --- | --- | --- |
| 现金流 | 这段时间进来多少、出去多少、留下多少 | `CashflowReport` | `report_standard` |
| 分类构成 | 钱花在哪些类目上 | `CategoryBreakdownReport` | `report_category_breakdown` |
| 净资产归因 | 净资产变了多少，是哪些账户变的 | `NetWorthAttributionReport` | `report_standard`（`accountChanges`） |
| 资产负债表 | 此刻拥有什么、欠什么 | `BalanceSheetReport` | `report_balance_sheet` |
| 账户明细 | 某一个账户这段发生了什么 | `AccountDetailReport` | `report_account_transactions` / `report_account_balance_trend` |
| 预算执行 | 计划与实际差多远 | `BudgetExecutionReport` | `budget_list_statuses` |

**审计报告不在报表页**：它回答"账本自身是否自洽"（分录平衡、对账状态），入口在
设置 → 数据体检（`report_audit`）。趋势图也不再单独成表——时间序列是图表形态而不是
一个问题：现金流图用 `report_trend`，账户明细图用 `report_account_balance_trend`。

筛选条、报表目录、报表框架各只有一份（`ReportFilterBar` / `ReportNav` /
`ReportFrame`），不再每张报表复制一套。

## 一次筛选：状态进 URL

时间范围是所有报表共用的轴，因此上提到页面并序列化进 URL：

```text
/reports?r=cashflow&p=last6Months
/reports?r=accounts&a=<accountId>&p=last12Months&c=lastYear
```

只写非默认值，首次进入是干净的 `/reports`。收益：返回键可用、报表可分享，且不可能
出现"页头说近 6 个月、正文算本月"。

## 时间粒度是刻度，不是筛选

粒度只影响图表 X 轴分桶，不影响任何汇总数字。规则：

- 默认由区间跨度推导：≤45 天按日，≤120 天按周，更长按月。
- 用户只能在当前区间画得出来的刻度里选，控件位于图表面板（`ChartScaleSelect`），
  只有一个可选值时控件不出现；URL 的 `g` 只记录用户改过的选择。

## 对比基期

`CompareMode` 三档：**较上期 / 较去年同期 / 不对比**；选"不对比"时对比表与变化率
整块不渲染。

不变量：**对比期必须是紧挨本期之前、长度相同的一段**（`reports` 有回归测试锁住）。
旧实现把滚动区间的对比期算成"N 个月前 1 号 → 今天"，窗口比本期长一倍且包含本期，
于是环比数字是窗口长度的算术结果，不是经营结论。

## 图表：ECharts 6

- 统一样式层 `utils/chartTheme.ts`（轴、网格、tooltip、图例），禁止在图表里写死色值。
- 按需注册：`components/charts/echarts.ts` 只 `use()` 用到的图表类型与组件，
  不整包引入（包要塞进 Tauri 二进制，永不走 CDN）。
- 色板来自 CSS 令牌：`useChartColors()` 从 computed style 读 `--chart-*`
  （canvas 不解析 `var()`），主题或预设变化时重算。
- 三个必要细节：容器高度为 0 时延迟 `init`；`setOption(..., { notMerge: true })`
  防止旧序列残留；`beforeprint` 按纸张宽度重绘。
- 悬停：`focus: "none"`（默认的 `series` 会把其它序列压到 10% 并闪烁）、
  tooltip `confine: true`（否则溢出画布被裁）、`transitionDuration: 0`
  （默认 0.4s 会让 tooltip 追着一个过时的位置）。
- `resize` 只在容器尺寸真的变化时执行，避免 observer 回路。
- 没做：dataZoom、地图、K 线、桑基。层级分类与周期交易在数据模型里不存在，
  硬画就是编数据。

## 两张没有新增 IPC 的报表

- **净资产归因**：`report_standard.accountChanges` 已给出每个账户的期初与期末余额，
  相减即变动，加总恰好等于净资产变动。这不是估算：`postings` 恒平衡，账户互转两侧
  抵消，只有损益分录留在净资产上，所以"部分之和 = 整体"是结构保证。
- **预算执行**：`budget_list_statuses(year, month)` 已返回 `amount` 与 `spent`。

口径必须写在报表标题下（`reports.scope.*`）：`budgets` 表**没有历史快照**，
回看旧月份时实际支出是真的、预算目标可能是后来改过的版本。

## 打印

`@media print` 里图表固定 `60mm` 高（`auto` 会让画布印成空白）并在 `beforeprint`
重绘；目录与筛选条 `data-print="hide"`，正文 `data-print="page"` 释放滚动高度。
仓库没有 jsPDF / html2canvas，导出 PDF 需要另做链路。
