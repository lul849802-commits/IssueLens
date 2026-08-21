# IssueLens 生产部署手册

## 拓扑

```text
GitHub main
  -> Vercel Next.js（sin1）
      -> Neon pooled DATABASE_URL
      -> GitHub REST（只读）
      -> OpenAI Responses API
      -> Inngest Cloud event API
  <- Inngest Cloud 调用 /api/inngest
```

## 1. 发布前

```powershell
pnpm install --frozen-lockfile
pnpm release:check
```

确认 `.env.local` 被 Git 忽略，`pnpm security:scan` 通过。生产迁移使用本机或受控 CI 中的 `DIRECT_DATABASE_URL` 执行 `pnpm db:migrate`，不要在应用启动时自动迁移，也不要使用 `drizzle-kit push`。

## 2. GitHub

1. 建立公开仓库 `IssueLens`，默认分支 `main`。
2. 推送经过检查的首次提交。
3. 确认 GitHub Actions `quality` 完成 lint、typecheck、unit/database test、migration check、build、Playwright 和 secret scan。

## 3. Vercel

1. 从 GitHub 导入仓库，Framework Preset 选择 Next.js，Root Directory 为仓库根目录。
2. Node.js 使用 24.x；Install Command 保持 `pnpm install --frozen-lockfile`，Build Command 使用 `pnpm build`。
3. `vercel.json` 将 Functions 放在新加坡 `sin1`，靠近 Neon。
4. 先创建 Preview，验证后再让 `main` 产生 Production。

环境变量矩阵：

| 变量 | Preview | Production | 说明 |
|---|---:|---:|---|
| `DATABASE_URL` | 必需 | 必需 | Neon pooled URL |
| `OPENAI_API_KEY` | 必需 | 必需 | 只用于服务端 AI 调用 |
| `OPENAI_MODEL` | 推荐 | 推荐 | 默认 `gpt-5-mini` |
| `GITHUB_TOKEN` | 推荐 | 推荐 | 只读公开 API 限额 |
| `INNGEST_EVENT_KEY` | 必需 | 必需 | 应用发送事件 |
| `INNGEST_SIGNING_KEY` | 必需 | 必需 | 验证 Inngest 调用 |

不要在 Vercel 设置 `DIRECT_DATABASE_URL`，除非确实在受控部署任务中执行迁移。不要设置 `INNGEST_DEV=1`；本机代理地址也不得作为 `OPENAI_PROXY_URL` 上云。

## 4. Inngest Cloud

推荐安装官方 Vercel integration，使其自动注入 event/signing key 并在部署时同步函数。也可手工创建 keys、写入 Vercel 后，在 Inngest 控制台同步：

```text
https://<deployment-host>/api/inngest
```

应用 ID 固定为 `issuelens`，不得随部署修改，否则 Inngest 会将其识别为新应用。

## 5. Smoke 顺序

1. `GET /api/health` 返回 HTTP 200、`status=ok`。
2. 首页可打开，公开 GitHub 仓库可校验。
3. 创建 5 条 Issue 的分析任务，观察 queued → fetching → analyzing → clustering → aggregating → complete。
4. 洞察页、簇详情、Issue 证据和只读分享可访问。
5. 再执行 100 条样本；记录成功率、总耗时、模型 token、聚类结果和估算成本。
6. 检查 Vercel error logs、Inngest failed runs 和 Neon 连接数。

## 6. 回滚与密钥轮换

- 代码故障：在 Vercel 将上一个健康 deployment 提升为 Production。
- 数据迁移：只允许向前兼容迁移；破坏性回滚需独立审批与备份。
- OpenAI/GitHub key：先新建、更新 Vercel、重新部署验证，再撤销旧 key。
- Inngest signing key：按双 key 轮换流程更新 Vercel、重新部署并重新同步，最后删除旧 key。

