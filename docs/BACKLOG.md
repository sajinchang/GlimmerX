# BACKLOG

> 未决事项与"决策过的否定"。**已完成的修复不记在这里**——`git log` 是唯一记录，
> 本文件只回答"还有什么没做"和"什么已经决定不做"。
> 每条做完就删掉，不追加历史。

## 未决

| # | 事项 | 现状 | 何时处理 |
| --- | --- | --- | --- |
| 1 | **无自动更新通道** | `Cargo.toml` / `tauri.conf.json` / `package.json` 均无 `tauri-plugin-updater`；v0.1.2 已产出 NSIS / MSI，用户只能手动下载新版本。发版后修好的问题不会到达存量用户 | 下次发版前 |
| 2 | **首页分类饼图口径** | `db/dashboard.rs:359-371`：日期条件写在 `WHERE` 里（`AND (p.id IS NULL OR (t.date >= ?2 AND t.date <= ?3))`），于是"有历史但本月无支出"的分类整行消失，而"从未有过支出"的分类以 0 出现——两种空值表现不一致 | 需产品确认：补零显示，还是统一隐藏 |
| 3 | `#[allow(dead_code)]` 清理 | 38 处 | 随手 |
| 4 | `v_posting_category` 视图 | 仅 `db/schema_v2.sql:77` 定义，全仓无读取方（排查用途已被报表查询取代） | 下次开 schema v4 时一并删除 |

## 决策过的否定（别再提，除非前提变了）

| 事项 | 结论与原因 |
| --- | --- |
| IPC 契约自动生成 | `tauri-specta` 面向 Tauri 2 仍为 `2.0.0-rc.28`，不宜引预发布依赖；`ts-rs` 需覆盖约 75 个前端类型 / 95 个 Rust 结构，属独立工程。要做得先只生成 DTO，再逐步切 import |
| 读写连接池 | SQLCipher 下每个新连接都必须重新 `PRAGMA key`，池化等于长期驻留密钥（或每次重问口令）。当前 `staleTime: 0` + WAL 已缓解大部分读放大 |
| 报表聚合改 `i128` | 单笔上限 1 亿元时需约 9.2 亿行才可能溢出 `i64`，无收益的类型扩散 |

## 已知的文案/契约遗漏

- `db/recent_dbs.rs:44,46,94,98,101`：5 处英文 `IoError`（`Failed to read config` 等）。
  经 `errors::user_text` 兜底后会显示成"数据库操作失败"，用户看到的原因不对，诊断信息也丢了。
  改法：新增 `errors.configAccessFailed` 之类的键，按读取/写入分开。

## 部署提醒

仓库版本仍是 `0.1.2`，v3 尚未发版。若本地库曾用含 v3 的 HEAD 跑过（`user_version = 3`），
再回退到旧构建，会缺 `legacy_transaction_categories` 表。补救：删库重建，或
`PRAGMA user_version = 2` 后重启让它重跑 v3 迁移。
