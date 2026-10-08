---
date: 2026-10-08
type: chore
slug: dev-reload-scripts
---

# 用 `pnpm reload` / `pnpm reload:all` 跑「改代码 → 构建 → 重启」循环

**类型:** chore

## Motivation / 动机

想让一次代码改动生效，得记住并敲两条命令：

```bash
pnpm build
node ./bin/lmcb.mjs restart <bot>
```

除了手敲麻烦，还有两个问题。`pnpm build` 跑的 `tsup` 带 `dts: true`，而生成
`.d.ts` 占了构建的绝大部分——在本仓库实测**带 dts 3.1s，不带 0.3s**，10 倍差距，
每次迭代都要付，而这些声明文件只对 import 本包的人有意义。另外两条命令分开跑，
构建失败并不会拦住重启，很容易对着过期的 `dist/` 调试。

## What changed / 改了什么

`package.json` 里加两个脚本：

```json
"reload": "tsup --no-dts && node ./bin/lmcb.mjs restart",
"reload:all": "tsup --no-dts && (node ./bin/lmcb.mjs stop || true) && node ./bin/lmcb.mjs start",
```

`pnpm reload <bot>` —— 重新构建，然后重启一个 worker。bot 名没有写死在脚本里：
pnpm 会把 run 的参数追加到命令串的**末尾**，正好落在 `restart` 后面。所以
`pnpm reload codex-bot` 展开成
`tsup --no-dts && node ./bin/lmcb.mjs restart codex-bot`，以后新增 bot 也照样能用。
不传参数会得到 commander 的用法报错，而不是静默空跑。

`pnpm reload:all` —— 重新构建，然后停掉再启动 supervisor。当改动落在
supervisor / CLI / IPC 代码上时需要用它：那部分代码活在 supervisor 进程里，
`restart` 只重新 fork worker，碰不到它。IPC 协议上没有 `restart --all`
（`Methods` 只有接单个 bot 的 `restart-worker`），所以整体停启是最直接的办法。

其中 `stop` 一步包在 `(… || true)` 里，好让这个脚本同时能当冷启动用。
`stopCommand` 在联系不上 supervisor 时会 `process.exit(1)`（没有 `ipc.sock`，
connect 得到 `ENOENT`），若用裸 `&&` 就会在跑到 `start` 之前中断整条链——而那
恰恰是最需要它跑起来的场景。吞掉这个退出码是安全的，因为 `startCommand` 守住了
另一侧：socket 存在且 `ping` 得通时它会报 `supervisor already running` 并拒绝启动，
不会起出第二个（socket 是残留的则放行）。

除此之外两个脚本都用 `&&` 串联，构建失败就不会执行重启，不会留下一个对着过期
`dist/` 跑的 worker。

这里用 `--no-dts` 是安全的：类型**检查**是 `pnpm typecheck`（`tsc --noEmit`）的
活，和声明文件生成是两回事。`pnpm build` 未改动，发布时照常产出声明文件。

为什么重启就够：`WorkerManager.spawn` 用的是 `fork()`
（`src/supervisor/worker-manager.ts:102`），每次重启都是全新 Node 进程，会加载
当前的 `dist/`。worker 侧的改动不需要重启 supervisor，兄弟 bot 也不受影响。

## Files touched / 涉及文件

- `package.json` —— 新增 `reload` 与 `reload:all` 脚本。

## Verification / 验证

- `pnpm reload` 的参数透传在一个临时包里验证过：对
  `"demo": "echo FIRST && echo RESTART"` 跑 `pnpm run demo codex-bot`，输出
  `RESTART codex-bot`，确认 pnpm 追加到 `&&` 链的末尾而非第一条命令。
- 构建耗时用 `time npx tsup`（3.1s）对比 `time npx tsup --no-dts`（0.3s）实测。
- `pnpm typecheck` / `pnpm test`（320）/ `pnpm lint` —— 通过，无变化；本次不动源码。

## Architecture impact / 架构影响

`None.` —— 纯工具链改动，未触及模块、拓扑、IPC 或磁盘状态。

## Links / 链接

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` 条目
