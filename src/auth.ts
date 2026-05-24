import { openDB } from 'idb';
import * as jose from 'jose';
import * as uuid from 'uuid';

// The secret of an invite link, used as the key of the handshake when joining a calendar.
export type InviteSecret = {
  hmacKey: CryptoKey;
  string: string;
  // A key ID/fingerprint of the secret. This can be shared publicly.
  thumbprint: string;
};

// Generate a new invite secret, to be included in an invite link.
export async function generateInviteSecret(): Promise<InviteSecret> {
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

// Parse the invite secret from the string included in an invite link.
export async function parseInviteSecret(secretString: string): Promise<InviteSecret> {
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

const CHALLENGE_LENGTH = 32;

// Generate a random challenge for the handshake.
export function generateChallenge(): Uint8Array<ArrayBuffer> {
  const array = new Uint8Array(CHALLENGE_LENGTH);
  window.crypto.getRandomValues(array);
  return array;
}

export type Signature = Uint8Array<ArrayBuffer>;

// The peer that opened the connection, and the peer that accepted it.
export type HandshakeRole = 'initiator' | 'responder';

// A mutual challenge-response handshake, where each peer proves that it has the same HMAC key:
// 1. The initiator sends its challenge.
// 2. The responder sends its challenge and its signature.
// 3. The initiator verifies the responder's signature and sends its own signature.
// 4. The responder verifies the initiator's signature.
// The signed data contains the signer's role and both challenges. Without the role, an attacker
// could open a second connection to a peer, send that peer's own challenge, and reflect the
// resulting signature back. Without both challenges, a signature could be replayed in another
// handshake.
// TODO: Sign JSON data instead.
function handshakeSignedData(
  role: HandshakeRole,
  challengeInitiator: BufferSource,
  challengeResponder: BufferSource,
): Uint8Array<ArrayBuffer> {
  const label = new TextEncoder().encode(`pin-calendar-handshake-${role}`);
  const initiator = toBytes(challengeInitiator);
  const responder = toBytes(challengeResponder);

  if (initiator.length !== CHALLENGE_LENGTH || responder.length !== CHALLENGE_LENGTH)
    throw new Error('Invalid handshake challenge length.');

  const result = new Uint8Array(label.length + 2 * CHALLENGE_LENGTH);
  result.set(label, 0);
  result.set(initiator, label.length);
  result.set(responder, label.length + CHALLENGE_LENGTH);
  return result;
}

// Packets received via PeerJS may contain an `ArrayBuffer` in place of a `Uint8Array`.
function toBytes(buffer: BufferSource): Uint8Array {
  if (ArrayBuffer.isView(buffer))
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return new Uint8Array(buffer);
}

// Sign the handshake as the peer with the given role.
export async function signHandshake(
  hmacKey: CryptoKey,
  role: HandshakeRole,
  challengeInitiator: BufferSource,
  challengeResponder: BufferSource,
): Promise<Signature> {
  const data = handshakeSignedData(role, challengeInitiator, challengeResponder);
  return new Uint8Array(await window.crypto.subtle.sign('HMAC', hmacKey, data));
}

// Verify the handshake signature of the remote peer with the given role.
export async function verifyHandshake(
  hmacKey: CryptoKey,
  role: HandshakeRole,
  challengeInitiator: BufferSource,
  challengeResponder: BufferSource,
  signature: BufferSource,
): Promise<boolean> {
  let data;

  try {
    data = handshakeSignedData(role, challengeInitiator, challengeResponder);
  } catch {
    return false;
  }

  return await window.crypto.subtle.verify('HMAC', hmacKey, signature, data);
}

const ECDH_ALGORITHM: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };

export type EcdhKeyPair = {
  privateKey: CryptoKey;
  // The public key, to be sent to the remote peer.
  publicKeyRaw: Uint8Array<ArrayBuffer>;
};

// Generate a temporary key pair, used to derive an authentication key shared with a remote peer
// via Diffie-Hellman.
export async function generateEcdhKeyPair(): Promise<EcdhKeyPair> {
  const keyPair = await window.crypto.subtle.generateKey(
    ECDH_ALGORITHM,
    false, // Only applies to the private key, public keys can always be exported.
    ['deriveKey'],
  );
  return {
    privateKey: keyPair.privateKey,
    publicKeyRaw: new Uint8Array(await window.crypto.subtle.exportKey('raw', keyPair.publicKey)),
  };
}

// Derive the authentication key shared with a remote peer, save it to IndexedDB, and return its ID.
export async function establishAuthenticationKey(
  privateKey: CryptoKey,
  remotePublicKeyRaw: BufferSource,
): Promise<string> {
  const remotePublicKey = await window.crypto.subtle.importKey(
    'raw',
    remotePublicKeyRaw,
    ECDH_ALGORITHM,
    false,
    [], // Public keys have no usages, they are only passed to `deriveKey`.
  );
  const authKey = await window.crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: remotePublicKey,
    },
    privateKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false, // Disallow exporting, so that the key cannot be stolen (could still be abused via XSS).
    ['sign', 'verify'],
  );
  // The key ID is only used locally, as the key's IndexedDB key, so it is generated randomly
  // and does not match the remote peer's ID for the same key.
  const authKeyId = uuid.v7();

  await saveAuthKey(authKey, authKeyId);
  return authKeyId;
}

const DATABASE_KEY: string = 'key-database';
const DATABASE_KEY_STORE: string = 'key-store';

// Initialize the database
const dbKeyPromise = openDB(DATABASE_KEY, 1, {
  upgrade(db) {
    db.createObjectStore(DATABASE_KEY_STORE);
  },
});

// Save the CryptoKey itself, which works even for keys that cannot be exported.
async function saveAuthKey(key: CryptoKey, id: string) {
  const dbKey = await dbKeyPromise;
  await dbKey.put(DATABASE_KEY_STORE, key, id);
}

export async function loadAuthKey(id: string): Promise<CryptoKey | undefined> {
  const dbKey = await dbKeyPromise;
  return (await dbKey.get(DATABASE_KEY_STORE, id)) as CryptoKey | undefined;
}
