import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateEncryptionKey } from "../lib/crypto.js";
import { signChannelToken, verifyChannelToken } from "./watch-manager.js";

describe("channel token HMAC signing", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const testKey = generateEncryptionKey();

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = testKey;
  });

  afterAll(() => {
    if (originalKey) {
      process.env.ENCRYPTION_KEY = originalKey;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  it("signs and verifies a valid token", () => {
    const token = signChannelToken("acc-123", "cal-456");
    const result = verifyChannelToken(token);
    expect(result).toEqual({ accountId: "acc-123", calendarId: "cal-456" });
  });

  it("includes sig parameter in signed token", () => {
    const token = signChannelToken("acc-123", "cal-456");
    const params = new URLSearchParams(token);
    expect(params.get("sig")).toBeTruthy();
    expect(params.get("sig")).toHaveLength(64); // SHA-256 hex
  });

  it("handles calendarIds with special characters", () => {
    const calendarId = "user@example.com";
    const token = signChannelToken("acc-1", calendarId);
    const result = verifyChannelToken(token);
    expect(result).toEqual({ accountId: "acc-1", calendarId });
  });

  it("rejects a token with tampered accountId", () => {
    const token = signChannelToken("acc-123", "cal-456");
    const tampered = token.replace("acc-123", "acc-evil");
    expect(verifyChannelToken(tampered)).toBeNull();
  });

  it("rejects a token with tampered calendarId", () => {
    const token = signChannelToken("acc-123", "cal-456");
    const tampered = token.replace("cal-456", "cal-evil");
    expect(verifyChannelToken(tampered)).toBeNull();
  });

  it("rejects a token with tampered signature", () => {
    const token = signChannelToken("acc-123", "cal-456");
    // Flip one hex character in the signature
    const params = new URLSearchParams(token);
    const sig = params.get("sig")!;
    const flipped = sig[0] === "a" ? "b" + sig.slice(1) : "a" + sig.slice(1);
    params.set("sig", flipped);
    expect(verifyChannelToken(params.toString())).toBeNull();
  });

  it("rejects a token without a signature", () => {
    const token = "accountId=acc-123&calendarId=cal-456";
    expect(verifyChannelToken(token)).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(verifyChannelToken("")).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifyChannelToken("not-a-valid-token")).toBeNull();
  });

  it("rejects a token signed with a different key", () => {
    const token = signChannelToken("acc-123", "cal-456");

    // Temporarily swap key
    process.env.ENCRYPTION_KEY = generateEncryptionKey();
    expect(verifyChannelToken(token)).toBeNull();

    // Restore
    process.env.ENCRYPTION_KEY = testKey;
  });
});
