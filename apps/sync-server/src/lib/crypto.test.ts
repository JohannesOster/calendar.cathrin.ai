import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encrypt, decrypt, generateEncryptionKey } from "./crypto.js";

describe("crypto utilities", () => {
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

  describe("generateEncryptionKey", () => {
    it("generates a 64-character hex string", () => {
      const key = generateEncryptionKey();
      expect(key).toHaveLength(64);
      expect(/^[0-9a-f]+$/i.test(key)).toBe(true);
    });

    it("generates unique keys each time", () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe("encrypt/decrypt round-trip", () => {
    it("encrypts and decrypts a simple string", () => {
      const plaintext = "hello world";
      const ciphertext = encrypt(plaintext);
      const decrypted = decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it("encrypts and decrypts an empty string", () => {
      const plaintext = "";
      const ciphertext = encrypt(plaintext);
      const decrypted = decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it("encrypts and decrypts unicode characters", () => {
      const plaintext = "Hello 世界 🔐 émojis";
      const ciphertext = encrypt(plaintext);
      const decrypted = decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it("encrypts and decrypts a long string", () => {
      const plaintext = "a".repeat(10000);
      const ciphertext = encrypt(plaintext);
      const decrypted = decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it("encrypts and decrypts JSON data (OAuth tokens)", () => {
      const tokenData = JSON.stringify({
        access_token: "ya29.a0AfH6SMBx...",
        refresh_token: "1//0eZL7...",
        expires_in: 3599,
        token_type: "Bearer",
      });
      const ciphertext = encrypt(tokenData);
      const decrypted = decrypt(ciphertext);
      expect(decrypted).toBe(tokenData);
    });
  });

  describe("unique IV per encryption", () => {
    it("produces different ciphertext for same plaintext", () => {
      const plaintext = "same input";
      const ciphertext1 = encrypt(plaintext);
      const ciphertext2 = encrypt(plaintext);

      // Ciphertexts should differ (unique IV)
      expect(ciphertext1).not.toBe(ciphertext2);

      // Both should decrypt to the same plaintext
      expect(decrypt(ciphertext1)).toBe(plaintext);
      expect(decrypt(ciphertext2)).toBe(plaintext);
    });
  });

  describe("tampering detection", () => {
    it("throws on tampered ciphertext", () => {
      const plaintext = "sensitive data";
      const ciphertext = encrypt(plaintext);

      // Decode, tamper with a byte, re-encode
      const buffer = Buffer.from(ciphertext, "base64");
      buffer[20] = buffer[20] ^ 0xff; // Flip bits in the ciphertext portion
      const tampered = buffer.toString("base64");

      expect(() => decrypt(tampered)).toThrow();
    });

    it("throws on tampered auth tag", () => {
      const plaintext = "sensitive data";
      const ciphertext = encrypt(plaintext);

      // Tamper with the last byte (part of auth tag)
      const buffer = Buffer.from(ciphertext, "base64");
      buffer[buffer.length - 1] = buffer[buffer.length - 1] ^ 0xff;
      const tampered = buffer.toString("base64");

      expect(() => decrypt(tampered)).toThrow();
    });

    it("throws on truncated ciphertext", () => {
      const plaintext = "sensitive data";
      const ciphertext = encrypt(plaintext);

      // Truncate the ciphertext
      const truncated = ciphertext.slice(0, -10);

      expect(() => decrypt(truncated)).toThrow();
    });
  });

  describe("key validation", () => {
    it("throws when ENCRYPTION_KEY is missing", () => {
      const savedKey = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;

      expect(() => encrypt("test")).toThrow(
        "ENCRYPTION_KEY environment variable is required"
      );

      process.env.ENCRYPTION_KEY = savedKey;
    });

    it("throws when ENCRYPTION_KEY is wrong length", () => {
      const savedKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = "tooshort";

      expect(() => encrypt("test")).toThrow(
        "ENCRYPTION_KEY must be a 64-character hex string"
      );

      process.env.ENCRYPTION_KEY = savedKey;
    });
  });
});
