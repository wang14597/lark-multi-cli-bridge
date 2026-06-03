# Change Index

Reverse-chronological index of every tracked change (newest first). One
row per change doc. See [`CLAUDE.md`](../../CLAUDE.md) for the convention.

中文版: [INDEX.zh.md](INDEX.zh.md)

| Date | Type | Change | Summary |
|------|------|--------|---------|
| 2026-06-03 | fix | [fix-daemon-supervisor-path](2026-06-03-fix-daemon-supervisor-path.md) | Background `lmcb start` spawned the supervisor from a path computed against the source layout; in the tsup-flattened `dist/` it pointed outside the build and died silently. Fix path, add pre-spawn existence guard + regression tests. |
| 2026-06-02 | docs | [introduce-change-tracking](2026-06-02-introduce-change-tracking.md) | Establish the per-change documentation convention + `CLAUDE.md`; refresh `architecture.md` version marker to v0.7.1. |
