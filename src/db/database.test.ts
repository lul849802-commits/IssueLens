import { PGlite } from "@electric-sql/pglite";
import { count } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DrizzleRunRepository } from "./repositories/run-repository";
import {
  analysisRuns,
  issueAnalyses,
  issues,
  repositories,
  runIssues,
  schema,
} from "./schema";
import { getRunStatus } from "../queries/run-status";

const migrationsFolder = path.resolve(process.cwd(), "drizzle");
const hash = "a".repeat(64);

describe("IssueLens PostgreSQL fact source", () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterEach(async () => {
    await client.close();
  });

  it("applies the migration to an empty database and is idempotent", async () => {
    await migrate(db, { migrationsFolder });

    const result = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "analysis_corrections",
      "analysis_runs",
      "cluster_members",
      "clusters",
      "issue_analyses",
      "issues",
      "repositories",
      "run_issues",
    ]);
  });

  it("rolls back every write when a transaction fails", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(repositories).values(repositoryFixture());
        throw new Error("fault injection");
      }),
    ).rejects.toThrow("fault injection");

    const [result] = await db.select({ value: count() }).from(repositories);
    expect(result?.value).toBe(0);
  });

  it("enforces repository, issue, run-item and analysis uniqueness", async () => {
    const fixture = await insertCoreFixture(db);

    await expect(db.insert(repositories).values(repositoryFixture())).rejects.toThrow();
    await expect(
      db.insert(issues).values({ ...issueFixture(fixture.repositoryId), id: undefined }),
    ).rejects.toThrow();
    await expect(
      db.insert(runIssues).values({
        runId: fixture.runId,
        issueId: fixture.issueId,
        contentHash: hash,
      }),
    ).rejects.toThrow();

    const analysis = analysisFixture(fixture.runIssueId);
    await db.insert(issueAnalyses).values(analysis);
    await expect(
      db.insert(issueAnalyses).values({ ...analysis, id: undefined }),
    ).rejects.toThrow();

    const constraints = await client.query<{ conname: string }>(
      "select conname from pg_constraint where conname = any($1)",
      [[
        "repositories_owner_name_unique",
        "issues_repository_github_id_unique",
        "run_issues_run_issue_unique",
        "issue_analyses_cache_unique",
      ]],
    );
    expect(constraints.rows.map((row) => row.conname).sort()).toEqual([
      "issue_analyses_cache_unique",
      "issues_repository_github_id_unique",
      "repositories_owner_name_unique",
      "run_issues_run_issue_unique",
    ]);
  });

  it("rejects invalid counters and model confidence", async () => {
    const [repository] = await db.insert(repositories).values(repositoryFixture()).returning();
    expect(repository).toBeDefined();

    await expect(
      db.insert(analysisRuns).values({
        repositoryId: repository!.id,
        creatorTokenHash: "scrypt:fixture",
        scope: scopeFixture,
        totalCount: 101,
        analysisVersion: "test-v1",
      }),
    ).rejects.toThrow();

    const fixture = await insertCoreFixture(db, repository!.id);
    await expect(
      db.insert(issueAnalyses).values({
        ...analysisFixture(fixture.runIssueId),
        confidence: 1.001,
      }),
    ).rejects.toThrow();

    const constraints = await client.query<{ conname: string }>(
      "select conname from pg_constraint where conname = any($1)",
      [["analysis_runs_total_count_check", "issue_analyses_confidence_check"]],
    );
    expect(constraints.rows.map((row) => row.conname).sort()).toEqual([
      "analysis_runs_total_count_check",
      "issue_analyses_confidence_check",
    ]);
  });

  it("persists run status for a fresh query layer after a page refresh", async () => {
    const repository = new DrizzleRunRepository(db);
    const created = await repository.create({
      repository: { owner: "Vercel", repo: "next.js", slug: "vercel/next.js" },
      repositoryHtmlUrl: "https://github.com/vercel/next.js",
      creatorTokenHash: "scrypt:fixture",
      scope: scopeFixture,
      analysisVersion: "test-v1",
    });

    expect(created.status).toBe("queued");
    await repository.updateStatus(created.id, "fetching");
    await expect(repository.updateStatus(created.id, "complete")).rejects.toThrow(
      "INVALID_RUN_TRANSITION",
    );

    const freshDb = drizzle(client, { schema });
    const refreshed = await getRunStatus(freshDb, created.id);

    expect(refreshed).toMatchObject({
      id: created.id,
      repositorySlug: "vercel/next.js",
      status: "fetching",
      progress: { total: 0, succeeded: 0, failed: 0, pending: 0 },
      isTerminal: false,
    });
    expect(await repository.findById("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

const scopeFixture = {
  limit: 100,
  states: ["open", "closed"],
  orderBy: "updated_desc",
} as const;

function repositoryFixture() {
  return {
    owner: "vercel",
    name: "next.js",
    htmlUrl: "https://github.com/vercel/next.js",
  };
}

function issueFixture(repositoryId: string) {
  return {
    repositoryId,
    githubIssueId: 123,
    issueNumber: 42,
    title: "fixture issue",
    state: "open" as const,
    htmlUrl: "https://github.com/vercel/next.js/issues/42",
    githubCreatedAt: new Date("2026-01-01T00:00:00Z"),
    githubUpdatedAt: new Date("2026-01-02T00:00:00Z"),
    currentContentHash: hash,
  };
}

function analysisFixture(runIssueId: string) {
  return {
    runIssueId,
    contentHash: hash,
    analysisVersion: "test-v1",
    modelId: "fixture-model",
    promptVersion: "fixture-prompt",
    category: "bug" as const,
    summary: "fixture summary",
    productArea: "routing",
    userScenario: "refreshing a route",
    sentiment: "negative" as const,
    severity: "high" as const,
    reproducibility: "partial" as const,
    suggestedAction: "product" as const,
    rationale: "fixture evidence",
    confidence: 0.8,
  };
}

async function insertCoreFixture(
  database: PgliteDatabase<typeof schema>,
  existingRepositoryId?: string,
) {
  const repositoryId =
    existingRepositoryId ??
    (await database.insert(repositories).values(repositoryFixture()).returning())[0]!.id;
  const [run] = await database
    .insert(analysisRuns)
    .values({
      repositoryId,
      creatorTokenHash: "scrypt:fixture",
      scope: scopeFixture,
      totalCount: 1,
      analysisVersion: "test-v1",
    })
    .returning();
  const [issue] = await database.insert(issues).values(issueFixture(repositoryId)).returning();
  const [runIssue] = await database
    .insert(runIssues)
    .values({ runId: run!.id, issueId: issue!.id, contentHash: hash })
    .returning();

  return { repositoryId, runId: run!.id, issueId: issue!.id, runIssueId: runIssue!.id };
}
