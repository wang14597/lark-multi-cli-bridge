# 变更索引

按时间倒序排列的全部受追踪变更(最新在上),每个变更文档一行。约定见
[`CLAUDE.md`](../../CLAUDE.md)。

English: [INDEX.md](INDEX.md)

| 日期 | 类型 | 变更 | 摘要 |
|------|------|------|------|
| 2026-06-03 | fix | [fix-daemon-supervisor-path](2026-06-03-fix-daemon-supervisor-path.zh.md) | 后台 `lmcb start` 按源码目录结构计算 supervisor 入口路径,在 tsup 压平的 `dist/` 里指向构建产物之外并静默失败。修正路径,spawn 前加存在性守卫 + 回归测试。 |
| 2026-06-02 | docs | [introduce-change-tracking](2026-06-02-introduce-change-tracking.zh.md) | 建立"每次变更随附文档"的约定 + `CLAUDE.md`;把 `architecture.md` 版本标注刷新到 v0.7.1。 |
