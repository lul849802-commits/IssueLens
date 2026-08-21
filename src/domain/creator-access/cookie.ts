export function creatorCookieName(runId: string): string {
  return `issuelens_creator_${runId.replaceAll("-", "")}`;
}

export function creatorCookieOptions(runId: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: `/analysis/${runId}`,
    maxAge: 60 * 60 * 24 * 30,
  };
}
