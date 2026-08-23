import "server-only";

import { OpenAIAnalysisClient } from "@/adapters/ai/openai-analysis-client";
import { OpenAIClusterClient } from "@/adapters/ai/openai-cluster-client";
import { configureOpenAIProxy } from "@/adapters/ai/openai-proxy";
import { GitHubRestClient } from "@/adapters/github/github-client";
import { getServerEnv } from "@/config/env";
import { getDatabase } from "@/db/client";
import { DrizzleDurableAnalysisRepository } from "@/db/repositories/durable-analysis-repository";
import { DrizzleIssueImportRepository } from "@/db/repositories/issue-import-repository";
import { parseRepository } from "@/domain/repository/repository";
import { importGitHubIssues } from "@/services/github/import-issues";

export function createAnalyzeRunDependencies() {
  const env = getServerEnv();
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_REQUIRED");
  const { db } = getDatabase();
  const store = new DrizzleDurableAnalysisRepository(db);
  const github = new GitHubRestClient({ token: env.GITHUB_TOKEN });
  const importer = new DrizzleIssueImportRepository(db);
  configureOpenAIProxy(env.OPENAI_PROXY_URL);

  return {
    store,
    analyzer: new OpenAIAnalysisClient({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || "gpt-5-mini",
      maxAttempts: 1,
    }),
    clusterer: new OpenAIClusterClient({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || "gpt-5-mini",
      maxAttempts: 1,
      timeoutMs: 60_000,
    }),
    fetchAndPersist: async (repositorySlug: string, limit: number) => {
      const imported = await importGitHubIssues(
        github,
        parseRepository(repositorySlug),
        { limit },
      );
      const persisted = await importer.persist(imported);
      return {
        repositoryId: persisted.repositoryId,
        issuesAccepted: imported.counts.issuesAccepted,
        pagesFetched: imported.counts.pagesFetched,
      };
    },
  };
}

export type AnalyzeRunDependencies = ReturnType<typeof createAnalyzeRunDependencies>;
