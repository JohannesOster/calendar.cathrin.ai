import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get the encryption key from environment
 * Key must be 32 bytes (256 bits) for AES-256
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }

  // Key should be a 64-character hex string (32 bytes)
  if (key.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string");
  }

  return Buffer.from(key, "hex");
}

/**
 * Encrypt a string using AES-256-GCM
 * Returns a base64 string containing: IV + ciphertext + auth tag
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Combine IV + ciphertext + authTag
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString("base64");
}

/**
 * Decrypt a string encrypted with encrypt()
 */
export function decrypt(encryptedBase64: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedBase64, "base64");

  // Extract IV, ciphertext, and auth tag
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(-AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH, -AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Generate a new encryption key
 * Use this to generate ENCRYPTION_KEY for .env
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}
