import { describe, expect, it } from "vitest";
import { creatorCookieName, creatorCookieOptions } from "./cookie";
describe("creator cookie", () => { it("keeps the credential out of the URL and scopes it to one run", () => { const runId="11111111-1111-4111-8111-111111111111"; expect(creatorCookieName(runId)).toBe("issuelens_creator_11111111111141118111111111111111"); expect(creatorCookieOptions(runId)).toMatchObject({ httpOnly:true, sameSite:"lax", path:`/analysis/${runId}` }); }); });
