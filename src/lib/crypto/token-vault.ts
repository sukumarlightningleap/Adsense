/**
 * Token vault — AES-256-GCM encryption for OAuth refresh tokens at rest.
 *
 * Every customer's Google Ads refresh token is the keys-to-the-kingdom for
 * their ad account. We store these in Postgres but encrypt before write
 * and decrypt only inside server-only call paths (route handlers + server
 * actions + cron jobs).
 *
 * Format on disk: `<ivHex>:<authTagHex>:<ciphertextHex>` — three hex
 * strings joined by colons. Trivial to parse, hand-decryptable by an
 * admin with the key + a short script during an emergency.
 *
 * Key source: `OAUTH_TOKEN_ENCRYPTION_KEY` env var (32 bytes / 64 hex
 * chars). Generate once with:  openssl rand -hex 32
 *
 * Rotation: not supported in v1. When we need it, add an `keyVersion`
 * column and prefix the ciphertext with `v<n>:` so we can decrypt with
 * either old or new key during the rollover window.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;        // 96-bit IV is the GCM standard
const KEY_BYTES = 32;       // 256-bit key

function loadKey(): Buffer {
  const hex = process.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim();
  if (!hex) {
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEY is not set. Generate with: openssl rand -hex 32",
    );
  }
  const cleaned = hex.replace(/^['"]|['"]$/g, "");
  if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 raw bytes).",
    );
  }
  const buf = Buffer.from(cleaned, "hex");
  if (buf.length !== KEY_BYTES) {
    throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY did not decode to 32 bytes.");
  }
  return buf;
}

export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptToken(stored: string): string {
  const key = loadKey();
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid token vault format — expected `iv:tag:ct`.");
  }
  const [ivHex, tagHex, ctHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString("utf8");
}
