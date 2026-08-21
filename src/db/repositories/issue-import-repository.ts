import { count, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { GitHubImportResult } from "@/services/github/import-issues";

import type { IssueLensDatabase } from "../database";
import { issues, repositories } from "../schema";

export class DrizzleIssueImportRepository<TQueryResult extends PgQueryResultHKT> {
  constructor(private readonly db: IssueLensDatabase<TQueryResult>) {}

  async persist(result: GitHubImportResult): Promise<{
    repositoryId: string;
    issueCount: number;
    storedIssueCount: number;
  }> {
    return this.db.transaction(async (tx) => {
      const [repository] = await tx
        .insert(repositories)
        .values({
          owner: result.repository.owner.toLowerCase(),
          name: result.repository.name.toLowerCase(),
          githubRepositoryId: result.repository.githubId,
          htmlUrl: result.repository.htmlUrl,
          defaultBranch: result.repository.defaultBranch,
        })
        .onConflictDoUpdate({
          target: [repositories.owner, repositories.name],
          set: {
            githubRepositoryId: result.repository.githubId,
            htmlUrl: result.repository.htmlUrl,
            defaultBranch: result.repository.defaultBranch,
            updatedAt: new Date(),
          },
        })
        .returning({ id: repositories.id });
      if (!repository) throw new Error("REPOSITORY_WRITE_FAILED");

      for (const issue of result.issues) {
        const values = {
          repositoryId: repository.id,
          githubIssueId: issue.githubId,
          issueNumber: issue.number,
          title: issue.title,
          body: issue.body,
          state: issue.state as "open" | "closed",
          labels: issue.labels,
          commentsCount: issue.commentsCount,
          authorLogin: issue.authorLogin,
          htmlUrl: issue.htmlUrl,
          githubCreatedAt: new Date(issue.createdAt),
          githubUpdatedAt: new Date(issue.updatedAt),
          currentContentHash: issue.contentHash,
          importedAt: new Date(),
        };
        await tx
          .insert(issues)
          .values(values)
          .onConflictDoUpdate({
            target: [issues.repositoryId, issues.githubIssueId],
            set: values,
          });
      }
      const [stored] = await tx
        .select({ value: count() })
        .from(issues)
        .where(eq(issues.repositoryId, repository.id));
      return {
        repositoryId: repository.id,
        issueCount: result.issues.length,
        storedIssueCount: stored?.value ?? 0,
      };
    });
  }
}
