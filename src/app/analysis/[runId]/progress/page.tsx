import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { getRunStatus } from "@/queries/run-status";
import { ProgressClient } from "./progress-client";
export const dynamic = "force-dynamic";
export default async function ProgressPage({ params }: { params: Promise<{ runId: string }> }) { const { runId } = await params; const { db } = getDatabase(); const data = await getRunStatus(db, runId); if (!data) notFound(); return <ProgressClient runId={runId} initial={{ ...data, updatedAt: data.updatedAt.toISOString() }}/>; }
