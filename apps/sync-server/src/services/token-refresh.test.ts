import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAccessToken,
  forceRefresh,
  TokenRevokedError,
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

// Mock the provider registry
const mockRefreshToken = vi.fn();
vi.mock("../providers/registry.js", () => ({
  getProvider: vi.fn(() => ({
    refreshToken: mockRefreshToken,
  })),
}));

// Import mocked db after mocking
import { db } from "../db/index.js";
import { decrypt } from "../lib/crypto.js";

describe("token-refresh service", () => {
  const mockAccountId = "test-account-id";
  const mockRefreshTokenValue = "mock-refresh-token";
  const mockAccessToken = "mock-access-token";
  const mockNewAccessToken = "new-mock-access-token";

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
      encryptedRefreshToken: `encrypted:${mockRefreshTokenValue}`,
      tokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      userId: "user-1",
      provider: "google",
      providerAccountId: "google-123",
      email: "test@example.com",
      syncToken: null,
      syncStatus: "complete",
      syncError: null,
      lastSyncAt: null,
      lastReanchorAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
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

      mockRefreshToken.mockResolvedValue({
        accessToken: mockNewAccessToken,
        expiresIn: 3600,
      });

      const token = await getAccessToken(mockAccountId);

      expect(token).toBe(mockNewAccessToken);
      expect(mockRefreshToken).toHaveBeenCalledWith(mockRefreshTokenValue);
    });

    it("refreshes token within 60 second buffer", async () => {
      // Token expires in 30 seconds (within buffer)
      const nearExpiry = new Date(Date.now() + 30 * 1000);

      vi.mocked(db!.query.accounts.findFirst).mockResolvedValue(
        createMockAccount({ tokenExpiresAt: nearExpiry })
      );

      mockRefreshToken.mockResolvedValue({
        accessToken: mockNewAccessToken,
        expiresIn: 3600,
      });

      const token = await getAccessToken(mockAccountId);

      expect(token).toBe(mockNewAccessToken);
      expect(mockRefreshToken).toHaveBeenCalled();
    });

    it("throws TokenRevokedError when refresh token is invalid", async () => {
      const pastExpiry = new Date(Date.now() - 10 * 60 * 1000);

      vi.mocked(db!.query.accounts.findFirst).mockResolvedValue(
        createMockAccount({ tokenExpiresAt: pastExpiry })
      );

      mockRefreshToken.mockRejectedValue(
        new TokenRevokedError("Token has been revoked")
      );

      await expect(getAccessToken(mockAccountId)).rejects.toThrow(
        TokenRevokedError
      );

      // Should clear the access token in DB
      expect(db!.update).toHaveBeenCalled();
    });

    it("throws error for other provider errors", async () => {
      const pastExpiry = new Date(Date.now() - 10 * 60 * 1000);

      vi.mocked(db!.query.accounts.findFirst).mockResolvedValue(
        createMockAccount({ tokenExpiresAt: pastExpiry })
      );

      mockRefreshToken.mockRejectedValue(
        new Error("Google token refresh failed: Internal server error")
      );

      await expect(getAccessToken(mockAccountId)).rejects.toThrow(
        "Google token refresh failed"
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

      mockRefreshToken.mockResolvedValue({
        accessToken: mockNewAccessToken,
        expiresIn: 3600,
      });

      const token = await forceRefresh(mockAccountId);

      expect(token).toBe(mockNewAccessToken);
      expect(mockRefreshToken).toHaveBeenCalled();
    });
  });
});
