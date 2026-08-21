import { describe, expect, it } from "vitest";

import { assessDeploymentReadiness } from "./deployment";

const complete = {
  DATABASE_URL: "postgresql://pooler.example.test/db",
  OPENAI_API_KEY: "test-key",
  INNGEST_EVENT_KEY: "test-event-key",
  INNGEST_SIGNING_KEY: "test-signing-key",
};

describe("assessDeploymentReadiness", () => {
  it("accepts a complete production configuration", () => {
    expect(assessDeploymentReadiness(complete, "production")).toEqual({
      ready: true,
      missing: [],
      unsafe: [],
    });
  });

  it("reports required server-only variables without their values", () => {
    expect(assessDeploymentReadiness({}, "production")).toEqual({
      ready: false,
      missing: ["DATABASE_URL", "OPENAI_API_KEY", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"],
      unsafe: [],
    });
  });

  it("rejects local development switches in production", () => {
    const result = assessDeploymentReadiness({
      ...complete,
      INNGEST_DEV: "1",
      OPENAI_PROXY_URL: "http://127.0.0.1:7897",
    }, "production");

    expect(result.ready).toBe(false);
    expect(result.unsafe).toEqual(["INNGEST_DEV", "OPENAI_PROXY_URL"]);
  });

  it("allows local-only settings during development", () => {
    const result = assessDeploymentReadiness({
      ...complete,
      INNGEST_DEV: "1",
      OPENAI_PROXY_URL: "http://127.0.0.1:7897",
    }, "development");

    expect(result.ready).toBe(true);
  });
});
