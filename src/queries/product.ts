import { and, desc, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { IssueLensDatabase } from "@/db/database";
import { analysisCorrections, analysisRuns, clusterMembers, clusters, issueAnalyses, issues, repositories, runIssues } from "@/db/schema";
import { verifyCreatorCredential } from "@/domain/creator-access/credential";

export type EffectiveIssue = Awaited<ReturnType<typeof listRunIssues>>[number];

export async function getRunContext<T extends PgQueryResultHKT>(db: IssueLensDatabase<T>, runId: string) {
  const [row] = await db.select({ run: analysisRuns, repository: repositories })
    .from(analysisRuns).innerJoin(repositories, eq(analysisRuns.repositoryId, repositories.id))
    .where(eq(analysisRuns.id, runId)).limit(1);
  return row ?? null;
}

export async function isRunCreator<T extends PgQueryResultHKT>(db: IssueLensDatabase<T>, runId: string, token?: string) {
  if (!token) return false;
  const [row] = await db.select({ verifier: analysisRuns.creatorTokenHash }).from(analysisRuns)
    .where(eq(analysisRuns.id, runId)).limit(1);
  return row ? verifyCreatorCredential(token, row.verifier) : false;
}

export async function listRunIssues<T extends PgQueryResultHKT>(db: IssueLensDatabase<T>, runId: string) {
  const rows = await db.select({
    runIssue: runIssues, issue: issues, analysis: issueAnalyses,
  }).from(runIssues)
    .innerJoin(issues, eq(runIssues.issueId, issues.id))
    .leftJoin(issueAnalyses, eq(issueAnalyses.runIssueId, runIssues.id))
    .where(eq(runIssues.runId, runId)).orderBy(desc(issues.githubUpdatedAt));

  const analysisIds = rows.flatMap((row) => row.analysis ? [row.analysis.id] : []);
  const corrections = analysisIds.length === 0 ? [] : await db.select().from(analysisCorrections)
    .orderBy(desc(analysisCorrections.correctedAt));
  const latest = new Map<string, typeof corrections[number]>();
  for (const correction of corrections) {
    if (analysisIds.includes(correction.issueAnalysisId) && !latest.has(correction.issueAnalysisId)) latest.set(correction.issueAnalysisId, correction);
  }

  return rows.map((row) => {
    const correction = row.analysis ? latest.get(row.analysis.id) : undefined;
    return {
      runIssue: row.runIssue,
      issue: row.issue,
      analysis: row.analysis,
      correction: correction ?? null,
      effective: row.analysis ? {
        ...row.analysis,
        category: correction?.category ?? row.analysis.category,
        severity: correction?.severity ?? row.analysis.severity,
        productArea: correction?.productArea ?? row.analysis.productArea,
      } : null,
    };
  });
}

export async function listRunClusters<T extends PgQueryResultHKT>(db: IssueLensDatabase<T>, runId: string) {
  const rows = await db.select({ cluster: clusters, runIssueId: clusterMembers.runIssueId })
    .from(clusters).leftJoin(clusterMembers, eq(clusterMembers.clusterId, clusters.id))
    .where(eq(clusters.runId, runId)).orderBy(desc(clusters.priorityScore));
  const grouped = new Map<string, { cluster: typeof rows[number]["cluster"]; memberIds: string[] }>();
  for (const row of rows) {
    const current = grouped.get(row.cluster.id) ?? { cluster: row.cluster, memberIds: [] };
    if (row.runIssueId) current.memberIds.push(row.runIssueId);
    grouped.set(row.cluster.id, current);
  }
  const effectiveIssues = await listRunIssues(db, runId);
  for (const issue of effectiveIssues) {
    const targetId = issue.correction?.targetClusterId;
    if (!targetId || !grouped.has(targetId)) continue;
    for (const group of grouped.values()) {
      group.memberIds = group.memberIds.filter((id) => id !== issue.runIssue.id);
    }
    grouped.get(targetId)!.memberIds.push(issue.runIssue.id);
  }
  return [...grouped.values()];
}

export async function getIssueDetail<T extends PgQueryResultHKT>(db: IssueLensDatabase<T>, runId: string, runIssueId: string) {
  const issuesForRun = await listRunIssues(db, runId);
  return issuesForRun.find((item) => item.runIssue.id === runIssueId) ?? null;
}

export async function getClusterDetail<T extends PgQueryResultHKT>(db: IssueLensDatabase<T>, runId: string, clusterId: string) {
  const [cluster] = await db.select().from(clusters).where(and(eq(clusters.id, clusterId), eq(clusters.runId, runId))).limit(1);
  if (!cluster) return null;
  const memberships = await db.select({ runIssueId: clusterMembers.runIssueId }).from(clusterMembers).where(eq(clusterMembers.clusterId, clusterId));
  const allIssues = await listRunIssues(db, runId);
  const memberSet = new Set(memberships.map((item) => item.runIssueId));
  return { cluster, issues: allIssues.filter((item) => memberSet.has(item.runIssue.id)) };
}
