import type { ClusterEvidenceItem } from "@/adapters/ai/cluster-port";
export const CLUSTER_PROMPT_VERSION="cluster-2026-08-21.3";
export const REPOSITORY_CLUSTER_INSTRUCTIONS=`你是产品洞察分析器。请只根据输入的单条 Issue 结构化证据，在同一仓库内识别真正共享用户问题、根因或需求的主题。\n硬规则：\n1. 每个 runIssueId 必须且只能出现一次：属于某个 cluster，或属于 unclusteredRunIssueIds。\n2. 不得创造、修改或省略 ID。\n3. 每个 cluster 至少包含 2 条 Issue；证据不足时必须保持未聚类，禁止为了覆盖率强行合并。\n4. 相同技术栈、类别、标签或 productArea 本身不是聚类依据。成员必须共享同一个具体的用户可见问题、根因或被请求的能力。\n5. 簇内必须全员相关，而不是靠 A≈B、B≈C 的链式关系把 A 和 C 拼在一起。若无法用一句具体陈述准确覆盖每个成员，就将不满足的成员放入 unclusteredRunIssueIds。\n6. 宁可产生更多未聚类项，也不要生成宽泛的“类型与兼容性”“稳定性”“体验问题”等伞形簇。\n7. 名称描述共同产品问题，不复述仓库名；摘要逐一说明成员共享的具体证据，不得声称输入中不存在的事实。\n8. suggestedAction 只能从给定枚举选择。`;
export const CLUSTER_OUTPUT_INSTRUCTIONS="name 和 summary 必须使用简体中文。summary 使用 2–3 个简洁完整句，必须在 320 字符内自然结束，不得截断句子。";
export function serializeClusterEvidence(items: readonly ClusterEvidenceItem[]): string { return JSON.stringify({ promptVersion:CLUSTER_PROMPT_VERSION, issues:items }); }
