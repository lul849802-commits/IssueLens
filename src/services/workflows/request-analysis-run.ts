import type { Inngest } from "inngest";

import type { RepositoryRef } from "@/domain/repository/repository";
import { runRequested } from "@/inngest/client";
import { ANALYSIS_VERSION } from "@/services/analysis/prompt";

export interface AnalysisRunRequestStore {
  createRequestedRun(input: {
    repository: RepositoryRef;
    repositoryHtmlUrl: string;
    creatorTokenHash: string;
    limit: number;
    analysisVersion: string;
    modelId: string;
  }): Promise<{ runId: string; repositoryId: string }>;
  recordWorkflowEvent(runId: string, eventId: string): Promise<void>;
  failRun(runId: string, code: string): Promise<void>;
}

export async function requestAnalysisRun(
  store: AnalysisRunRequestStore,
  eventClient: Pick<Inngest, "send">,
  input: {
    repository: RepositoryRef;
    creatorTokenHash: string;
    limit: number;
    modelId: string;
  },
): Promise<{ runId: string; eventId: string; status: "queued" }> {
  const requested = await store.createRequestedRun({
    repository: input.repository,
    repositoryHtmlUrl: `https://github.com/${input.repository.slug}`,
    creatorTokenHash: input.creatorTokenHash,
    limit: input.limit,
    analysisVersion: ANALYSIS_VERSION,
    modelId: input.modelId,
  });
  const event = runRequested.create({
    runId: requested.runId,
    repositorySlug: input.repository.slug,
    limit: Math.min(100, Math.max(1, Math.trunc(input.limit))),
    modelId: input.modelId,
  }, { id: `issuelens-run-${requested.runId}` });
  let sent: { ids: string[] };
  try {
    sent = await eventClient.send(event);
  } catch (error) {
    await store.failRun(requested.runId, "WORKFLOW_EVENT_SEND_FAILED");
    throw error;
  }
  const eventId = sent.ids[0];
  if (!eventId) {
    await store.failRun(requested.runId, "WORKFLOW_EVENT_SEND_FAILED");
    throw new Error("WORKFLOW_EVENT_NOT_ACKNOWLEDGED");
  }
  await store.recordWorkflowEvent(requested.runId, eventId);
  return { runId: requested.runId, eventId, status: "queued" };
}
