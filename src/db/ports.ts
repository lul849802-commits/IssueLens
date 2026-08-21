import type { RepositoryRef } from "@/domain/repository/repository";
import type { RunStatus } from "@/domain/runs/run-state";

import type { AnalysisScope } from "./schema";

export interface CreateRunInput {
  repository: RepositoryRef;
  repositoryHtmlUrl: string;
  creatorTokenHash: string;
  scope: AnalysisScope;
  analysisVersion: string;
}

export interface RunRecord {
  id: string;
  repositoryId: string;
  repository: RepositoryRef;
  status: RunStatus;
  scope: AnalysisScope;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunRepository {
  create(input: CreateRunInput): Promise<RunRecord>;
  findById(runId: string): Promise<RunRecord | null>;
  updateStatus(runId: string, nextStatus: RunStatus): Promise<RunRecord>;
}
