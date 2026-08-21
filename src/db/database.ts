import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { schema } from "./schema";

export type IssueLensDatabase<TQueryResult extends PgQueryResultHKT> = PgDatabase<
  TQueryResult,
  typeof schema
>;
