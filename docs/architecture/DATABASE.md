# IssueLens PostgreSQL 事实源

## 连接职责

- `DATABASE_URL`：应用运行时 pooled 连接，适配 serverless 并发；
- `DIRECT_DATABASE_URL`：迁移专用 direct 连接，避免迁移 DDL 经过事务池；
- 两者只存在 `.env.local` 或部署平台 Secret，不进入 Git、日志、URL 或客户端 bundle。

## 数据分层

| 表 | 职责 |
|---|---|
| `repositories` | 规范化公开仓库身份 |
| `analysis_runs` | 可刷新恢复的任务状态与完整性计数 |
| `issues` | GitHub 原始字段当前缓存，不被 AI 覆盖 |
| `run_issues` | 一次运行使用的 Issue 快照与单项状态 |
| `issue_analyses` | 模型原始结构化结果、版本和用量元数据 |
| `analysis_corrections` | 人工修正历史，不覆盖模型原值 |
| `clusters` | 证据关联的问题簇与 provisional 优先级 |
| `cluster_members` | 簇到真实 run issue 的可追溯成员关系 |

## 约束策略

- 仓库、Issue、run item、分析缓存和簇成员都有数据库唯一约束；
- run 总量限制为 0–100，成功数与失败数不得超过总数；
- confidence、priority score 限制为 0–1；计数与耗时不得为负；
- 状态、分类、严重度和行动建议使用 PostgreSQL enum；
- 任务状态更新使用领域状态机和数据库 compare-and-set，终态不可倒退；
- `workflow_event_id` 与 `workflow_run_id` 关联 Inngest 事件/执行，不承担产品事实源职责；
- `run_issues.started_at/completed_at/attempt_count` 记录逐项恢复与重试证据；
- queued 事件发送失败、active 编排失败和终态写入均有显式错误码，不遗留静默悬空状态；
- 级联删除只用于 run 派生数据，仓库与原始 Issue 不随某次 run 删除。

## 迁移策略

`src/db/schema.ts` 驱动 `drizzle-kit generate`，生成 SQL、snapshot 和 journal 后全部提交。生产和共享环境仅运行已审查的 `pnpm db:migrate`，不使用即时 schema push。

CI 运行 `drizzle-kit check` 防止分支合并造成迁移历史冲突。PGlite 测试执行同一份 SQL 迁移，并覆盖空库、重复迁移、唯一约束、检查约束、事务回滚和刷新读取。

## Gate 范围

本地 Gate 使用 PostgreSQL WASM 内核，不模拟 SQLite。真实 Neon smoke test 需要用户提供 pooled/direct URL；未提供前不得声称云端验证已完成。
