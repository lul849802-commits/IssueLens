import type { IssueAnalysis } from "@/domain/analysis/analysis";
import type { NormalizedIssue } from "@/domain/issues/issue";
import type { RunRecord } from "@/db/ports";

export interface IssueWithAnalysis {
  issue: NormalizedIssue;
  analysis: IssueAnalysis | null;
}

export interface InsightQueries {
  getRun(runId: string): Promise<RunRecord | null>;
  listIssues(runId: string): Promise<IssueWithAnalysis[]>;
}
