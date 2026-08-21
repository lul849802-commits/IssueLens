import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/config/env";
import { getDatabase } from "@/db/client";
import { DrizzleDurableAnalysisRepository } from "@/db/repositories/durable-analysis-repository";
import { creatorCookieName, creatorCookieOptions } from "@/domain/creator-access/cookie";
import { makeCreatorCredential } from "@/domain/creator-access/credential";
import { parseRepository } from "@/domain/repository/repository";
import { inngest } from "@/inngest/client";
import { requestAnalysisRun } from "@/services/workflows/request-analysis-run";

export const runtime = "nodejs";
const inputSchema = z.strictObject({ repository: z.string().trim().min(3).max(300), limit: z.number().int().min(1).max(100).default(100) });

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const repository = parseRepository(input.repository);
    const credential = makeCreatorCredential();
    const env = getServerEnv();
    const { db } = getDatabase();
    const result = await requestAnalysisRun(new DrizzleDurableAnalysisRepository(db), inngest, {
      repository,
      creatorTokenHash: credential.storedVerifier,
      limit: input.limit,
      modelId: env.OPENAI_MODEL || "gpt-5-mini",
    });
    const response = NextResponse.json({ data: result, links: { progress: `/analysis/${result.runId}/progress` } }, { status: 202 });
    response.cookies.set(creatorCookieName(result.runId), credential.token, creatorCookieOptions(result.runId));
    return response;
  } catch (error) {
    const message = error instanceof Error && error.message === "INVALID_REPOSITORY" ? "请输入公开 GitHub 仓库地址或 owner/repo。" : "暂时无法创建分析任务，请稍后重试。";
    return NextResponse.json({ error: { code: "RUN_CREATE_FAILED", message, retryable: true } }, { status: 400 });
  }
}
