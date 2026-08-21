import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { Pool } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");
  const runIds = process.argv.slice(2);
  if (runIds.length === 0) throw new Error("RUN_ID_REQUIRED");

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const summary = await pool.query<{
      run_id: string;
      status: string;
      total_count: number;
      succeeded_count: number;
      failed_count: number;
      analysis_count: number;
      request_id_count: number;
      input_tokens: number;
      output_tokens: number;
      latency_ms: number;
      cached_count: number;
    }>(
      `select ar.id as run_id, ar.status, ar.total_count, ar.succeeded_count,
        ar.failed_count, count(ia.id)::int as analysis_count,
        count(ia.provider_request_id)::int as request_id_count,
        coalesce(sum(ia.input_tokens), 0)::int as input_tokens,
        coalesce(sum(ia.output_tokens), 0)::int as output_tokens,
        coalesce(sum(ia.latency_ms), 0)::int as latency_ms,
        count(*) filter (where ri.status = 'skipped_cached')::int as cached_count
      from analysis_runs ar
      join run_issues ri on ri.run_id = ar.id
      left join issue_analyses ia on ia.run_issue_id = ri.id
      where ar.id = any($1::uuid[])
      group by ar.id
      order by ar.created_at`,
      [runIds],
    );
    const details = await pool.query<{
      run_id: string;
      issue_number: number;
      title: string;
      body_preview: string;
      category: string;
      summary: string;
      severity: string;
      rationale: string;
      confidence: number;
    }>(
      `select ar.id as run_id, i.issue_number, i.title, left(i.body, 500) as body_preview,
        ia.category, ia.summary, ia.severity, ia.rationale, ia.confidence
      from analysis_runs ar
      join run_issues ri on ri.run_id = ar.id
      join issues i on i.id = ri.issue_id
      join issue_analyses ia on ia.run_issue_id = ri.id
      where ar.id = $1::uuid
      order by i.issue_number`,
      [runIds[0]],
    );
    console.log(JSON.stringify({ summary: summary.rows, details: details.rows }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error && ["DATABASE_URL_REQUIRED", "RUN_ID_REQUIRED"].includes(error.message)
    ? error.message
    : "AI_VERIFY_FAILED");
  process.exitCode = 1;
});
