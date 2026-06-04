import { openDB } from 'idb';
import * as jose from 'jose';

type Secret = {
  hmacKey: CryptoKey;
  string: string;
  // A key ID/fingerprint of the secret. This can be shared publicly.
  thumbprint: string;
};

// Retrieve the CryptoKey directly
export async function loadKeyFromIDB(id: string): Promise<CryptoKey | undefined> {
  const dbKey = await dbKeyPromise;
  return await dbKey.get(DATABASE_KEY_STORE, id);
}

// Generate a secure random string (temporary for the URL invite link).
export async function generateTemporarySecret(): Promise<Secret> {
  const hmacKey = await window.crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, true, [
    'sign',
    'verify',
  ]);
  const array = await window.crypto.subtle.exportKey('raw', hmacKey);
  const bytes = new Uint8Array(array);
  return {
    hmacKey,
    string: bytes.toBase64(),
    thumbprint: await jose.calculateJwkThumbprint(hmacKey, 'sha256'),
  };
}

// Convert the string secret into a Web Crypto HMAC key.
export async function parseTemporarySecret(secretString: string): Promise<Secret> {
  const hmacKey = await window.crypto.subtle.importKey(
    'raw',
    Uint8Array.fromBase64(secretString),
    { name: 'HMAC', hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  return {
    hmacKey,
    string: secretString,
    thumbprint: await jose.calculateJwkThumbprint(hmacKey, 'sha256'),
  };
}

export type Challenge = Uint8Array<ArrayBuffer>;

// Generate a random challenge for the handshake.
export function generateChallenge(): Uint8Array<ArrayBuffer> {
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  return array;
}

export type Signature = Uint8Array<ArrayBuffer>;

// Sign a challenge using the secret.
export async function signChallenge(
  hmacKey: CryptoKey,
  challengeBuffer: BufferSource,
): Promise<Signature> {
  const signature = await window.crypto.subtle.sign('HMAC', hmacKey, challengeBuffer);
  return new Uint8Array(signature);
}

// Verify a received signature.
export async function verifySignature(
  hmacKey: CryptoKey,
  signatureBuffer: BufferSource,
  challengeBuffer: BufferSource,
): Promise<boolean> {
  return await window.crypto.subtle.verify('HMAC', hmacKey, signatureBuffer, challengeBuffer);
}

export async function deriveAuthenticationKey(
  ecdhKeyPub: CryptoKey,
  ecdhKeySecret: CryptoKey,
): Promise<CryptoKey> {
  return await window.crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: ecdhKeyPub,
    },
    ecdhKeySecret,
    { name: 'HMAC', hash: 'SHA-256' },
    false, // Disallow exporting, so that the key cannot be stolen.
    ['sign', 'verify'],
  );
}

const DATABASE_KEY: string = 'key-database';
const DATABASE_KEY_STORE: string = 'key-store';

// Initialize the database
const dbKeyPromise = openDB(DATABASE_KEY, 1, {
  upgrade(db) {
    db.createObjectStore(DATABASE_KEY_STORE);
  },
});

// Save the raw CryptoKey directly (extractable can be false!)
export async function saveKeyToIDB(key: CryptoKey, id: string) {
  const dbKey = await dbKeyPromise;
  await dbKey.put(DATABASE_KEY_STORE, key, id);
}

export async function getKeyFromIDB(id: string): Promise<CryptoKey | undefined> {
  const dbKey = await dbKeyPromise;
  return (await dbKey.get(DATABASE_KEY_STORE, id)) as CryptoKey | undefined;
}
