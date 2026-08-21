import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleDurableAnalysisRepository } from "../src/db/repositories/durable-analysis-repository";
import { analysisRuns, schema } from "../src/db/schema";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");
  const requestedAge = Number(process.argv[2] ?? "60");
  const minimumAgeSeconds = Number.isFinite(requestedAge)
    ? Math.max(60, Math.trunc(requestedAge))
    : 60;
  const cutoff = new Date(Date.now() - minimumAgeSeconds * 1_000);
  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    const stale = await db
      .select({ id: analysisRuns.id })
      .from(analysisRuns)
      .where(and(
        eq(analysisRuns.status, "queued"),
        isNull(analysisRuns.workflowEventId),
        lt(analysisRuns.createdAt, cutoff),
      ));
    const store = new DrizzleDurableAnalysisRepository(db);
    for (const run of stale) {
      await store.failRun(run.id, "WORKFLOW_EVENT_SEND_FAILED");
    }
    console.log(JSON.stringify({
      minimumAgeSeconds,
      reconciledCount: stale.length,
      runIds: stale.map((run) => run.id),
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error && error.message === "DATABASE_URL_REQUIRED"
    ? error.message
    : "WORKFLOW_RECONCILE_FAILED");
  process.exitCode = 1;
});
