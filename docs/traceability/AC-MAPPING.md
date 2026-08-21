# 4A 验收映射

第一阶段共 58 条产品 AC，完整映射在阶段一与阶段二文档中持续维护。4A 不宣称实现用户功能，而是建立下列可追踪代码锚点。

| 产品要求 / 决策 | 4A 代码或测试锚点 | 状态 |
|---|---|---|
| D-003 / D-013：只处理公开 GitHub，只读 | `src/adapters/github/github-port.ts` | 接口已固化，实现待 4C |
| D-004 / D-005 / D-039：最多 100 条，排除 PR、去重 | `src/domain/issues/issue.ts` + test | 规则已实现 |
| D-008：洞察可回溯原始 Issue | `NormalizedIssue.githubId/number/htmlUrl/contentHash` | 基础字段已固化 |
| D-009 / D-046：可解释优先级，权重 provisional | `src/domain/priority/priority.ts` + test | 规则已实现 |
| D-010 / D-014：允许 unknown、单一主分类 | `src/domain/analysis/analysis.ts` + test | Schema 已固化 |
| D-012 / D-044：匿名创建者令牌只存强验证值 | `src/domain/creator-access/credential.ts` + test | 密码学规则已实现 |
| D-040：非法模型输出不得进入统计 | `issueAnalysisSchema` 严格 Schema + test | 校验已实现 |
| 运行状态可刷新恢复 | `src/domain/runs/run-state.ts` + test | 状态机基础已实现 |
| GAP-11：环境契约与密钥隔离 | `.env.example` + `src/config/env.ts` | 已实现 |

后续 Gate 应在同一表中追加 API、数据库、E2E 和真实运行证据，不重新编号产品 AC。

## 4B 追加锚点

| 产品要求 / 决策 | 4B 代码或测试锚点 | 状态 |
|---|---|---|
| D-008：所有聚合结论可回溯 Issue | `run_issues`、`cluster_members` 外键与复合主键 | 数据约束已实现 |
| D-011 / D-045：模型结果和人工修正分层保存 | `issue_analyses`、`analysis_corrections` | Schema 已实现 |
| D-012 / D-044：数据库只存创建者强验证值 | `analysis_runs.creator_token_hash` | 字段与 seed 安全口径已实现 |
| D-029：部分完成仍保留失败项 | `run_status.partial`、run/item 计数字段 | 状态事实源已实现 |
| D-035：修正后可刷新聚合 | corrections / clusters 关系与查询边界 | 基础数据关系已实现，重算待 4E/4F |
| D-037：PostgreSQL 为产品事实源 | `src/db/schema.ts`、`drizzle/0000_init.sql` | 本地 PostgreSQL Gate 已通过 |
| D-043：内容哈希与版本缓存 | `issue_analyses_cache_unique` | 唯一约束已实现 |

## 4C 追加锚点

| 产品要求 / 决策 | 4C 代码或测试锚点 | 状态 |
|---|---|---|
| D-003 / D-013：只处理公开 GitHub，只读 | `GitHubRestClient.getRepository`、请求头测试 | 已实现并真实验证 |
| D-004 / D-005 / D-039：最多 100、排除 PR、去重 | `importGitHubIssues`、三仓库 fixture 与 live smoke | 已实现 |
| D-008：保留原始证据 | `DrizzleIssueImportRepository` 保存原文、URL、GitHub 时间与 hash | 已实现 |
| GitHub 限流可恢复 | `GitHubApiError`、429/403 reset 映射、API handler 测试 | 已实现 |
| `/repositories/validate` | `src/app/api/repositories/validate/route.ts` | 已实现 |
| GitHub → Neon 幂等链路 | `pnpm github:import microsoft/vscode 5` 连续复跑 | PASS，数据库保持 5 条 |

## 4D 追加锚点

| 产品要求 / 决策 | 4D 代码或测试锚点 | 状态 |
|---|---|---|
| D-040：Structured Outputs 严格校验 | `OpenAIAnalysisClient` + Zod 二次校验 | 已实现并真实验证 |
| D-043：内容/版本/模型缓存 | `DrizzleAnalysisSliceRepository` + 真实二次运行 | 5 / 5 cached，零新增调用 |
| 非法输出不进入成功统计 | provider contract tests | 已实现 |

## 4E 追加锚点

| 产品要求 / 决策 | 4E 代码或测试锚点 | 状态 |
|---|---|---|
| D-038：长任务 durable 编排 | `src/inngest/functions/analyze-run.ts`、`/api/inngest` | 已实现并由本地 Dev Server 验证 |
| 重复事件不重复计费/写入 | runId event ID + function idempotency + terminal claim | 真实重复事件后 5 项 attempt 仍为 1 |
| 中途失败恢复 | 429 故障注入后同一 item attempt 1 → 2 并成功 | PGlite 集成测试通过 |
| 单条失败产生 partial | durable repository 集成测试 | 2 success + 1 failed → partial |
| 刷新恢复任务状态 | workflow event/run ID、item attempt/timestamps 持久化 | Neon live smoke 通过 |
| 发送失败不悬空 | `requestAnalysisRun` failure path + `workflow:reconcile` | 自动测试与真实对账通过 |
