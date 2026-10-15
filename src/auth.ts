import { openDB } from 'idb';
import * as uuid from 'uuid';

// The secret of an invite link, used as the key of the handshake when joining a calendar.
export type InviteSecret = {
  hmacKey: CryptoKey;
  string: string;
  // A key ID/fingerprint of the secret. This can be shared publicly, see `inviteSecretThumbprint`.
  thumbprint: string;
};

// 256 bits, the recommended key length for HMAC-SHA-256 (the length of its output, see RFC 2104).
const INVITE_SECRET_LENGTH = 32;

// Generate a new invite secret, to be included in an invite link.
export async function generateInviteSecret(): Promise<InviteSecret> {
  const bytes = new Uint8Array(INVITE_SECRET_LENGTH);
  window.crypto.getRandomValues(bytes);
  return await parseInviteSecret(bytes.toBase64());
}

// Parse the invite secret from the string included in an invite link.
export async function parseInviteSecret(secretString: string): Promise<InviteSecret> {
  const bytes = Uint8Array.fromBase64(secretString);

  if (bytes.length !== INVITE_SECRET_LENGTH) throw new Error('Invalid invite secret length.');

  const hmacKey = await window.crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false, // The key is never exported, the secret is kept as `string` where needed.
    ['sign', 'verify'],
  );
  return {
    hmacKey,
    string: secretString,
    thumbprint: await inviteSecretThumbprint(hmacKey),
  };
}

// Sign JSON data with an HMAC key, returning the signature as base64url. The data must identify
// its purpose, so that a signature for one purpose is never valid for another (domain separation):
// the invite secret signs thumbprints, calendar ID tags, and handshakes, see `HandshakeSignedData`.
async function signJson(hmacKey: CryptoKey, data: { purpose: string }): Promise<string> {
  const signature = await window.crypto.subtle.sign(
    'HMAC',
    hmacKey,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return new Uint8Array(signature).toBase64({ alphabet: 'base64url', omitPadding: true });
}

type InviteSecretThumbprintSignedData = {
  purpose: 'pin-calendar-invite-thumbprint';
};

// Compute an identifier of the invite secret, by which the inviter looks up the invite, see
// `JoinRequestPacket::secretThumbprint`. It is an HMAC of a fixed label, keyed with the secret, so
// it cannot be computed without the secret, and does not reveal it.
async function inviteSecretThumbprint(hmacKey: CryptoKey): Promise<string> {
  const data: InviteSecretThumbprintSignedData = { purpose: 'pin-calendar-invite-thumbprint' };
  return await signJson(hmacKey, data);
}

type CalendarIdTagSignedData = {
  // Identifies the purpose of the signature, see `signJson`.
  purpose: 'pin-calendar-invite-calendar-id';
  calendarId: string;
};

// Compute the calendar ID tag of an invite: an identifier of the invited calendar, which is
// included in the invite link in place of the calendar ID itself.
//
// Purpose:
// - Lets the invitee recognize a calendar it already has before joining, by comparing the tag in
//   the link to the tags of its own calendars. Joining a calendar it already has would make the
//   inviter add a peer that the invitee never uses, because the invitee keeps its existing
//   identity in that calendar.
// - Lets the invitee verify that the inviter shares the calendar the link was created for, see
//   `JoinAcceptPacket::calendarId`.
//
// Why not the calendar ID itself: invite links are sent over channels that may be logged or
// forwarded, and they outlive the invite. The calendar ID is not a credential, but there is no
// need to expose it to anyone who has not joined.
//
// Why an HMAC keyed with the invite secret, rather than a plain hash of the calendar ID: a plain
// hash would be the same in every invite link for the calendar, acting as a permanent alias that
// links them together. Keyed with the invite secret, the tag differs for every invite, and can
// only be checked against a calendar ID by someone who has the link, and who could thus learn the
// calendar ID by joining anyway.
export async function calendarIdTag(secret: InviteSecret, calendarId: string): Promise<string> {
  const data: CalendarIdTagSignedData = {
    purpose: 'pin-calendar-invite-calendar-id',
    calendarId,
  };
  return await signJson(secret.hmacKey, data);
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
type HandshakeSignedData = {
  // Identifies the purpose of the signature (domain separation).
  purpose: 'pin-calendar-handshake';
  role: HandshakeRole;
  // Base64-encoded challenges.
  challengeInitiator: string;
  challengeResponder: string;
};

// The data is serialized as JSON, so that its fields cannot be confused with each other. The
// signed JSON is never sent or parsed: the verifier serializes the same data using this function,
// which always produces the same output, because `JSON.stringify` keeps the order of the fields.
function handshakeSignedData(
  role: HandshakeRole,
  challengeInitiator: BufferSource,
  challengeResponder: BufferSource,
): Uint8Array<ArrayBuffer> {
  const initiator = toBytes(challengeInitiator);
  const responder = toBytes(challengeResponder);

  if (initiator.length !== CHALLENGE_LENGTH || responder.length !== CHALLENGE_LENGTH)
    throw new Error('Invalid handshake challenge length.');

  const data: HandshakeSignedData = {
    purpose: 'pin-calendar-handshake',
    role,
    challengeInitiator: initiator.toBase64(),
    challengeResponder: responder.toBase64(),
  };
  return new TextEncoder().encode(JSON.stringify(data));
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
    ['deriveBits'],
  );
  return {
    privateKey: keyPair.privateKey,
    publicKeyRaw: new Uint8Array(await window.crypto.subtle.exportKey('raw', keyPair.publicKey)),
  };
}

// Identifies the purpose of keys derived by `establishAuthenticationKey`, see below.
const AUTHENTICATION_KEY_INFO = new TextEncoder().encode('pin-calendar-auth-key');

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
    [], // Public keys have no usages, they are only passed to `deriveBits`.
  );

  // The ECDH shared secret is the x-coordinate of a point on the curve. It is secret, but it is not
  // uniformly random: only about half of all 256-bit values are x-coordinates of a point, so it
  // should not be used as a key directly. Instead, it is passed through HKDF (RFC 5869), as
  // recommended by NIST SP 800-56A, which turns it into a uniformly random key.
  const sharedSecret = await window.crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: remotePublicKey,
    },
    privateKey,
    256, // The full shared secret of P-256.
  );
  const hkdfKey = await window.crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, [
    'deriveKey',
  ]);
  const authKey = await window.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      // A salt is optional, and only adds value when the secret is weak or reused. The shared
      // secret is neither: both key pairs are freshly generated for every invitation.
      salt: new Uint8Array(0),
      // Binds the key to its purpose, so that the same shared secret could never produce the same
      // key for another purpose (domain separation).
      info: AUTHENTICATION_KEY_INFO,
    },
    hkdfKey,
    // 256 bits is the recommended key length for HMAC-SHA-256 (the length of its output, see
    // RFC 2104). A longer key would not be more secure, because P-256 only provides about 128 bits
    // of security. Without a length, the key would be as long as the hash's block size (512 bits).
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
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

// Delete the key, once the peer it authenticates is no longer trusted.
export async function deleteAuthKey(id: string) {
  const dbKey = await dbKeyPromise;
  await dbKey.delete(DATABASE_KEY_STORE, id);
}
