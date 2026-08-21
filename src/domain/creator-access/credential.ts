import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;
const VERIFIER_PATTERN = /^scrypt:([a-f0-9]{32}):([a-f0-9]{64})$/;

export interface CreatorCredential {
  token: string;
  storedVerifier: string;
}

export function makeCreatorCredential(): CreatorCredential {
  const token = randomBytes(32).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(token, salt, KEY_LENGTH).toString("hex");

  return { token, storedVerifier: `scrypt:${salt}:${digest}` };
}

export function verifyCreatorCredential(token: string, storedVerifier: string): boolean {
  if (!token) return false;

  const match = storedVerifier.match(VERIFIER_PATTERN);
  if (!match?.[1] || !match[2]) return false;

  const actual = scryptSync(token, match[1], KEY_LENGTH);
  const expected = Buffer.from(match[2], "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
