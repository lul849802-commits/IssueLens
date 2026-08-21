import { randomUUID } from "node:crypto";
import { z } from "zod";

import { GitHubApiError } from "@/adapters/github/github-client";
import type { GitHubReader } from "@/adapters/github/github-port";
import type { ApiErrorCode, ApiErrorPayload, ApiSuccessPayload } from "@/contracts/api";
import { InvalidRepositoryError, parseRepository } from "@/domain/repository/repository";

const requestSchema = z.strictObject({ repository: z.string().trim().min(3).max(300) });

export function createValidateRepositoryHandler(reader: GitHubReader) {
  return async function handle(request: Request): Promise<Response> {
    const requestId = randomUUID();
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return errorResponse("INVALID_REQUEST", "请求必须使用 JSON。", false, requestId, 415);
    }
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 8_192) {
      return errorResponse("INVALID_REQUEST", "请求内容过大。", false, requestId, 413);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("INVALID_REQUEST", "JSON 格式无效。", false, requestId, 400);
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("INVALID_REPOSITORY", "请输入公开 GitHub 仓库地址或 owner/repo。", false, requestId, 400);
    }

    try {
      const repositoryRef = parseRepository(parsed.data.repository);
      const repository = await reader.getRepository(repositoryRef);
      const payload: ApiSuccessPayload<{ repository: typeof repository }> = {
        data: { repository },
      };
      return Response.json(payload, { status: 200, headers: { "x-request-id": requestId } });
    } catch (error) {
      if (error instanceof InvalidRepositoryError) {
        return errorResponse("INVALID_REPOSITORY", "请输入公开 GitHub 仓库地址或 owner/repo。", false, requestId, 400);
      }
      if (error instanceof GitHubApiError) {
        if (error.code === "REPOSITORY_NOT_FOUND") {
          return errorResponse("REPOSITORY_NOT_FOUND", "仓库不存在或无法公开访问。", false, requestId, 404);
        }
        if (error.code === "GITHUB_RATE_LIMITED") {
          return errorResponse("GITHUB_RATE_LIMITED", "GitHub 暂时限流，请稍后重试。", true, requestId, 429);
        }
        return errorResponse("GITHUB_UNAVAILABLE", "GitHub 暂时不可用，请稍后重试。", true, requestId, 502);
      }
      return errorResponse("INTERNAL_ERROR", "服务暂时不可用。", true, requestId, 500);
    }
  };
}

function errorResponse(
  code: ApiErrorCode,
  message: string,
  retryable: boolean,
  requestId: string,
  status: number,
): Response {
  const payload: ApiErrorPayload = { error: { code, message, retryable, requestId } };
  return Response.json(payload, { status, headers: { "x-request-id": requestId } });
}
