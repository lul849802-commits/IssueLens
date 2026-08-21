import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleDurableAnalysisRepository } from "../src/db/repositories/durable-analysis-repository";
import { schema } from "../src/db/schema";
import { makeCreatorCredential } from "../src/domain/creator-access/credential";
import { parseRepository } from "../src/domain/repository/repository";
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");
  const repository = parseRepository(process.argv[2] ?? "openai/openai-node");
  const requestedLimit = Number(process.argv[3] ?? "5");
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
    : 5;
  const modelId = process.env.OPENAI_MODEL || "gpt-5-mini";
  if (process.env.INNGEST_DEV === "1") {
    process.env.INNGEST_BASE_URL ||= "http://127.0.0.1:8288";
    process.env.INNGEST_EVENT_KEY ||= "local-development";
  }
  const [{ inngest }, { requestAnalysisRun }] = await Promise.all([
    import("../src/inngest/client"),
    import("../src/services/workflows/request-analysis-run"),
  ]);
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const credential = makeCreatorCredential();
    const result = await requestAnalysisRun(
      new DrizzleDurableAnalysisRepository(drizzle(pool, { schema })),
      inngest,
      {
        repository,
        creatorTokenHash: credential.storedVerifier,
        limit,
        modelId,
      },
    );
    console.log(JSON.stringify({
      repository: repository.slug,
      limit,
      modelId,
      ...result,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const code = error instanceof Error && [
    "DATABASE_URL_REQUIRED",
    "WORKFLOW_EVENT_NOT_ACKNOWLEDGED",
    "INVALID_REPOSITORY",
  ].includes(error.message)
    ? error.message
    : "WORKFLOW_REQUEST_FAILED";
  console.error(code);
  process.exitCode = 1;
});
