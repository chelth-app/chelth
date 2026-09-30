/** Generates a cryptographically random, base64-encoded CSP nonce (128 bits). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Request header carrying the per-request nonce from src/proxy.ts to rendering. */
export const NONCE_HEADER = "x-nonce";
