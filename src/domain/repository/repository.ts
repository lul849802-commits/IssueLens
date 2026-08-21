export interface RepositoryRef {
  owner: string;
  repo: string;
  slug: string;
}

export class InvalidRepositoryError extends Error {
  constructor() {
    super("INVALID_REPOSITORY");
    this.name = "InvalidRepositoryError";
  }
}

const REPOSITORY_PATTERN =
  /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i;

export function parseRepository(input: unknown): RepositoryRef {
  const raw = String(input ?? "").trim().replace(/\/+$/, "");
  const match = raw.match(REPOSITORY_PATTERN);

  if (!match?.[1] || !match[2]) {
    throw new InvalidRepositoryError();
  }

  const owner = match[1];
  const repo = match[2];

  return { owner, repo, slug: `${owner}/${repo}`.toLowerCase() };
}
