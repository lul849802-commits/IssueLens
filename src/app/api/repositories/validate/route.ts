import { GitHubRestClient } from "@/adapters/github/github-client";
import { getServerEnv } from "@/config/env";
import { createValidateRepositoryHandler } from "@/services/repositories/validate-repository";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const { GITHUB_TOKEN } = getServerEnv();
  return createValidateRepositoryHandler(
    new GitHubRestClient({ token: GITHUB_TOKEN }),
  )(request);
}
