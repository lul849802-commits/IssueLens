import { NextResponse } from "next/server";

import { assessDeploymentReadiness } from "@/config/deployment";
import { getServerEnv } from "@/config/env";
import { getDatabase } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const headers = { "cache-control": "no-store" };

export async function GET() {
  try {
    const readiness = assessDeploymentReadiness(getServerEnv(), process.env.NODE_ENV);
    if (!readiness.ready) {
      return NextResponse.json({
        status: "degraded",
        checks: { configuration: "error", database: "not_checked" },
      }, { status: 503, headers });
    }

    const { pool } = getDatabase();
    await pool.query("select 1 as healthy");

    return NextResponse.json({
      status: "ok",
      checks: { configuration: "ok", database: "ok" },
    }, { headers });
  } catch {
    return NextResponse.json({
      status: "degraded",
      checks: { configuration: "unknown", database: "error" },
    }, { status: 503, headers });
  }
}
