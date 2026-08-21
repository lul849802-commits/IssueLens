import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getServerEnv } from "@/config/env";

import { schema } from "./schema";

type Database = NodePgDatabase<typeof schema>;
type DatabaseResources = { db: Database; pool: Pool };

const globalDatabase = globalThis as typeof globalThis & {
  issueLensDatabase?: DatabaseResources;
};

export function getDatabase(): DatabaseResources {
  if (globalDatabase.issueLensDatabase) return globalDatabase.issueLensDatabase;

  const { DATABASE_URL } = getServerEnv();
  if (!DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  const resources = { db: drizzle(pool, { schema }), pool };
  globalDatabase.issueLensDatabase = resources;

  return resources;
}
