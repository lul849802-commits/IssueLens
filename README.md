# IssueLens

IssueLens 是一个面向产品与开发团队的 AI 分析工具：读取公开 GitHub 仓库最近更新的 Issue，生成结构化、可解释且可回溯原文的产品洞察。

当前状态：第四阶段 **4G-A 质量门已通过，正在执行 4G-B 云端发布**。公开仓库输入、GitHub 导入、AI 分析、语义聚类、可恢复任务、洞察看板、证据下钻、只读分享与生产 E2E 已形成完整闭环。

## 技术基线

- Next.js 16.3.1 / React 19.2.8 / TypeScript strict
- Node.js `>=20.9 <25`
- pnpm 11.19.0（由 `packageManager` 与 lockfile 固定）
- Zod 运行时契约、Vitest 单元测试、GitHub Actions CI
- Drizzle ORM 0.45.2 / PostgreSQL / PGlite 隔离数据库测试
- Inngest SDK 4.18.1 / Dev Server CLI 1.43.0

## 本地启动

```powershell
cd D:\Codex\IssueLens\app
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm dev
```

打开 `http://localhost:3000`。展示 4B 页面壳不需要数据库凭证；运行真实数据库迁移、seed 或 smoke test 时才需要 Neon 连接串。

当前设备的 Node.js 由 Codex bundled runtime 提供，未全局加入 PATH。若在普通终端复现，建议安装 Node.js 24 LTS；在本次 Codex 环境中使用：

```powershell
$env:Path='C:\Users\MI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;'+$env:Path
pnpm dev
```

## 质量命令

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:db
pnpm db:check
pnpm build
pnpm check
```

CI 对每次 `main` push 和 Pull Request 执行安装、lint、typecheck、unit/database test、迁移一致性检查与 production build。

## 数据库工作流

Neon 中准备同一数据库的两条连接：应用使用带 `-pooler` 主机名的 pooled URL，迁移使用不带 `-pooler` 的 direct URL。只写入本机 `.env.local`：

```dotenv
DATABASE_URL=postgresql://...-pooler.../issuelens?sslmode=require
DIRECT_DATABASE_URL=postgresql://.../issuelens?sslmode=require
```

```powershell
pnpm db:check       # 检查迁移历史一致性，无需连接数据库
pnpm db:migrate     # 使用 DIRECT_DATABASE_URL，可重复执行
pnpm db:seed        # 使用 DATABASE_URL，写入明确标注的 fixture
pnpm db:smoke       # 验证 8 张表与 pooled 连接事务回滚
```

`src/db/schema.ts` 是代码侧 Schema 来源，`drizzle/` 是提交到版本控制并部署的权威迁移历史。禁止对生产库使用 `drizzle-kit push`。

## GitHub 数据接入

GitHub 接入只读取公开仓库，按 `updated desc` 同时获取 open/closed 项，过滤 Issues API 中混入的 Pull Request，并在跨页去重后截取最多 100 条。

```powershell
pnpm github:smoke microsoft/vscode 5       # 不落库的开发 smoke
pnpm github:smoke vercel/next.js 100       # 真实 100 条分页验证
pnpm github:import microsoft/vscode 5      # 幂等写入 Neon 开发库
```

`GITHUB_TOKEN` 可选：缺失时走 GitHub 未认证公开限额；配置后仅作为服务端 Bearer Token 提升限额。任何 Token 都不得进入 URL、日志、客户端 bundle 或提交记录。

## AI Structured Outputs vertical slice

4D 使用 OpenAI Responses API 对 5 条真实公开 Issue 逐条生成严格结构化分析，并把结果、版本、tokens、延迟、截断状态与安全错误码写入 Neon。默认模型为 `gpt-5-mini`，可通过服务端 `OPENAI_MODEL` 覆盖。

```powershell
pnpm ai:slice openai/openai-node
pnpm ai:verify <runId> [runId...]
```

该命令会先执行 5 条 GitHub 真实导入，再执行 AI 分析。缓存键为 `content_hash + analysis_version + model_id`；重复运行相同内容不会再次调用模型。真实 `OPENAI_API_KEY` 只能写入被 Git 忽略的 `.env.local`，不得粘贴到聊天或代码。

若当前网络需要本机 HTTP CONNECT 代理，可只在服务端 `.env.local` 增加：

```dotenv
OPENAI_PROXY_URL=http://127.0.0.1:7897
```

`ai:verify` 只读核对 Neon 中的 run、逐条状态、usage、latency、request id 与缓存关联，不会发起新的模型调用。

## Durable AI 工作流

4E 使用 `issuelens/run.requested` 事件启动 durable function。GitHub 获取、Issue 快照、逐条 AI 分析和最终聚合都位于独立 `step.run()` checkpoint 中；每条 Issue 可独立重试，已完成 step 不会在恢复时重新执行。

本地联调需要两个终端：

```powershell
# 终端 1
pnpm dev

# 终端 2
pnpm inngest:dev
```

随后请求和验证任务：

```powershell
pnpm workflow:request openai/openai-node 5
pnpm workflow:verify <runId>
pnpm workflow:reconcile 60
```

同一外部事件按 event ID 去重；显式恢复会为同一个 run 发送新的 event ID，并复用已有终态分析。数据库还会对 run item、分析写入和终态做长期幂等保护。发送事件失败时 run 会被标记为 `failed`，`workflow:reconcile` 可收敛早期中断遗留的无 event ID queued run。

## 生产部署

4G-B 使用 GitHub → Vercel 自动部署，Neon 作为事实源，Inngest Cloud 调用 `/api/inngest`。Vercel Function 固定在新加坡 `sin1`，与 Neon 开发基线同区域；Inngest handler 启用流式响应，并把单次函数上限设置为 300 秒。

生产环境至少配置：`DATABASE_URL`、`OPENAI_API_KEY`、`INNGEST_EVENT_KEY`、`INNGEST_SIGNING_KEY`。`DIRECT_DATABASE_URL` 只在受控迁移命令中使用；`GITHUB_TOKEN` 推荐配置但不是启动硬依赖。生产环境不得设置 `INNGEST_DEV=1` 或指向本机的 `OPENAI_PROXY_URL`。

```powershell
pnpm security:scan
pnpm release:check
```

部署后使用 `GET /api/health` 检查生产配置和数据库连通性。接口只返回总体检查状态，不回传变量名、连接串或 provider 错误正文。详细步骤见 `docs/operations/DEPLOYMENT.md`。

## 环境变量

只复制变量名，不把真实值提交到 Git。所有变量均为后续 Gate 预留：

| 变量 | 首次使用 Gate | 用途 |
|---|---:|---|
| `GITHUB_TOKEN` | 4C（可选） | 提升 GitHub 只读 API 限额 |
| `DATABASE_URL` / `DIRECT_DATABASE_URL` | 4B | Neon pooled 应用连接 / direct 迁移连接 |
| `OPENAI_API_KEY` | 4D | Structured Outputs 分析 |
| `OPENAI_MODEL` / `OPENAI_PROXY_URL` | 4D（可选） | 覆盖模型 / 配置服务端 OpenAI 出口代理 |
| `INNGEST_DEV` | 4E | 本地 Dev Server 模式；本地脚本自动使用 dummy event key |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | 4G | 云端事件发布与签名校验；本地 4E 不需要真实 Cloud Key |

禁止新增敏感 `NEXT_PUBLIC_*` 变量。服务端变量通过 `src/config/env.ts` 的 Zod Schema 延迟校验。

## 工程结构

```text
src/
  app/             # Next.js 路由、页面壳与仓库校验 Route Handler
  domain/          # 无框架依赖的业务规则与单元测试
  adapters/        # 外部系统端口/实现
  db/              # PostgreSQL Schema、client、repository 与测试
  queries/         # 页面只读查询
  inngest/         # 类型化事件、durable function 与生产依赖装配
  config/          # server-only 环境契约
  contracts/       # API 数据契约
docs/
  architecture/    # 依赖边界
  traceability/    # 产品 AC 到代码/测试锚点
```

数据库设计与约束说明见 `docs/architecture/DATABASE.md`；GitHub 边界见 `src/adapters/github` 与 `src/services/github`。

详细约束见 `docs/architecture/BOUNDARIES.md`。

## Git 初始化说明

仓库默认分支为 `main`。首次提交前请设置用户自己的显示名与邮箱：

```powershell
git config user.name "你的名字"
git config user.email "你的邮箱"
git add .
git commit -m "chore: establish IssueLens engineering foundation"
```

Codex 不会代替用户虚构 Git 身份，也不会在 4A 创建远程仓库或云资源。
