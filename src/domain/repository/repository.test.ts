import { describe, expect, it } from "vitest";

import { InvalidRepositoryError, parseRepository } from "./repository";

describe("parseRepository", () => {
  it.each([
    [" https://github.com/Vercel/next.js/ ", "vercel/next.js"],
    ["openai/openai-node", "openai/openai-node"],
    ["https://github.com/acme/example.git", "acme/example"],
  ])("normalizes %s", (input, expected) => {
    expect(parseRepository(input).slug).toBe(expected);
  });

  it.each(["", "owner-only", "https://gitlab.com/a/b", "github.com/a/b/issues"])(
    "rejects %s",
    (input) => expect(() => parseRepository(input)).toThrow(InvalidRepositoryError),
  );

  it("rejects null input", () => {
    expect(() => parseRepository(null)).toThrow(InvalidRepositoryError);
  });
});
