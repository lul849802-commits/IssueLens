# IssueLens 工程边界

## 依赖方向

`app / workflows -> queries / adapters / db -> domain`

- `src/app`：路由、页面和 Route Handler；不承载核心业务规则。
- `src/domain`：纯业务规则与稳定契约；不依赖 React、Next.js、数据库或外部 API。
- `src/adapters`：GitHub、OpenAI、Inngest 等外部系统的端口和实现。
- `src/db`：持久化端口、Drizzle schema 与 repository 实现。
- `src/queries`：面向页面的只读查询与 DTO 组合。
- `src/config`：仅服务端环境变量契约；任何密钥不得以 `NEXT_PUBLIC_` 暴露。
- `src/contracts`：跨边界但不含业务行为的 API 数据契约。

## 强制规则

1. Domain 不导入 `next/*`、React、数据库驱动或外部 SDK。
2. 密钥模块使用 `server-only`，浏览器组件不得导入 `src/config`。
3. 外部响应先在 adapter 边界归一化，再进入 domain 与数据库。
4. 页面通过 queries/use-case 读取数据，不直接拼接 SQL。
5. 核心业务断言必须有单元测试编号，并映射产品 AC。

## 已实现 Gate

- 4A：工程脚手架、领域规则、测试与 CI；
- 4B：PostgreSQL Schema、迁移、运行 repository、状态查询、开发 seed 与数据库 Gate 测试。
- 4C：GitHub 只读 REST adapter、仓库校验 API、分页归一化、provider 错误映射与 Issue 幂等落库。
- 4D：OpenAI Structured Outputs、版本化 Prompt、usage/latency 与分析缓存。
- 4E：Inngest 类型化事件、durable steps、并发/重试和 Neon 任务状态收敛。

## 后续暂不实现

完整 UX 与聚类展示属于 4F。GitHub/OpenAI adapter 不直接写数据库；workflow 只编排 service 与 repository，Neon 始终是可刷新恢复的产品事实源，Inngest 只保存执行 checkpoint 与可观测信息。

## 4E 工作流边界

- 事件生产者只创建 queued run 并发送 `issuelens/run.requested`；
- Inngest function 不把密钥、Issue 正文或 provider 原始错误写入事件 payload；
- `step.run()` 包含 GitHub 获取、数据库副作用、单条模型调用和 aggregate；
- OpenAI client 在工作流内关闭内部重试，由 Inngest 统一执行 step 级重试；
- 事件/函数 24 小时幂等之外，数据库终态与唯一约束提供长期幂等；
- 任一 Issue 最终失败只标记该项，aggregate 产生 partial；编排级异常收敛为 failed。
