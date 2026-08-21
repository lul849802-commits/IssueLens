import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
const connectionString = process.env.DIRECT_DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_DATABASE_URL_REQUIRED");

const pool = new Pool({ connectionString, max: 1 });

try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("IssueLens migrations applied successfully.");
} finally {
  await pool.end();
}
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  const cause =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause?: unknown }).cause
      : undefined;
  const causeMessage = cause instanceof Error ? cause.message : "No nested cause";
  console.error(
    `IssueLens database migration failed: ${`${message}; cause: ${causeMessage}`.replace(/postgres(?:ql)?:\/\/\S+/g, "[REDACTED]")}`,
  );
  process.exitCode = 1;
});
