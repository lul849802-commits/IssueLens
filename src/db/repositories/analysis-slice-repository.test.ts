import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { analyzeVerticalSlice } from "@/services/analysis/analyze-vertical-slice";

import { DrizzleAnalysisSliceRepository } from "./analysis-slice-repository";
import { issues, repositories, schema } from "../schema";

describe("DrizzleAnalysisSliceRepository", () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
    const [repository] = await db.insert(repositories).values({
      owner: "openai",
      name: "openai-node",
      htmlUrl: "https://github.com/openai/openai-node",
    }).returning();
    for (let number = 1; number <= 5; number += 1) {
      await db.insert(issues).values({
        repositoryId: repository!.id,
        githubIssueId: number,
        issueNumber: number,
        title: `Issue ${number}`,
        body: "Body",
        state: "open",
        htmlUrl: `https://github.com/openai/openai-node/issues/${number}`,
        githubCreatedAt: new Date("2026-01-01T00:00:00Z"),
        githubUpdatedAt: new Date(Date.UTC(2026, 0, number)),
        currentContentHash: String(number).repeat(64),
      });
    }
  });

  afterEach(async () => client.close());

  it("persists five analyses and reuses them without a second provider call", async () => {
    const [repository] = await db.select().from(repositories);
    const store = new DrizzleAnalysisSliceRepository(db);
    let calls = 0;
    const analyzer = {
      modelId: "fixture-model",
      analyze: async () => {
        calls += 1;
        return result;
      },
    };

    const first = await analyzeVerticalSlice(store, analyzer, { repositoryId: repository!.id });
    const second = await analyzeVerticalSlice(store, analyzer, { repositoryId: repository!.id });

    expect(first).toMatchObject({ total: 5, succeeded: 5, cached: 0, failed: 0, status: "complete" });
    expect(second).toMatchObject({ total: 5, succeeded: 0, cached: 5, failed: 0, status: "complete" });
    expect(calls).toBe(5);
  });
});

const result = {
  analysis: {
    category: "bug" as const,
    summary: "功能异常。",
    productArea: "unknown",
    userScenario: "用户使用功能",
    sentiment: "negative" as const,
    severity: "unknown" as const,
    reproducibility: "insufficient" as const,
    suggestedAction: "product" as const,
    rationale: "Issue 报告了异常，但证据有限。",
    confidence: 0.6,
  },
  providerRequestId: "req_fixture",
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 10,
};
