import { safeStorage } from "electron";

/**
 * In-memory cache: key → decrypted plaintext
 * This allows the main process to read credentials without re-decrypting each time.
 */
const cache = new Map<string, string>();

/**
 * Returns whether the platform's OS-level encryption backend is available.
 * Always returns false rather than throwing when the check itself fails.
 */
export function isAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * Encrypt a plaintext value and return a base64 string suitable for DB storage.
 * Also updates the in-memory cache.
 * Throws if safeStorage encryption is not available.
 */
export function store(key: string, plaintext: string): string {
  if (!isAvailable()) {
    throw new Error(
      `[CredentialStore] safeStorage encryption is not available on this platform`,
    );
  }
  const encrypted = safeStorage.encryptString(plaintext);
  const base64 = encrypted.toString("base64");
  cache.set(key, plaintext);
  return base64;
}

/**
 * Decrypt a base64-encoded encrypted value and return the plaintext.
 * Checks the in-memory cache first. Returns null on any failure.
 */
export function retrieve(key: string, encryptedBase64?: string): string | null {
  // Return from cache if available
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  if (!encryptedBase64) return null;
  if (!isAvailable()) return null;

  try {
    const buf = Buffer.from(encryptedBase64, "base64");
    const plaintext = safeStorage.decryptString(buf);
    cache.set(key, plaintext);
    return plaintext;
  } catch {
    return null;
  }
}

/**
 * Remove a key from the in-memory cache.
 * Returns true if the key existed, false otherwise.
 */
export function del(key: string): boolean {
  return cache.delete(key);
}

/**
 * Check whether a key is present in the in-memory cache.
 */
export function has(key: string): boolean {
  return cache.has(key);
}

/**
 * Load an encrypted value from the DB into the in-memory cache on startup.
 * Silently ignores decryption failures.
 */
export function hydrate(key: string, encryptedBase64: string): void {
  if (!isAvailable()) return;
  try {
    const buf = Buffer.from(encryptedBase64, "base64");
    const plaintext = safeStorage.decryptString(buf);
    cache.set(key, plaintext);
  } catch {
    // Decryption failure — leave key out of cache
  }
}

/**
 * Remove all entries from the in-memory cache.
 */
export function clearAll(): void {
  cache.clear();
}
