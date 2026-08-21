import type { ServerEnv } from "./env";

export type DeploymentReadiness = {
  ready: boolean;
  missing: Array<"DATABASE_URL" | "OPENAI_API_KEY" | "INNGEST_EVENT_KEY" | "INNGEST_SIGNING_KEY">;
  unsafe: Array<"INNGEST_DEV" | "OPENAI_PROXY_URL">;
};

const required = [
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
] as const;

function isLoopback(value: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
}

export function assessDeploymentReadiness(
  env: ServerEnv,
  nodeEnv: string | undefined,
): DeploymentReadiness {
  const missing = required.filter((name) => !env[name]);
  const unsafe: DeploymentReadiness["unsafe"] = [];

  if (nodeEnv === "production" && env.INNGEST_DEV === "1") {
    unsafe.push("INNGEST_DEV");
  }

  if (nodeEnv === "production" && env.OPENAI_PROXY_URL && isLoopback(env.OPENAI_PROXY_URL)) {
    unsafe.push("OPENAI_PROXY_URL");
  }

  return { ready: missing.length === 0 && unsafe.length === 0, missing, unsafe };
}
