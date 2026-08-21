import type { IssueAnalysis } from "@/domain/analysis/analysis";

export interface AnalysisIssueInput {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  commentsCount: number;
}

export interface AnalysisProviderResult {
  analysis: IssueAnalysis;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export interface IssueAnalyzer {
  readonly modelId: string;
  analyze(input: AnalysisIssueInput): Promise<AnalysisProviderResult>;
}
