# 12 · 视觉系统：刻度仪器

> 返回 [DESIGN.md](../DESIGN.md)。页面清单与交互见 [04](04-frontend.md)，图表口径见
> [10](10-reports.md)。**所有视觉参数只存在于 `src/styles/globals.css`**，组件只消费
> 令牌，不写字面色值。

## 1. 定位

深色交易终端（Bloomberg 血统）+ 工业仪器纪律，浅色配套称 **paper**。判据一句话：界面
要像**仪器**，不像**应用**——数字对得齐、分区靠线不靠阴影、强调色有语义、装饰为零。
因此不做霓虹渐变、发光、玻璃拟态、大圆角、药丸徽章。任何"加点效果更好看"的提议，先
回答"它让数字更容易读吗"。

## 2. 令牌落点

| 层 | 位置 | 变量 |
| --- | --- | --- |
| Tailwind 派生层 | `@theme` | `--color-background` / `--color-card` / `--color-secondary` / `--color-accent` / `--color-popover` / `--color-muted` / `--color-border` / `--color-input` / `--color-foreground` / `--color-primary` / `--color-signal` / `--color-ring` / `--color-income` / `--color-expense` / `--color-info` / `--color-chart-1…5` |
| 表面阶梯 + 模式参数 | `:root, [data-mode="light"]` 与 `.dark, [data-mode="dark"]` | `--s-base` / `--s-card` / `--s-hover` / `--s-float` / `--s-sunken` / `--s-ink` / `--s-muted`、`--hue`、`--chroma-base`、`--chroma-scale`、`--chroma`、`--line`、`--line-input`、`--signal-l/-c/-h/-lift`、`--income` / `--expense` / `--info`、`--chart-1…8` / `--chart-grid` |
| 深度 | 模式块（不进 `@theme`，避免被 Tailwind 裁剪） | `--bevel-hi` / `--bevel-lo` / `--bevel-well-lip`、`--shadow-contact` / `--shadow-float` / `--shadow-well`、`--surface-raise` / `--surface-well`、`--grid-line` / `--grid-major` |

表面统一是 `oklch(lightness chroma hue)`：亮度单独成阶，色相与色度抽成参数，
`--chroma: calc(var(--chroma-base) * var(--chroma-scale))`，所以新增一套氛围只需两行。

**`--s-hover` 与 `--s-float` 必须分开**：浅色里 hover 变暗、浮层变亮，深色里两者都变亮；
合成一个 token 会让 paper 的下拉菜单看起来凹进去。

**层级不靠工具类阴影**：`--shadow-2xs … --shadow-2xl` 全为 `none`，但深度不是没有，而是
换成仪器语言——上缘与左缘高光 `--bevel-hi`、下缘暗边 `--bevel-lo`、紧贴的接触阴影
`--shadow-contact`，由 `[data-elevation]` 选择器统一供给：

| `data-elevation` | 效果 | 用途 |
| --- | --- | --- |
| `raise` | `--surface-raise` 渐变 + 上缘高光 + 接触阴影 | 首页所有面板、状态条 |
| `well` | 反转明暗 + 内阴影 + 底边亮唇 | 真正需要下沉的展示位，首页不用 |
| `float` | `--color-popover` 78% + `backdrop-filter: blur(20px) saturate(1.2)` + `--shadow-float` | 弹出层 / 临时浮卡 |

同屏对等面板必须共用一条边界语言：单独反转一张卡会读成渲染出错，而不是"更深"。

圆角是收着而不是没有：`--radius-xs/sm/md/lg/xl/2xl/3xl` = 2/4/6/8/10/14/18px，控件 6px、
卡片 10px，`rounded-full` 只留给开关与圆点。另在模式块放无前缀 `--radius: 6px`，供
sonner 之类只认单一默认半径的库使用（写进 `@theme` 会被裁掉）。

## 3. 语义色

| 令牌 | 含义 | 使用位置 |
| --- | --- | --- |
| `--color-signal` | 唯一强调色（琥珀，`--signal-h: 65`） | 关键数字、当前项、超支、待办 |
| `--color-income` | 收入 / 正方向 | 收入金额、正结余 |
| `--color-expense` | 支出 / 负方向（`--color-destructive` 同源） | 支出金额、负结余、超支、删除 |
| `--color-info` | 信息 | 链接、时间序列、资产 |
| `--color-primary` | 墨色（近白/近黑），不是强调色 | 主按钮底 |

三条硬规则：强调色只有一支且只出现在上述位置；语义色不跟随强调色（换预设后收支仍是
红绿）；禁止 Tailwind 调色板类（`text-red-600` / `bg-emerald-500`），一律 `text-income` /
`text-expense` / `text-signal` / `text-info`。

## 4. 预设：四种

| `data-preset` | hue | chroma-scale | signal | 说明 |
| --- | --- | --- | --- | --- |
| `terminal` | 250 | ×1 | L .55 / C .13 / H 65 | 琥珀，默认 |
| `terminal-cool` | 234 | ×1.15 | L .56 / C .11 / H 205 | 冰蓝，整体一个温度 |
| `paper` | 78 | ×1.5 | L .50 / C .15 / H 55 | 暖纸 + 墨戳（H 55 而非 30，避免接近 `--expense` 把高亮读成亏损） |
| `contrast` | 250 | ×0 | L .50 / C .16 / H 65 | 可读性预设：无色度、`--line` .26、`--s-muted` .36，深色态覆盖为 .2 / .78 |

预设只设四样（表面色相、色度倍数、信号三元组，contrast 额外管线宽与次要文字），亮度
永远来自阶梯，所以预设最坏只是偏色，不会白字白底。用 `data-preset` 而非 class，是为了
不与工具类撞名；属性选择器与 `.dark` 同权重，预设块必须排在模式块之后，这个顺序不能调。
设置页缩略图是把预设真的套在子树上（`data-preset` + `data-mode` + `.preset-preview`），
而非写死 hex。

## 5. 字体与字阶

```text
--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, …（不含任何 CJK 家族）
--font-sans: system-ui, "PingFang SC", "Microsoft YaHei UI", "Noto Sans SC", …
```

- 数字与日期走 mono，中文走 sans：汉字进等宽会撑爆列宽，故 mono 字体栈刻意不列 CJK。
- 字体本地打包（`src/assets/fonts/jetbrains-mono-{400,500}.woff2`，共 42 KB，SIL OFL）
  ——Tauri 离线运行，CSP 不该为字体开口子。
- `html` 挂 `font-feature-settings: "tnum" 1, "lnum" 1, "calt" 0`，金额列无需逐处
  `tabular-nums`。
- 中文没有 600/700 字重，`font-bold` 会触发合成粗体；层级只靠字号与色阶，最强到
  `font-medium`。

字阶：`--text-xs 11px` / `sm 13px` / `base 15px` / `lg 17px` / `xl 20px` / `2xl 24px` /
`3xl 28px`，外加唯一的 display 台阶 `--text-display: 2.875rem`（46px）。

| 位置 | 尺寸 | 类 |
| --- | --- | --- |
| 页面级主读数（净资产，每页至多一个） | 46px | `text-display font-mono font-medium` |
| 页面级汇总（报表头） | 20px | `text-xl font-mono font-medium` |
| 卡片内关键数字 | 15px | `text-base font-mono font-medium` |
| 表格与列表 | 13px | `text-sm font-mono` |

## 6. 图表色板

`--chart-1 … --chart-8`（深浅各一套）+ 独立的 `--chart-grid`。顺序按"被读到的频率"排而
非光谱：前四色承担大多数图表，灰阶收尾，第十个切片不必有第十种色相。paper 态 chroma
压到 0.1 以下，0.11+ 时青蓝会盖过琥珀、环图不再读成一张图。

色值由 `src/utils/chartColors.ts` 的 `useChartColors()` 从 computed style 读出后喂给
ECharts（canvas 不解析 `var()`，也不认 CSS 类），并在 `effectiveTheme` / preset 变化时
重算。

## 7. 密度与动效

- 4px 网格；列表行高 36px（`py-2` + 13px 行高）；卡片内距 12/16；表格单元格
  `px-3 py-2`；侧栏 208px、页头 44px。
- 动效 120ms `cubic-bezier(.2, 0, 0, 1)`，无回弹；`prefers-reduced-motion` 全局降到
  0.01ms。
- 焦点环 `ring-1` 实线（`:focus-visible`），不是 3px 半透明光晕。
- 滚动条按表面阶梯着色（`scrollbar-width: thin`），不用系统默认，避免像另一个程序贴在
  窗口里。
- 动效只留一处呼吸（实时点 `animate-pulse`）与数据 tick 闪；其余 120ms 无回弹。

## 8. 刻度仪器（设计宪法）

一句话：一块被使用中的仪器——底板有刻度，面板有厚度，浮层才是玻璃。

| 项 | 决策 |
| --- | --- |
| 信息架构 | 四层尺寸递减：结论（净资产 + 90 日活动热力带）→ 待办 → 趋势 → 分解 |
| 背景 | 数据即背景：32px 校准网格（横纵同刻），160px 主线（= 五周），左上单一暖光源，`mask` 向边缘渐隐；热力带与网格同基准 |
| 光源 | 唯一光源左上 45°：高光在上缘与左缘，阴影紧贴右下 1px（Fluent 的 key shadow 语义），不是 20px 以上的柔光 |
| 材质 | 内容面板一律不透明；Acrylic 只给临时性表面（弹出层 / 浮卡），也因此不让多块模糊面板边对边叠放 |
| 动效 | 只留一处呼吸与数据 tick 闪；其余 120ms 无回弹 |
| 色彩 | 单支琥珀，一屏一次色彩事件；语义色独立定义 |

## 9. 打印

打印是纸，不是导出 PDF：`@media print` 把令牌翻成纸张阶梯（纯白底、`--line` 0.6、
`--chroma` 0），隐藏侧栏与按钮，`[data-print="panes"]` 降为单列文档流，卡片
`break-inside: avoid`，表头 `table-header-group`，图表给 60mm 固定高并在 `beforeprint`
重绘（`auto` 会让画布印成空白）；目录与筛选条 `data-print="hide"`，正文
`data-print="page"` 释放滚动高度。

仓库里没有 jsPDF / html2canvas，需要"导出 PDF"按钮就得另做链路。
