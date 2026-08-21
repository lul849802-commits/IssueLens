import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

import { getDatabase } from "@/db/client";
import { analysisCorrections, clusters, issueAnalyses, runIssues } from "@/db/schema";
import { issueCategories, severities } from "@/domain/analysis/analysis";
import { creatorCookieName } from "@/domain/creator-access/cookie";
import { isRunCreator } from "@/queries/product";

const schema = z.object({
  category: z.enum(issueCategories).optional(),
  severity: z.enum(severities).optional(),
  productArea: z.string().trim().min(1).max(80).optional(),
  targetClusterId: z.uuid().optional(),
}).refine((value) => Object.values(value).some(Boolean), "至少修改一个字段");

export async function POST(request: Request, { params }: { params: Promise<{ runId: string; runIssueId: string }> }) {
  const { runId, runIssueId } = await params;
  const { db } = getDatabase();
  const token = (await cookies()).get(creatorCookieName(runId))?.value;
  if (!await isRunCreator(db, runId, token)) return Response.json({ error: { code: "FORBIDDEN", message: "该分享链接为只读模式。" } }, { status: 403 });
  try {
    const input = schema.parse(await request.json());
    const [analysis] = await db.select({ id: issueAnalyses.id }).from(issueAnalyses)
      .innerJoin(runIssues, eq(issueAnalyses.runIssueId, runIssues.id))
      .where(and(eq(runIssues.id, runIssueId), eq(runIssues.runId, runId))).limit(1);
    if (!analysis) return Response.json({ error: { code: "ISSUE_NOT_FOUND", message: "未找到该 Issue 分析。" } }, { status: 404 });
    if (input.targetClusterId) {
      const [target] = await db.select({ id: clusters.id }).from(clusters).where(and(eq(clusters.id, input.targetClusterId), eq(clusters.runId, runId))).limit(1);
      if (!target) return Response.json({ error: { code: "INVALID_CLUSTER", message: "目标问题簇不属于当前任务。" } }, { status: 400 });
    }
    const [created] = await db.insert(analysisCorrections).values({ issueAnalysisId: analysis.id, ...input }).returning();
    if (input.targetClusterId) await db.update(clusters).set({ containsManualCorrection: true }).where(eq(clusters.id, input.targetClusterId));
    return Response.json({ data: created }, { status: 201 });
  } catch {
    return Response.json({ error: { code: "INVALID_CORRECTION", message: "修正内容无效。" } }, { status: 400 });
  }
}
