import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GitHubImportResult } from "@/services/github/import-issues";

import { schema, issues, repositories } from "../schema";
import { DrizzleIssueImportRepository } from "./issue-import-repository";

describe("DrizzleIssueImportRepository", () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  });
  afterEach(async () => client.close());

  it("upserts repository metadata and issues without duplicates", async () => {
    const repository = new DrizzleIssueImportRepository(db);
    await repository.persist(fixture("first"));
    const second = await repository.persist(fixture("updated"));

    expect((await db.select({ value: count() }).from(repositories))[0]?.value).toBe(1);
    expect((await db.select({ value: count() }).from(issues))[0]?.value).toBe(1);
    const [stored] = await db.select().from(issues).where(eq(issues.issueNumber, 1));
    expect(stored).toMatchObject({ title: "updated", currentContentHash: "b".repeat(64) });
    expect(second).toMatchObject({ issueCount: 1, storedIssueCount: 1 });
  });
});

function fixture(title: string): GitHubImportResult {
  return {
    repository: {
      githubId: 10,
      owner: "OpenAI",
      name: "openai-node",
      slug: "openai/openai-node",
      htmlUrl: "https://github.com/openai/openai-node",
      defaultBranch: "master",
      issuesEnabled: true,
    },
    issues: [{
      githubId: 100,
      number: 1,
      title,
      body: "body",
      state: "open",
      labels: ["bug"],
      commentsCount: 1,
      authorLogin: "fixture",
      htmlUrl: "https://github.com/openai/openai-node/issues/1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      contentHash: title === "first" ? "a".repeat(64) : "b".repeat(64),
    }],
    counts: { pagesFetched: 1, rawItems: 1, pullRequestsExcluded: 0, duplicatesExcluded: 0, issuesAccepted: 1 },
    rateLimit: { limit: 60, remaining: 59, resetAt: null },
  };
}
