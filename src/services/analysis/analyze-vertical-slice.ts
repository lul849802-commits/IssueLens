import type {
  AnalysisIssueInput,
  AnalysisProviderResult,
  IssueAnalyzer,
} from "@/adapters/ai/analysis-port";
import { AnalysisProviderError } from "@/adapters/ai/openai-analysis-client";
import type { IssueAnalysis } from "@/domain/analysis/analysis";

import {
  ANALYSIS_VERSION,
  PROMPT_VERSION,
  prepareAnalysisInput,
} from "./prompt";

export interface AnalysisWorkItem {
  runIssueId: string;
  contentHash: string;
  issue: AnalysisIssueInput;
}

export interface CachedAnalysis {
  analysis: IssueAnalysis;
  providerRequestId: string | null;
}

export interface VerticalSliceStore {
  createRun(input: {
    repositoryId: string;
    limit: number;
    analysisVersion: string;
    modelId: string;
  }): Promise<{ runId: string; items: AnalysisWorkItem[] }>;
  findCached(item: AnalysisWorkItem, analysisVersion: string, modelId: string): Promise<CachedAnalysis | null>;
  markProcessing(runIssueId: string): Promise<void>;
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
  finalize(runId: string): Promise<VerticalSliceCounts>;
}

export interface VerticalSliceCounts {
  total: number;
  succeeded: number;
  cached: number;
  failed: number;
  status: "complete" | "partial" | "failed";
}

export interface VerticalSliceResult extends VerticalSliceCounts {
  runId: string;
  modelId: string;
  analysisVersion: string;
}

export async function analyzeVerticalSlice(
  store: VerticalSliceStore,
  analyzer: IssueAnalyzer,
  input: { repositoryId: string; limit?: number },
): Promise<VerticalSliceResult> {
  const limit = Math.min(5, Math.max(1, Math.trunc(input.limit ?? 5)));
  const run = await store.createRun({
    repositoryId: input.repositoryId,
    limit,
    analysisVersion: ANALYSIS_VERSION,
    modelId: analyzer.modelId,
  });

  for (const item of run.items) {
    const prepared = prepareAnalysisInput(item.issue);
    try {
      const cached = await store.findCached(item, ANALYSIS_VERSION, analyzer.modelId);
      if (cached) {
        await store.recordCached({
          item,
          cached,
          analysisVersion: ANALYSIS_VERSION,
          promptVersion: PROMPT_VERSION,
          modelId: analyzer.modelId,
          inputTruncated: prepared.inputTruncated,
        });
        continue;
      }

      await store.markProcessing(item.runIssueId);
      const result = await analyzer.analyze(prepared.issue);
      await store.recordSuccess({
        item,
        result,
        analysisVersion: ANALYSIS_VERSION,
        promptVersion: PROMPT_VERSION,
        modelId: analyzer.modelId,
        inputTruncated: prepared.inputTruncated,
      });
    } catch (error) {
      const code = error instanceof AnalysisProviderError
        ? error.code
        : "ANALYSIS_PROVIDER_ERROR";
      await store.recordFailure(item.runIssueId, code);
    }
  }

  const counts = await store.finalize(run.runId);
  return {
    runId: run.runId,
    modelId: analyzer.modelId,
    analysisVersion: ANALYSIS_VERSION,
    ...counts,
  };
}
