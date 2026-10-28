import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * At-rest encryption for provider API keys.
 *
 * Keys are the only secret the app stores, and they must never sit in the
 * database as plaintext. The key material comes from the environment when set,
 * otherwise a 32-byte key is generated once and written beside the database
 * with owner-only permissions.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export function loadEncryptionKey({
  keyPath,
  base64,
}: {
  keyPath: string;
  base64: string;
}): Buffer {
  if (base64) {
    const key = Buffer.from(base64, "base64");
    if (key.length !== 32) {
      throw new Error("AGENTCHAT_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
    }
    return key;
  }

  if (existsSync(keyPath)) {
    const stored = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    if (stored.length !== 32) {
      throw new Error(`The encryption key at ${keyPath} is corrupt.`);
    }
    return stored;
  }

  const key = randomBytes(32);
  mkdirSync(path.dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, key.toString("base64"), { mode: 0o600 });
  return key;
}

/** Encrypts a secret to `iv:tag:ciphertext`, all base64. */
export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Reverses `encryptSecret`. Throws when the payload is malformed or tampered. */
export function decryptSecret(key: Buffer, payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("Stored secret is malformed.");
  const [ivPart, tagPart, dataPart] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
