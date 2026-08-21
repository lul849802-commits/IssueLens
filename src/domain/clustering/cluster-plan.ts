import { z } from "zod";
import { suggestedActions } from "@/domain/analysis/analysis";

export const repositoryClusterSchema = z.strictObject({
  name: z.string().trim().min(3).max(80),
  summary: z.string().trim().min(1).max(320),
  suggestedAction: z.enum(suggestedActions),
  memberRunIssueIds: z.array(z.uuid()).min(2).max(100),
});

export const repositoryClusterPlanSchema = z.strictObject({
  clusters: z.array(repositoryClusterSchema).max(50),
  unclusteredRunIssueIds: z.array(z.uuid()).max(100),
});

export type RepositoryClusterPlan = z.infer<typeof repositoryClusterPlanSchema>;

export class ClusterPlanInvariantError extends Error {
  constructor(readonly code: "UNKNOWN_MEMBER" | "DUPLICATE_MEMBER" | "INCOMPLETE_COVERAGE") {
    super(code); this.name = "ClusterPlanInvariantError";
  }
}

export function validateClusterPlan(candidate: unknown, knownIds: readonly string[]): RepositoryClusterPlan {
  const plan = repositoryClusterPlanSchema.parse(candidate);
  const known = new Set(knownIds); const assigned = new Set<string>();
  const all = [...plan.clusters.flatMap((cluster) => cluster.memberRunIssueIds), ...plan.unclusteredRunIssueIds];
  for (const id of all) {
    if (!known.has(id)) throw new ClusterPlanInvariantError("UNKNOWN_MEMBER");
    if (assigned.has(id)) throw new ClusterPlanInvariantError("DUPLICATE_MEMBER");
    assigned.add(id);
  }
  if (assigned.size !== known.size || knownIds.some((id) => !assigned.has(id))) {
    throw new ClusterPlanInvariantError("INCOMPLETE_COVERAGE");
  }
  return plan;
}
