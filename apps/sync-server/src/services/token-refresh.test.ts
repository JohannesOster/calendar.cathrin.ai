import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getAccessToken,
  forceRefresh,
  TokenRevokedError,
  TokenRefreshError,
} from "./token-refresh.js";

// Mock the db module
vi.mock("../db/index.js", () => ({
  db: {
    query: {
      accounts: {
        findFirst: vi.fn(),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  },
}));

// Mock the crypto module
vi.mock("../lib/crypto.js", () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn((text: string) => text.replace("encrypted:", "")),
}));

// Import mocked db after mocking
import { db } from "../db/index.js";
import { decrypt } from "../lib/crypto.js";

describe("token-refresh service", () => {
  const mockAccountId = "test-account-id";
  const mockRefreshToken = "mock-refresh-token";
  const mockAccessToken = "mock-access-token";
  const mockNewAccessToken = "new-mock-access-token";

  const originalEnv = process.env;
  const originalFetch = global.fetch;

  // Helper to create a mock account with all required fields
  function createMockAccount(overrides: Partial<{
    id: string;
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    tokenExpiresAt: Date;
  }> = {}) {
    return {
      id: mockAccountId,
      encryptedAccessToken: `encrypted:${mockAccessToken}`,
      encryptedRefreshToken: `encrypted:${mockRefreshToken}`,
      tokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      userId: "user-1",
      provider: "google",
      providerAccountId: "google-123",
      email: "test@example.com",
      syncToken: null,
      syncStatus: "complete",
      syncError: null,
      lastSyncAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      ENCRYPTION_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  describe("getAccessToken", () => {
    it("returns cached token when still valid", async () => {
      const futureExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

      vi.mocked(db!.query.accounts.findFirst).mockResolvedValue(
        createMockAccount({ tokenExpiresAt: futureExpiry })
      );

      const token = await getAccessToken(mockAccountId);

      expect(token).toBe(mockAccessToken);
      expect(decrypt).toHaveBeenCalledWith(`encrypted:${mockAccessToken}`);
    });

    it("refreshes token when expired", async () => {
      const pastExpiry = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

      vi.mocked(db!.query.accounts.findFirst).mockResolvedValue(
        createMockAccount({ tokenExpiresAt: pastExpiry })
      );

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: mockNewAccessToken,
            expires_in: 3600,
            token_type: "Bearer",
            scope: "calendar.readonly",
          }),
      });

      const token = await getAccessToken(mockAccountId);

      expect(token).toBe(mockNewAccessToken);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/token",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    it("refreshes token within 60 second buffer", async () => {
      // Token expires in 30 seconds (within buffer)
      const nearExpiry = new Date(Date.now() + 30 * 1000);

      vi.mocked(db!.query.accounts.findFirst).mockResolvedValue(
        createMockAccount({ tokenExpiresAt: nearExpiry })
      );

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: mockNewAccessToken,
            expires_in: 3600,
            token_type: "Bearer",
            scope: "calendar.readonly",
          }),
      });

      const token = await getAccessToken(mockAccountId);

      expect(token).toBe(mockNewAccessToken);
      expect(global.fetch).toHaveBeenCalled();
    });

    it("throws TokenRevokedError when refresh token is invalid", async () => {
      const pastExpiry = new Date(Date.now() - 10 * 60 * 1000);

      vi.mocked(db!.query.accounts.findFirst).mockResolvedValue(
        createMockAccount({ tokenExpiresAt: pastExpiry })
      );

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: "invalid_grant",
            error_description: "Token has been revoked",
          }),
      });

      await expect(getAccessToken(mockAccountId)).rejects.toThrow(
        TokenRevokedError
      );

      // Should clear the access token in DB
      expect(db!.update).toHaveBeenCalled();
    });

    it("throws TokenRefreshError for other Google errors", async () => {
      const pastExpiry = new Date(Date.now() - 10 * 60 * 1000);

      vi.mocked(db!.query.accounts.findFirst).mockResolvedValue(
        createMockAccount({ tokenExpiresAt: pastExpiry })
      );

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: "server_error",
            error_description: "Internal server error",
          }),
      });

      await expect(getAccessToken(mockAccountId)).rejects.toThrow(
        TokenRefreshError
      );
    });

    it("throws error when account not found", async () => {
      vi.mocked(db!.query.accounts.findFirst).mockResolvedValue(undefined);

      await expect(getAccessToken(mockAccountId)).rejects.toThrow(
        "Account not found"
      );
    });
  });

  describe("forceRefresh", () => {
    it("always refreshes token regardless of expiry", async () => {
      const futureExpiry = new Date(Date.now() + 10 * 60 * 1000);

      vi.mocked(db!.query.accounts.findFirst).mockResolvedValue(
        createMockAccount({ tokenExpiresAt: futureExpiry })
      );

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: mockNewAccessToken,
            expires_in: 3600,
            token_type: "Bearer",
            scope: "calendar.readonly",
          }),
      });

      const token = await forceRefresh(mockAccountId);

      expect(token).toBe(mockNewAccessToken);
      expect(global.fetch).toHaveBeenCalled();
    });
  });
});
