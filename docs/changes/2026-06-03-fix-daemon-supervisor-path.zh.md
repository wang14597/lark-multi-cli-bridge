---
date: 2026-06-03
type: fix
slug: fix-daemon-supervisor-path
---

# 修复后台 `lmcb start`:supervisor 入口被解析到 `dist/` 之外

**类型:** fix

## Motivation / 动机

`lmcb start`(默认后台模式)以 detached 子进程方式拉起 supervisor,
入口路径按当前模块目录相对计算。原路径 `../../supervisor/index.js`
是按**源码**目录结构(`src/cli/commands/start.ts`)写的,但 tsup 会把
`src/cli/index.ts` 打成扁平的 `dist/cli/index.js` —— `commands/`
这一层消失了。运行时 `HERE` 是 `dist/cli/`,旧路径解析到仓库根的
`supervisor/index.js`,根本不存在。

更糟的是失败是**静默的**:子进程以 `detached: true, stdio: 'ignore'`
spawn,秒死,但 CLI 仍打印 `supervisor started (background)`。
前台模式(`--foreground`)不受影响,因为它走静态 `import()`,
tsup 在构建期就解析好了。

## What changed / 改了什么

- `resolve(HERE, '../../supervisor/index.js')` →
  `resolve(HERE, '../supervisor/index.js')`,正确指向同级的
  `dist/supervisor/index.js` bundle。
- 把路径解析提取为导出 helper `resolveSupervisorEntry(fromDir)`
  (沿用 `init.ts` 的可测 helper 模式),并加注释说明"相对构建产物
  而非源码"的语义,防止后人按源码目录"改回去"。
- 在 detached spawn 前增加显式守卫:解析出的入口不存在时打印
  `supervisor entry not found: … (build layout changed?)` 并以
  exit 1 退出,不再谎报成功。未来构建布局漂移会立刻显式失败。

## Files touched / 涉及文件

- `src/cli/commands/start.ts` —— 路径修复、`resolveSupervisorEntry`
  helper、spawn 前存在性守卫。
- `tests/cli/start.test.ts` —— 新增;锁定"上一级"解析行为,并在
  磁盘上模拟 `dist/` 布局验证。

## Verification / 验证

- 红绿对照:用旧 `../../` 路径,新测试 2/2 失败;用修复后路径 2/2
  通过。
- 构建产物检查:`dist/cli/index.js` 包含修正后的
  `resolve(HERE, "../supervisor/index.js")` 与守卫字符串;`node -e`
  确认旧路径在磁盘上不存在、新路径存在。
- `pnpm build` ✓ · `pnpm typecheck` ✓ · `pnpm test` 230/230 ✓ ·
  两个改动文件 `eslint` 干净(全仓库 lint 有 31 个存量 error,
  与 `main` 完全一致,另行跟踪)。
- 注:验证一度被 pnpm 11 的构建脚本审批卡住;由配套 commit 在
  `pnpm-workspace.yaml` 中为 esbuild/protobufjs 配置 `allowBuilds`
  解决。

## Architecture impact / 架构影响

无。进程拓扑、模块职责、IPC、磁盘状态均未变;只是修正既有
`lmcb start` 流程内的一个路径常量。

## Links / 链接

- Spec: —
- Plan: —
- Commits: 见分支 `fix/daemon-supervisor-path`
- CHANGELOG: `[Unreleased]` → Fixed
