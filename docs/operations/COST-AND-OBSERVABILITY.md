# 成本与可观测性记录

## OpenAI 成本

模型：`gpt-5-mini`

官方标准文本单价：输入 `$0.25 / 1M tokens`，缓存输入 `$0.025 / 1M tokens`，输出 `$2.00 / 1M tokens`。
来源：https://developers.openai.com/api/docs/models/gpt-5-mini

| 项目 | Token | 费用（USD） |
| --- | ---: | ---: |
| 新分析输入 | 105,267 | 0.026317 |
| 新分析输出 | 73,739 | 0.147478 |
| 已知逐项分析合计 | 179,006 | 0.173795 |

已知逐项分析平均成本：约 `$0.001829 / 新分析 Issue`；按本次 100 条请求摊销约 `$0.001738 / Issue`。

### 成本边界

`$0.173795` 是应用数据库可以严格复核的逐项分析成本，不是整次运行的最终账单。仓库级聚类调用失败并触发回退，但当前 Schema 没有持久化聚类请求的 input/output token，也无法记录超时请求是否已被供应商计费。因此整次运行实际 OpenAI 成本为“至少 `$0.173795`”。最终金额应以 OpenAI Usage/Billing 控制台为准。

Vercel、Neon 与 Inngest 的本次增量账单无法从应用侧读取；本报告不把套餐免费额度假设为实际成本。

## 运行监控

- 生产首页：HTTP 200
- `/api/health`：HTTP 200
- 配置检查：`ok`
- 数据库检查：`ok`
- 任务窗口 Vercel 5xx：0
- Inngest `/api/inngest`：持续收到签名 POST 回调
- OpenAI provider request ID 覆盖：100 条分析记录

## 监控缺口

1. 聚类 token、请求 ID、延迟和错误码未持久化。
2. run 级成功/失败计数只在最终 aggregate 阶段刷新。
3. PostgreSQL 客户端提示未来版本中 `sslmode=require` 语义会变化；升级 `pg` 前应明确改用 `sslmode=verify-full` 或评审兼容模式。
4. 部署平台与工作流平台的账单/额度未接入统一监控。
