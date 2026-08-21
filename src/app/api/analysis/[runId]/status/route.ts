import { getDatabase } from "@/db/client";
import { getRunStatus } from "@/queries/run-status";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { db } = getDatabase();
  const status = await getRunStatus(db, runId);
  return status ? Response.json({ data: status }) : Response.json({ error: { code: "RUN_NOT_FOUND", message: "未找到该分析任务。" } }, { status: 404 });
}
