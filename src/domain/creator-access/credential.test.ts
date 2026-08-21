import { describe, expect, it } from "vitest";

import { makeCreatorCredential, verifyCreatorCredential } from "./credential";

describe("creator credential", () => {
  it("stores only a one-way verifier", () => {
    const { token, storedVerifier } = makeCreatorCredential();

    expect(storedVerifier).not.toContain(token);
    expect(verifyCreatorCredential(token, storedVerifier)).toBe(true);
    expect(verifyCreatorCredential(`${token}x`, storedVerifier)).toBe(false);
  });

  it.each(["", "sha256:salt:digest", "scrypt:bad:format"])(
    "rejects malformed verifier %s",
    (storedVerifier) => expect(verifyCreatorCredential("token", storedVerifier)).toBe(false),
  );

  it("rejects an empty presented token", () => {
    const { storedVerifier } = makeCreatorCredential();
    expect(verifyCreatorCredential("", storedVerifier)).toBe(false);
  });
});
