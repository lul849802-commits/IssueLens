import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { Pool } from "pg";

async function main() {
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");

const expectedTables = [
  "analysis_corrections",
  "analysis_runs",
  "cluster_members",
  "clusters",
  "issue_analyses",
  "issues",
  "repositories",
  "run_issues",
];
const pool = new Pool({ connectionString, max: 1 });
const marker = `smoke-${randomUUID()}`;

try {
  const tableResult = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1) order by table_name",
    [expectedTables],
  );
  const actualTables = tableResult.rows.map((row) => row.table_name);
  if (actualTables.join(",") !== expectedTables.join(",")) {
    throw new Error(`DATABASE_SCHEMA_INCOMPLETE:${actualTables.join(",")}`);
  }

  const migrationResult = await pool.query<{ count: number }>(
    "select count(*)::int as count from drizzle.__drizzle_migrations",
  );
  if ((migrationResult.rows[0]?.count ?? 0) < 2) {
    throw new Error(
      `DATABASE_MIGRATION_COUNT_INVALID:${migrationResult.rows[0]?.count ?? 0}`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "insert into repositories (owner, name, html_url) values ($1, $2, $3)",
      [marker, "rollback-check", "https://github.com/fixture/rollback-check"],
    );
    await client.query("rollback");
  } finally {
    client.release();
  }

  const rollbackResult = await pool.query(
    "select 1 from repositories where owner = $1",
    [marker],
  );
  if (rollbackResult.rowCount !== 0) throw new Error("DATABASE_ROLLBACK_FAILED");

  console.log(
    "IssueLens database smoke test passed: migration history recorded, schema complete, rollback verified.",
  );
} finally {
  await pool.end();
}
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(
    `IssueLens database smoke test failed: ${message.replace(/postgres(?:ql)?:\/\/\S+/g, "[REDACTED]")}`,
  );
  process.exitCode = 1;
});
