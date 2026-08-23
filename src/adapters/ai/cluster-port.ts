import type { IssueAnalysis } from "@/domain/analysis/analysis";
import type { RepositoryClusterPlan } from "@/domain/clustering/cluster-plan";

export interface ClusterEvidenceItem {
  runIssueId: string; issueNumber: number; title: string; commentsCount: number; updatedAt: string;
  analysis: Pick<IssueAnalysis,"category"|"summary"|"productArea"|"userScenario"|"severity"|"suggestedAction">;
}
export interface ClusterProviderResult { plan: RepositoryClusterPlan; providerRequestId: string|null; inputTokens: number|null; outputTokens: number|null; latencyMs: number; modelId: string; }
export interface RepositoryClusterer { readonly modelId: string; cluster(items: readonly ClusterEvidenceItem[]): Promise<ClusterProviderResult>; }

export interface ClusterCallRecord {
  operationKey: string;
  itemCount: number;
  modelId: string;
  status: "succeeded" | "failed";
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  errorCode: string | null;
}
