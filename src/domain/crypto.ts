import { secp256k1 } from "@noble/curves/secp256k1.js";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * ECIES over secp256k1 for private memories: encrypt a note to a
 * recipient's public key so it can live on the public chain unreadable to
 * everyone but the holder of the matching secret key. The scheme is built from
 * audited primitives — never a hand-rolled cipher:
 *
 *   ephemeral keypair  -> ECDH shared secret (@noble/curves secp256k1)
 *   HKDF-SHA256        -> a 32-byte AES key (node:crypto)
 *   AES-256-GCM        -> authenticated ciphertext (node:crypto)
 *
 * Wire layout of the returned blob, all concatenated:
 *   ephemeralPubkey(33) ‖ iv(12) ‖ ciphertext(n) ‖ tag(16)
 *
 * The ephemeral key makes every encryption fresh, and GCM's tag makes tampering
 * or a wrong key fail loudly rather than return garbage.
 */

const EPHEMERAL_PUBKEY_BYTES = 33; // compressed secp256k1 point
const IV_BYTES = 12; // AES-GCM nonce
const TAG_BYTES = 16; // AES-GCM authentication tag
const AES_KEY_BYTES = 32; // AES-256
const HKDF_INFO = "bettyjane-ecies-v1"; // domain separation for the derived key

/** The smallest a valid blob can be: the fixed parts with an empty ciphertext. */
export const ECIES_OVERHEAD_BYTES = EPHEMERAL_PUBKEY_BYTES + IV_BYTES + TAG_BYTES;

export class DecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptError";
  }
}

/** Encrypt `plaintext` so only the holder of `recipientPubkey`'s secret can read it. */
export function encryptToPubkey(plaintext: Uint8Array, recipientPubkey: Uint8Array): Uint8Array {
  const ephemeralSeckey = secp256k1.utils.randomSecretKey();
  const ephemeralPubkey = secp256k1.getPublicKey(ephemeralSeckey, true);
  const shared = secp256k1.getSharedSecret(ephemeralSeckey, recipientPubkey);
  const key = deriveKey(shared);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return concatBytes(ephemeralPubkey, iv, ciphertext, tag);
}

/**
 * Decrypt a blob produced by {@link encryptToPubkey} with the recipient's secret
 * key. Throws {@link DecryptError} if the blob is malformed, the key is wrong, or
 * the ciphertext was tampered with (the GCM tag will not verify).
 */
export function decryptWithSeckey(blob: Uint8Array, recipientSeckey: Uint8Array): Uint8Array {
  if (blob.length < ECIES_OVERHEAD_BYTES) {
    throw new DecryptError(`ciphertext blob is ${blob.length} bytes, below the ${ECIES_OVERHEAD_BYTES}-byte minimum`);
  }
  const ephemeralPubkey = blob.subarray(0, EPHEMERAL_PUBKEY_BYTES);
  const iv = blob.subarray(EPHEMERAL_PUBKEY_BYTES, EPHEMERAL_PUBKEY_BYTES + IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(EPHEMERAL_PUBKEY_BYTES + IV_BYTES, blob.length - TAG_BYTES);

  let shared: Uint8Array;
  try {
    shared = secp256k1.getSharedSecret(recipientSeckey, ephemeralPubkey);
  } catch {
    throw new DecryptError("invalid ephemeral public key");
  }
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(shared), iv);
  decipher.setAuthTag(tag);
  try {
    return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  } catch {
    throw new DecryptError("authentication failed: wrong key or tampered ciphertext");
  }
}

function deriveKey(shared: Uint8Array): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", shared, new Uint8Array(0), Buffer.from(HKDF_INFO), AES_KEY_BYTES));
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
