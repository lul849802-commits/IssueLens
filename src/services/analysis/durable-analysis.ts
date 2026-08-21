import type {
  AnalysisProviderResult,
  IssueAnalyzer,
} from "@/adapters/ai/analysis-port";
import {
  AnalysisProviderError,
  type AnalysisProviderErrorCode,
} from "@/adapters/ai/openai-analysis-client";

import type {
  AnalysisWorkItem,
  CachedAnalysis,
  VerticalSliceCounts,
} from "./analyze-vertical-slice";
import {
  ANALYSIS_VERSION,
  PROMPT_VERSION,
  prepareAnalysisInput,
} from "./prompt";

export type DurableItemOutcome =
  | { status: "succeeded"; runIssueId: string }
  | { status: "skipped_cached"; runIssueId: string }
  | { status: "already_terminal"; runIssueId: string };

export type ClaimResult =
  | { kind: "claimed"; item: AnalysisWorkItem }
  | { kind: "terminal"; status: "succeeded" | "failed" | "skipped_cached" };

export interface DurableAnalysisStore {
  markWorkflowStarted(runId: string, workflowRunId: string): Promise<void>;
  prepareAnalysis(input: {
    runId: string;
    limit: number;
    modelId: string;
  }): Promise<AnalysisWorkItem[]>;
  claim(runIssueId: string): Promise<ClaimResult>;
  findCached(
    item: AnalysisWorkItem,
    analysisVersion: string,
    modelId: string,
  ): Promise<CachedAnalysis | null>;
  recordSuccess(input: {
    item: AnalysisWorkItem;
    result: AnalysisProviderResult;
    analysisVersion: string;
    promptVersion: string;
    modelId: string;
    inputTruncated: boolean;
  }): Promise<void>;
  recordCached(input: {
    item: AnalysisWorkItem;
    cached: CachedAnalysis;
    analysisVersion: string;
    promptVersion: string;
    modelId: string;
    inputTruncated: boolean;
  }): Promise<void>;
  recordFailure(runIssueId: string, code: string): Promise<void>;
  aggregate(runId: string): Promise<VerticalSliceCounts>;
  failRun(runId: string, code: string): Promise<void>;
}

export class DurableAnalysisError extends Error {
  constructor(
    readonly code: AnalysisProviderErrorCode | "ANALYSIS_PROVIDER_ERROR",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "DurableAnalysisError";
  }
}

export async function analyzeDurableIssue(
  store: DurableAnalysisStore,
  analyzer: IssueAnalyzer,
  runIssueId: string,
): Promise<DurableItemOutcome> {
  const claim = await store.claim(runIssueId);
  if (claim.kind === "terminal") {
    return { status: "already_terminal", runIssueId };
  }

  const prepared = prepareAnalysisInput(claim.item.issue);
  const cached = await store.findCached(
    claim.item,
    ANALYSIS_VERSION,
    analyzer.modelId,
  );
  if (cached) {
    await store.recordCached({
      item: claim.item,
      cached,
      analysisVersion: ANALYSIS_VERSION,
      promptVersion: PROMPT_VERSION,
      modelId: analyzer.modelId,
      inputTruncated: prepared.inputTruncated,
    });
    return { status: "skipped_cached", runIssueId };
  }

  try {
    const result = await analyzer.analyze(prepared.issue);
    await store.recordSuccess({
      item: claim.item,
      result,
      analysisVersion: ANALYSIS_VERSION,
      promptVersion: PROMPT_VERSION,
      modelId: analyzer.modelId,
      inputTruncated: prepared.inputTruncated,
    });
    return { status: "succeeded", runIssueId };
  } catch (error) {
    if (error instanceof AnalysisProviderError) {
      throw new DurableAnalysisError(error.code, error.retryable);
    }
    throw new DurableAnalysisError("ANALYSIS_PROVIDER_ERROR", true);
  }
}

export function durableErrorCode(error: unknown): string {
  if (error instanceof DurableAnalysisError) return error.code;
  if (error instanceof Error && /^ANALYSIS_[A-Z_]+$/.test(error.message)) {
    return error.message;
  }
  return "ANALYSIS_PROVIDER_ERROR";
}
